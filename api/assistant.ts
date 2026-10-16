import Anthropic from "@anthropic-ai/sdk";
import { EDIT_TOOLS } from "../src/shared/ops.js";
import { authorize, claude, json, rateLimited, readJson } from "./_lib/server.js";
import { FIRST_CUT, SYSTEM } from "./_lib/prompt.js";

interface Body {
  mode: "first_cut" | "edit";
  prompt: string;
  state: string; // describeForAI(project)
  frames?: string[]; // small JPEG stills, base64
  history?: { role: "user" | "assistant"; text: string }[];
}

const tools = EDIT_TOOLS.map((t, i) =>
  i === EDIT_TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" as const } } : t,
) as unknown as Anthropic.Beta.BetaTool[];

export async function POST(req: Request) {
  const user = await authorize(req);
  if (user instanceof Response) return user;
  const ai = claude(req);
  if (!ai) return json({ error: "The AI is off: ANTHROPIC_API_KEY is not set on the server.", code: "key" }, 503);

  const limited = rateLimited(user.userId, "assistant", 40, 3600_000);
  if (limited) return limited;

  const body = await readJson<Body>(req);
  if (!body || typeof body.state !== "string" || !body.state) return json({ error: "Missing project state" }, 400);
  // Caps that keep one request to a sane cost: about 25 minutes of transcript, a long prompt, short history.
  if (body.state.length > 400_000) return json({ error: "This project is too long for the AI in one go. Split the recording into shorter parts." }, 413);
  if (typeof body.prompt !== "string" || body.prompt.length > 4000) return json({ error: "The request is too long. Keep it under 4,000 characters." }, 413);
  if (body.mode !== "first_cut" && body.mode !== "edit") return json({ error: "Bad mode" }, 400);

  // Earlier turns as plain text; their changes are already in the state.
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of (Array.isArray(body.history) ? body.history : []).slice(-12)) {
    if ((m.role !== "user" && m.role !== "assistant") || typeof m.text !== "string" || !m.text.trim()) continue;
    m.text = m.text.slice(0, 4000);
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) last.content = `${last.content as string}\n\n${m.text}`;
    else messages.push({ role: m.role, content: m.text });
  }
  if (messages[0]?.role === "assistant") messages.shift();

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const frame of (Array.isArray(body.frames) ? body.frames : []).slice(0, 3)) {
    if (typeof frame !== "string" || frame.length > 400_000 || !/^[A-Za-z0-9+/=]+$/.test(frame.slice(0, 200))) continue;
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: frame } });
  }
  const request = body.mode === "first_cut" ? `${FIRST_CUT}\n\nBrief from the creator: ${body.prompt || "(none: make a clean, tight, engaging edit)"}` : body.prompt;
  content.push({ type: "text", text: `<project_state>\n${body.state}\n</project_state>\n\n${request}` });
  if (messages[messages.length - 1]?.role === "user") messages.push({ role: "assistant", content: "Noted." });
  messages.push({ role: "user", content });

  // The function may run 300 s. If the model is still going at 270 s, stop it and apply every tool call
  // that had fully arrived, rather than losing the whole edit to a timeout.
  const deadline = Date.now() + 270_000;
  try {
    const stream = ai.client.beta.messages.stream(
      {
        model: ai.model,
        max_tokens: 32000,
        ...(ai.direct ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as never } : {}),
        thinking: { type: "adaptive" },
        output_config: { effort: body.mode === "first_cut" ? "high" : "medium" },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        tools,
        tool_choice: { type: "auto" },
        messages,
      },
      { timeout: 280_000, maxRetries: 1 },
    );
    const finished: Anthropic.Beta.BetaContentBlock[] = [];
    stream.on("contentBlock", (block) => finished.push(block));
    const timer = setTimeout(() => stream.abort(), Math.max(1000, deadline - Date.now()));
    let message: Anthropic.Beta.BetaMessage | null = null;
    let timedOut = false;
    try {
      message = await stream.finalMessage();
    } catch (e) {
      if (!stream.aborted) throw e;
      timedOut = true;
    } finally {
      clearTimeout(timer);
    }
    if (message?.stop_reason === "refusal") return json({ error: "The AI declined this request." }, 422);

    // On max_tokens the last tool call may be cut off; only fully streamed blocks are used.
    const truncated = timedOut || message?.stop_reason === "max_tokens";
    const blocks = truncated ? finished.filter((b, i) => !(i === finished.length - 1 && b.type === "tool_use" && message?.stop_reason === "max_tokens")) : message!.content;
    const text = blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    const ops = blocks.flatMap((b) => (b.type === "tool_use" ? [{ name: b.name, input: b.input as Record<string, unknown> }] : []));
    if (timedOut && !ops.length) return json({ error: "The AI took too long on this one. Try a shorter request, or split the video." }, 504);
    return json({
      message: text || (ops.length ? "Done." : "I could not find anything to change."),
      ops,
      truncated,
      usage: message?.usage,
    });
  } catch (e) {
    console.error("assistant", e);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "The Anthropic API key was rejected." }, 502);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "The AI is busy (rate limit). Try again in a moment." }, 429);
    if (e instanceof Anthropic.APIConnectionTimeoutError) return json({ error: "The AI took too long to answer. Try again." }, 504);
    if (e instanceof Anthropic.APIError) return json({ error: `The AI could not finish (error ${e.status ?? "unknown"}). Try again.` }, 502);
    throw e;
  }
}
