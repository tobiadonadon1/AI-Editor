import Anthropic from "@anthropic-ai/sdk";
import { EDIT_TOOLS } from "../src/shared/ops.js";
import { checkAccess, claude, json } from "./_lib/server.js";
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
  const denied = checkAccess(req);
  if (denied) return denied;
  const ai = claude(req);
  if (!ai) return json({ error: "The AI is off: ANTHROPIC_API_KEY is not set on the server.", code: "key" }, 503);

  const body = (await req.json()) as Body;
  if (!body.state) return json({ error: "Missing project state" }, 400);

  // Earlier turns as plain text; their changes are already in the state.
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of (body.history ?? []).slice(-12)) {
    if (!m.text?.trim()) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === m.role) last.content = `${last.content as string}\n\n${m.text}`;
    else messages.push({ role: m.role, content: m.text });
  }
  if (messages[0]?.role === "assistant") messages.shift();

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const frame of (body.frames ?? []).slice(0, 3)) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: frame } });
  }
  const request = body.mode === "first_cut" ? `${FIRST_CUT}\n\nBrief from the creator: ${body.prompt || "(none: make a clean, tight, engaging edit)"}` : body.prompt;
  content.push({ type: "text", text: `<project_state>\n${body.state}\n</project_state>\n\n${request}` });
  if (messages[messages.length - 1]?.role === "user") messages.push({ role: "assistant", content: "Noted." });
  messages.push({ role: "user", content });

  try {
    const stream = ai.client.beta.messages.stream({
      model: ai.model,
      max_tokens: 32000,
      ...(ai.direct ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as never } : {}),
      thinking: { type: "adaptive" },
      output_config: { effort: body.mode === "first_cut" ? "high" : "medium" },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools,
      tool_choice: { type: "auto" },
      messages,
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") return json({ error: "The AI declined this request." }, 422);

    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    const ops = message.content.flatMap((b) => (b.type === "tool_use" ? [{ name: b.name, input: b.input as Record<string, unknown> }] : []));
    return json({
      message: text || (ops.length ? "Done." : "I could not find anything to change."),
      ops,
      truncated: message.stop_reason === "max_tokens",
      usage: message.usage,
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "The Anthropic API key was rejected." }, 502);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "The AI is busy (rate limit). Try again in a moment." }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: `AI error ${e.status}: ${e.message}` }, 502);
    throw e;
  }
}
