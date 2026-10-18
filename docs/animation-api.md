# Animation API

Animation layers (track V5) start as **placeholders**: a box on the timeline with a description of what the animation should show. The AI adds them during the first cut when "Generate animations with the animation API" is ticked in setup, or when asked ("add an animation of the three steps here"). You can also add one from **Graphics → New Animation Placeholder**. Each placeholder is sent to an animation service, and the file it returns replaces the placeholder in the preview and the export. Empty placeholders show only in the editor; exports leave them out and say so.

Where the animations come from, in order:

1. **Your service**, when `ANIMATION_API_URL` is set (contract below).
2. **Claude, writing each animation as code** (the default whenever the AI is configured). Claude writes one Remotion component for the placeholder (`api/_lib/motion.ts` holds the brief: transparent background, springs and staggered builds, a designed exit, no bullet lists). The editor runs it in a sandboxed iframe (`web/animator.html`: opaque origin, no storage, no network but fonts), renders three stills, sends them back to Claude for one art-director review, applies the polished version, and renders it to a transparent VP9 WebM that fills the layer. Errors in the code are sent back to Claude to fix (twice at most). The code is kept on the layer (`code`). It takes about 1 to 2 minutes per animation, mostly Claude writing; rendering takes seconds. Renders wait while the editor tab is in the background, because Chrome does not draw a sandboxed frame there.
3. A built-in **mock** (`ANIMATION_PROVIDER=mock`, or no AI configured): it "renders" for about 4 seconds, then returns a sample transparent animation (`web/public/sample/animation.webm`).

## Connecting your service

Set these on the server (Vercel → Settings → Environment Variables, or `.env.local`):

| Variable | Meaning |
|---|---|
| `ANIMATION_API_URL` | Base URL of the service, e.g. `https://animations.example.com/v1/animations` |
| `ANIMATION_API_KEY` | Optional. Sent as `Authorization: Bearer <key>` |

The browser never talks to the service directly; `api/animations.ts` does, after checking the user's session.

## Contract

### Create: `POST {ANIMATION_API_URL}`

```json
{
  "prompt": "A bar chart growing from 1x to 3x in brand yellow, bars slide up one after another",
  "durationSec": 3,
  "width": 648,
  "height": 648,
  "fps": 30,
  "background": "transparent",
  "format": "9:16",
  "style": { "font": "Montserrat", "color": "#FFFFFF", "accentColor": "#FFE14D" },
  "context": "the words spoken while the animation is on screen",
  "projectId": "p…",
  "layerId": "an…"
}
```

- `width` × `height` is the box the animation fills, in pixels of the final video. Full-screen animations get the whole frame and `"background": "opaque"`; overlays get `"transparent"`.
- `style` follows the video's titles, so the animation can match them. It may be missing.

Answer with a job:

```json
{ "id": "job_123", "status": "queued" }
```

`status` is one of `queued`, `processing`, `ready`, `failed`. If the animation is ready at once, answer `ready` with `url`.

### Poll: `GET {ANIMATION_API_URL}/{id}`

```json
{ "id": "job_123", "status": "ready", "url": "https://…/job_123.webm" }
{ "id": "job_123", "status": "failed", "error": "Could not render that" }
```

The editor polls every 2.5 s, for up to 15 minutes.

### The file

- **WebM** (VP8/VP9, transparency kept), **MP4** (H.264) or **MOV** (H.264), or a **PNG/WebP** still. ProRes does not play in browsers.
- `url` must be downloadable by the server for a few minutes (a signed link is fine). With cloud storage on, the server copies it into the user's media folder, so the link may expire afterwards; without it, the browser downloads the link itself, which then needs CORS.
- Up to 500 MB.

Errors: answer non-2xx with `{ "error": "message" }`; the message is shown on the layer.
