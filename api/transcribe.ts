import { authorize, json, rateLimited } from "./_lib/server.js";

interface ScribeWord {
  text: string;
  type: "word" | "spacing" | "audio_event";
  start: number | null;
  end: number | null;
}

// One chunk of 16 kHz mono WAV from the browser -> ElevenLabs Scribe v2, verbatim, word timings.
// The browser sends chunks under Vercel's 4.5 MB request limit and offsets the times itself.
export async function POST(req: Request) {
  const user = await authorize(req);
  if (user instanceof Response) return user;
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return json({ error: "Transcription is off: ELEVENLABS_API_KEY is not set on the server.", code: "key" }, 503);

  const limited = rateLimited(user.userId, "transcribe", 120, 3600_000);
  if (limited) return limited;

  const audio = await req.arrayBuffer();
  if (!audio.byteLength) return json({ error: "No audio received" }, 400);
  // Only the app's own 16 kHz WAV chunks (about 3.5 MB each).
  const head = new TextDecoder().decode(audio.slice(0, 12));
  if (!head.startsWith("RIFF") || head.slice(8) !== "WAVE" || audio.byteLength > 4.4 * 1024 ** 2) return json({ error: "Expected a WAV chunk from the editor." }, 400);

  const form = new FormData();
  form.append("model_id", "scribe_v2");
  form.append("file", new Blob([audio], { type: "audio/wav" }), "audio.wav");
  form.append("timestamps_granularity", "word");
  form.append("tag_audio_events", "true");
  form.append("no_verbatim", "false");
  const language = new URL(req.url).searchParams.get("language");
  if (language && /^[a-z]{2,3}$/i.test(language)) form.append("language_code", language);

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: form, signal: AbortSignal.timeout(110_000) }).catch(
    (e: unknown) => e as Error,
  );
  if (res instanceof Error) return json({ error: res.name === "TimeoutError" ? "Transcription took too long. Try again." : "Could not reach the transcription service." }, 504);
  if (!res.ok) {
    console.error("elevenlabs", res.status, (await res.text()).slice(0, 400));
    return json({ error: res.status === 429 ? "Transcription is busy. Try again in a minute." : `Transcription failed (${res.status}).` }, 502);
  }
  const raw = (await res.json()) as { language_code: string; words: ScribeWord[] };
  const words = raw.words
    .filter((w) => w.type !== "spacing" && w.start !== null && w.end !== null && w.text.trim())
    .map((w) => ({ text: w.text.trim(), start: w.start!, end: Math.max(w.end!, w.start!), kind: w.type === "audio_event" ? "audio_event" : "word" }));
  return json({ language: raw.language_code, words });
}
