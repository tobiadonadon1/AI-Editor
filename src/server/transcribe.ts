import { openAsBlob } from "node:fs";
import path from "node:path";
import type { Word } from "../shared/project";

interface ScribeWord {
  text: string;
  type: "word" | "spacing" | "audio_event";
  start: number | null;
  end: number | null;
}

// ElevenLabs Scribe v2, verbatim, so the planner can see filler words and false starts.
export async function transcribe(audioFile: string): Promise<{ words: Word[]; language: string; raw: unknown }> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is missing. Add it to .env and restart.");

  const form = new FormData();
  form.append("model_id", "scribe_v2");
  form.append("file", await openAsBlob(audioFile), path.basename(audioFile));
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "true");
  form.append("no_verbatim", "false");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Transcription failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }
  const raw = (await res.json()) as { language_code: string; words: ScribeWord[] };

  const words: Word[] = raw.words
    .filter((w) => w.type !== "spacing" && w.start !== null && w.end !== null && w.text.trim())
    .map((w, i) => ({
      id: `w${i}`,
      text: w.text.trim(),
      start: w.start!,
      end: Math.max(w.end!, w.start!),
      kind: w.type === "audio_event" ? "audio_event" : "word",
    }));
  return { words, language: raw.language_code, raw };
}
