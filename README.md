# AI Editor

A professional video editor you can talk to. It looks and works like Premiere Pro (Program monitor, timeline with video and audio tracks, Effect Controls, Lumetri Color, Essential Graphics, text-based editing, Essential Sound, Export mode), and every panel can also be driven by an Assistant: describe the colour, the light, the titles, where they go, how they animate, the pacing, captions or format, and the change lands on the timeline as real layers you can adjust by hand or undo.

## Use it

- **New project**, in four steps: name and format; the main video (plus optional B-roll and music); options (editing style, captions on/off and their look, your own ready-made animations with a note on where each goes, and generated animations); then any instructions. The video is transcribed and Claude makes the first cut: retakes and filler removed, pacing, captions with key words, colour, hook title, zooms, your animations placed, animation placeholders, CTA. On-screen numbering and bullet points ("01", "Step 2", "•") are not used unless you ask for them.
- **Animations**: their own track (V5). Placeholders are designed by Claude as motion-graphics code (Remotion), checked from stills, and rendered in a sandbox in the browser to transparent video; or filled by your own animation API (see [docs/animation-api.md](docs/animation-api.md)).
- **Edit**: by hand in the panels, or by typing (or dictating) to the Assistant. "Here" means the playhead, "this" means the selected layer.
- **Export**: H.264 MP4 rendered in the browser with the same engine as the preview (9:16, 4:5, 1:1, 16:9).
- **Open sample project** shows a finished edit and works without API keys.

Keyboard: Space play, J/K/L, ←/→ frame step, ↑/↓ edit points, V/C/T tools, ⌘K add edit, Delete ripple delete, ⌘D default transition, ⌘T new text, =/− zoom, \ fit, / ask the Assistant, ⌘Z undo, ⌘M export, ? all shortcuts.

## Run locally

```sh
npm install
vercel env pull        # or copy .env.example to .env.local and fill it in
npm run dev            # http://localhost:5173, with Clerk sign-in
NO_AUTH=1 npm run dev  # no accounts: everything is saved as the user "local"
```

`npm test` runs the edit-engine tests, `npm run typecheck` the type checker. With the dev server running, `npx tsx scripts/cloud-e2e.mts` (env loaded from `.env.local`) checks sign-in, upload, download, saving and deleting against the real services with a temporary Clerk test user.

## Deploy (Vercel)

Pushing to `main` deploys. `vercel.json` builds the Vite app to `web/dist` and deploys `api/*.ts` as functions. Set these in the Vercel project (Settings → Environment Variables):

| Variable | Needed for |
|---|---|
| `ANTHROPIC_API_KEY` | The Assistant and the AI first cut (Claude Opus 5.5) |
| `ELEVENLABS_API_KEY` | Transcription (Scribe v2, word timings); the key starts with `sk_` |
| `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Accounts (set by the Clerk Marketplace integration) |
| `BLOB_READ_WRITE_TOKEN` | Media files in Vercel Blob (set when the Blob store is connected) |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | The projects database; create the table once with `supabase/migrations/0001_projects.sql` in the Supabase SQL editor |
| `ANIMATION_API_URL`, `ANIMATION_API_KEY` | Optional: an animation service that fills animation placeholders ([contract](docs/animation-api.md)). Without them Claude writes the animations as code; `ANIMATION_PROVIDER=mock` forces the test mock |

## How it works

```
browser                                         server (Vercel functions)
  Clerk sign-in; every call sends the session token
  working copy in IndexedDB, proxies via WebCodecs
  project JSON (debounced)  ─────────────────►  api/projects    -> Supabase table public.projects
  edit copy of each clip  ───────────────────►  Vercel Blob (private), token from api/upload
  download on another device  ◄──────────────  api/media       -> short-lived signed links
  audio -> 16 kHz WAV chunks  ───────────────►  api/transcribe  -> ElevenLabs Scribe v2
  project state as text + 3 stills  ─────────►  api/assistant   -> Claude Opus 5.5 with editing tools
  animation placeholders  ───────────────────►  api/animations  -> Claude writes Remotion code (or ANIMATION_API_URL)
  sandboxed animator iframe  ◄── code ───────    rendered in the browser to transparent WebM
  tool calls applied to the project  ◄────────  (cut_words, set_color, add_text, add_zoom, ...)
  Remotion Player preview = Remotion web renderer export
```

- `src/shared/project.ts`: the project file, the single source of truth.
- `src/shared/ops.ts`: the editing operations Claude can call, and `applyOps`, which the editor uses to apply them. The AI can only do what the editor can show.
- `src/shared/timeline.ts`: word cuts, razor splits and ripple deletes become clips; layers anchored to words follow them through later cuts.
- `src/remotion/`: the composition (clips, Lumetri-style grade via `@remotion/effects`, adjustment layers, camera moves, transitions, text and graphics with animations, captions, music with ducking, synthesised SFX).
- `web/src/ui/`: the Premiere-style interface.
- `web/src/lib/cloud.ts` + `store.ts`: sync. The browser copy is saved at once, the account copy 2.5 s after the last change and when leaving the project; a project opens from whichever copy is newer, and missing media is downloaded.
- `api/`: the functions and the system prompt (`api/_lib/prompt.ts`).

Each user only reaches their own rows and their own `u/<user id>/` media folder; the server checks both on every request. The cloud copy of a video is the 1080p editing proxy when one was made (what preview and export use), which keeps storage small. Remotion is free for individuals and companies of up to 3 people; larger companies need a Remotion company license.
