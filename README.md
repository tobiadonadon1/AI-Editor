# AI Editor

Upload a raw vertical talking-head video, describe the edit you want, and get a finished edit back: mistakes and retakes cut, pauses trimmed, animated captions with key words. Then change anything by hand and export an MP4.

## Run it

1. Copy `.env.example` to `.env` and add your keys:
   ```
   ANTHROPIC_API_KEY=...
   ELEVENLABS_API_KEY=...
   ```
2. Start the app:
   ```sh
   npm install
   npm run dev
   ```
3. Open http://localhost:5173

Requires Node 22+ and FFmpeg (`brew install ffmpeg`). The first export downloads a headless Chrome for rendering (~170 MB, once).

To try the editor without API keys: `npx tsx scripts/seed-sample.ts` creates a ready sample project from `samples/`.

## How it works

```
video + brief
  1. Prepare     FFmpeg makes an editing copy (1080x1920, 30fps) and a small audio file
  2. Transcribe  ElevenLabs Scribe v2, word timings, verbatim (keeps "um", false starts)
  3. Plan        Claude Opus 5.5 reads the transcript + brief and returns which words to cut and why,
                 plus key words for captions (structured JSON)
  4. Timeline    Kept words become clips; long pauses are trimmed; every word is re-timed
                 onto the shorter output timeline (src/shared/timeline.ts)
  5. Preview     Remotion Player in the browser
  6. Export      Remotion renders the same composition to MP4
```

The project file (`storage/projects/<id>/project.json`) is the single source of truth. The AI writes it, the editor changes it, and the preview and export both render it, so what you see is what you export.

## Editing

- **Transcript tab**: click a word to jump to it. Shift-click or drag to select. `Delete` cuts, `R` restores, `K` toggles a key word, `Space` plays, `⌘Z` undoes.
- **AI edit tab**: see what the AI did, change the brief and re-edit. Your own cuts are kept.
- **Captions tab**: position, words on screen, colours, uppercase, pause trimming.

## Layout

- `src/shared/` project format and timeline logic (used by server, preview and renderer)
- `src/remotion/` the video composition: cut clips + captions
- `src/server/` local API, FFmpeg, transcription, Claude planner, rendering
- `web/` editor UI (React + Vite)
- `storage/` projects and media (not committed)

`npm test` runs the unit tests, `npm run typecheck` the type checker, `npm run studio` opens Remotion Studio.

Remotion is free for individuals and companies of up to 3 people; larger companies need a Remotion company license.
