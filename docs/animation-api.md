# Animation API

Animation layers (track V5) start as **placeholders**: a box on the timeline with a description of what the animation should show. The AI adds them during the first cut when "Generate animations with the animation API" is ticked in setup, or when asked ("add an animation of the three steps here"). You can also add one from **Graphics → New Animation Placeholder**. Each placeholder is sent to an animation service, and the file it returns replaces the placeholder in the preview and the export. Empty placeholders show only in the editor; exports leave them out and say so.

Until a service is connected, a built-in **mock** answers: it "renders" for about 4 seconds, then returns a sample transparent animation (`web/public/sample/animation.webm`). That makes the whole loop testable today.

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
