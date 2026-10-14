import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CUT_REASONS, type CutReason, type Edit, type Word } from "../shared/project";

const MODEL = "claude-opus-5-5";

const PlanSchema = z.object({
  summary: z
    .string()
    .describe("Two or three sentences for the creator: what you cut and why, in plain language."),
  removals: z.array(
    z.object({
      fromWord: z.string().describe("First word id to remove, e.g. w12"),
      toWord: z.string().describe("Last word id to remove (inclusive); same as fromWord for one word"),
      reason: z.enum(CUT_REASONS.filter((r) => r !== "manual") as [CutReason, ...CutReason[]]),
    }),
  ),
  emphasis: z
    .array(z.string())
    .describe("Word ids of the key words to highlight in captions (kept words only)."),
});

export type Plan = z.infer<typeof PlanSchema>;

const SYSTEM = `You are the lead editor of short vertical talking-head videos (Reels, TikTok, Shorts).
You receive a word-level transcript of the raw recording and the creator's brief. You decide which words to cut so the result is tight, clear and natural.

How to edit:
- Retakes: when the speaker restarts or repeats a sentence, keep only the last complete, fluent take and cut the earlier attempts entirely.
- False starts and stumbles: cut abandoned half-words and phrases the speaker corrects ("we go- we went" -> keep "we went").
- Filler: cut "um", "uh", "erm" and filler uses of "like", "you know", "so" at the start of a thought, but only where removing them leaves a clean sentence.
- Off-brief: if the brief asks for a shorter video or a particular focus, cut tangents that do not serve it. Never cut content the message depends on.
- Do not cut inside a word, and keep each sentence grammatically whole. When in doubt, keep it.
- Pauses are trimmed automatically afterwards; do not cut words just to remove silence.
- Respect the brief over these defaults when they conflict.

Captions: choose emphasis words, roughly one per sentence, that carry the meaning (numbers, names, the key noun or verb, the payoff). Only choose words you keep.

Refer to words only by their ids from the transcript. Ranges are inclusive and in transcript order.`;

function transcriptListing(words: Word[]): string {
  const lines: string[] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (prev && w.start - prev.end >= 0.5) lines.push(`(pause ${(w.start - prev.end).toFixed(1)}s)`);
    const label = w.kind === "audio_event" ? `[sound: ${w.text}]` : w.text;
    lines.push(`${w.id} ${w.start.toFixed(2)}-${w.end.toFixed(2)} ${label}`);
  });
  return lines.join("\n");
}

export async function planEdit(words: Word[], brief: string, durationSec: number): Promise<Plan> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is missing. Add it to .env and restart.");
  }
  const client = new Anthropic();

  const prompt = `Creator's brief:
${brief.trim() || "(no brief given: make a clean, tight edit)"}

Raw recording length: ${durationSec.toFixed(1)}s

Transcript (id start-end word):
${transcriptListing(words)}`;

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: zodOutputFormat(PlanSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error("The AI declined to plan this edit.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("The edit plan was cut off. Try a shorter clip.");
  }
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return PlanSchema.parse(JSON.parse(text));
}

// Turn the plan into edit decisions. Manual cuts made by the creator are kept.
export function applyPlan(edit: Edit, words: Word[], plan: Plan): Edit {
  const index = new Map(words.map((w, i) => [w.id, i]));
  const cuts: Edit["cuts"] = Object.fromEntries(
    Object.entries(edit.cuts).filter(([, reason]) => reason === "manual"),
  );
  for (const r of plan.removals) {
    const a = index.get(r.fromWord);
    const b = index.get(r.toWord);
    if (a === undefined || b === undefined) continue;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) cuts[words[i].id] ??= r.reason;
  }
  const emphasis = plan.emphasis.filter((id) => index.has(id) && !cuts[id]);
  return { ...edit, cuts, emphasis, summary: plan.summary };
}
