import { claude, hasTranscription, json } from "./_lib/server.js";

export function GET(req: Request) {
  return json({
    anthropic: Boolean(claude(req)),
    elevenlabs: hasTranscription(),
    accessCode: Boolean(process.env.APP_ACCESS_CODE),
  });
}
