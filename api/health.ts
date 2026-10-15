import { claude, hasAuth, hasDatabase, hasStorage, hasTranscription, json } from "./_lib/server.js";

export function GET(req: Request) {
  return json({
    anthropic: Boolean(claude(req)),
    elevenlabs: hasTranscription(),
    auth: hasAuth(),
    storage: hasStorage() && hasDatabase(),
  });
}
