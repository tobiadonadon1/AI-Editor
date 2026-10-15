# AI Editor

A professional video editor you can talk to. It looks and works like Premiere Pro (Program monitor, timeline with video and audio tracks, Effect Controls, Lumetri Color, Essential Graphics, text-based editing, Essential Sound, Export mode), and every panel can also be driven by an Assistant: describe the colour, the light, the titles, where they go, how they animate, the pacing, captions or format, and the change lands on the timeline as real layers you can adjust by hand or undo.

## Use it

- **New project**: drop footage (plus optional B-roll images/clips and music), pick a format, describe the edit. The first video is transcribed and Claude makes the first cut: retakes and filler removed, pacing, captions with key words, colour, hook title, zooms, graphics, CTA.
- **Edit**: by hand in the panels, or by typing (or dictating) to the Assistant. "Here" means the playhead, "this" means the selected layer.
- **Export**: H.264 MP4 rendered in the browser with the same engine as the preview (9:16, 4:5, 1:1, 16:9).
- **Open sample project** shows a finished edit and works without API keys.

Keyboard: Space play, J/K/L, ←/→ frame step, ↑/↓ edit points, V/C/T tools, ⌘K add edit, Delete ripple delete, ⌘D default transition, ⌘T new text, =/− zoom, \ fit, / ask the Assistant, ⌘Z undo, ⌘M export, ? all shortcuts.

## Run locally

```sh
npm install
cp .env.example .env   # add ANTHROPIC_API_KEY and ELEVENLABS_API_KEY
npm run dev            # http://localhost:5173
```

`npm test` runs the edit-engine tests, `npm run typecheck` the type checker.

## Deploy (Vercel)

Pushing to `main` deploys. `vercel.json` builds the Vite app to `web/dist` and deploys `api/*.ts` as functions. Set these in the Vercel project (Settings → Environment Variables):

| Variable | Needed for |
|---|---|
| `ANTHROPIC_API_KEY` | The Assistant and the AI first cut (Claude Opus 5.5) |
| `ELEVENLABS_API_KEY` | Transcription (Scribe v2, word timings) |
| `APP_ACCESS_CODE` | Optional but recommended for a shared link: testers enter it once, so the public URL cannot spend your API credits |

## How it works

```
browser                                         server (Vercel functions)
  media in IndexedDB, proxies via WebCodecs
  audio -> 16 kHz WAV chunks  ───────────────►  api/transcribe  -> ElevenLabs Scribe v2
  project state as text + 3 stills  ─────────►  api/assistant   -> Claude Opus 5.5 with editing tools
  tool calls applied to the project  ◄────────  (cut_words, set_color, add_text, add_zoom, ...)
  Remotion Player preview = Remotion web renderer export
```

- `src/shared/project.ts`: the project file, the single source of truth.
- `src/shared/ops.ts`: the editing operations Claude can call, and `applyOps`, which the editor uses to apply them. The AI can only do what the editor can show.
- `src/shared/timeline.ts`: word cuts, razor splits and ripple deletes become clips; layers anchored to words follow them through later cuts.
- `src/remotion/`: the composition (clips, Lumetri-style grade via `@remotion/effects`, adjustment layers, camera moves, transitions, text and graphics with animations, captions, music with ducking, synthesised SFX).
- `web/src/ui/`: the Premiere-style interface.
- `api/`: the two functions and the system prompt (`api/_lib/prompt.ts`).

Media never leaves the user's machine; projects are stored per browser. Remotion is free for individuals and companies of up to 3 people; larger companies need a Remotion company license.
