# Advanced AI Editor

An editable first-cut workspace for raw footage. The interface uses a warm stone and black palette, with media at the center.

## Hosted on Vercel

`vercel.json` deploys `web/` as a static site. The hosted editor processes clips in the browser and saves projects and source files in that browser's IndexedDB. It does not send large video files through a Vercel function. A user can upload clips, remove measured quiet sections, review and change cuts, add titles or captions, adjust image and sound, place cutaways, choose a generated music bed or upload audio, and download an MP4 where supported (WebM fallback). The export plays through in real time; keep the tab open until it downloads. Browser storage is device-specific and can be cleared by the browser.

Hosted mode does not currently transcribe speech or make semantic edit decisions. Captions are manual. The first cut uses audio energy; if the browser cannot decode a file for analysis, it keeps the full clip. This is a usable browser editor, not the complete AI product described in the roadmap.

To test hosted mode locally, serve `web/` as static files and open `/?mode=browser` on localhost. Normal `http://localhost:8000/` uses the Python server below.

## Run it

On this Mac, open a terminal in the AIEditor folder and run:

```sh
./run.sh
```

Then open [http://localhost:8000](http://localhost:8000). The server listens only on this computer (`127.0.0.1`). Keep the terminal open while using the app.

Requirements: Python 3.11 and FFmpeg/FFprobe. `run.sh` creates a local Python environment and installs the listed packages. The first speech analysis downloads the multilingual Whisper `small` model to `data/models`; this can take a little while. Set `AI_EDITOR_WHISPER_MODEL=base` before running if you want a faster, smaller model with lower transcription accuracy.

## What works now

1. Start from an idea, choose aspect ratio and pace, and import one or more clips.
2. Local Whisper transcribes speech and returns word timings. The first cut removes longer quiet gaps while leaving short handles around speech. Silent footage remains intact.
3. The app measures sample frames and proposes a restrained brightness adjustment. The brief can select a music mood, a requested duration note and, when specified as `Title: ...`, a title graphic. It can suggest a small number of additional text moments when clear speech matches brief keywords.
4. Inspect the first cut in a five-track timeline. Split, trim, delete and reorder clips. Edit caption words and timing, and add or edit titles. Place visual cutaways over the main footage while keeping the narration. Adjust brightness, contrast, saturation and original-sound volume.
5. Choose one of two quiet original synth beds or add your own audio track. Set music volume independently.
6. Export a 720p vertical or landscape MP4, or a 1080p square MP4. FFmpeg renders the same clip order, cutaways, captions, graphics, image settings and music shown in the project. Edits after export require a fresh render.
7. Projects save automatically as JSON and source media in `data/projects/<id>/`.

## Honest limits

This is a local product prototype. It does **not** predict virality, understand the meaning of every shot, generate new video footage, offer a licensed commercial music catalog, remove filler words reliably, or perform professional color grading. The editing plan currently uses local speech recognition, measured silence and exposure, and conservative rules derived from the brief. Users should review captions and the final cut before publishing. No paid API is required.

The interface and project format are designed to support more advanced creative models later, without discarding manual edits. Current cutaways are chosen and positioned by the user. More ambitious AI cutaway selection needs visual understanding of both the narration and supporting footage.

## Product architecture

- `web/`: dependency-free editor interface.
- `app/server.py`: local API, analysis, project persistence, media processing and export.
- `data/`: user projects, uploaded files, local speech model and original generated audio beds (ignored by Git).
- `DIRECTION.md`: product and visual direction.
- `ROADMAP.md`: quality and hosted-product milestones.

A commercial hosted version should add accounts, isolated storage, upload limits, background workers, a render queue, retryable jobs, observability, billing and license review before opening this server to the internet. Do not expose the current local server publicly.
