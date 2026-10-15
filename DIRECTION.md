# Direction (v3)

Brief from the user, 15 Oct 2026: it must look and feel like Premiere Pro, a professional tool and not a toy, be very advanced at editing, and let you do everything by describing it in prompts ("I want this colour different, the lighting different, this text here, that text there, an animation here"), so videos in any converting format come out matched to a detailed description. It must deploy to Vercel so a tester can use it.

## Decisions

- **Shell**: Premiere's anatomy. Menu bar; Import / Edit / Export modes; workspaces (Editing, Color, Graphics, Captions, Audio) that switch the left panel group between Effect Controls, Lumetri Color, Essential Graphics, Text and Essential Sound; Program monitor with blue timecode, transport, safe margins and direct manipulation; Project and Effects panels; Tools strip; timeline with C1, V1-V6, A1-A3, label colours, filmstrips, waveforms, blue playhead, hot-text numbers; meters; status bar. The Assistant is a docked panel on the right, always visible, because prompting is the main way in.
- **Look**: Spectrum-dark neutrals (#0b0b0b gaps, #1d1d1d panels), one accent (#2d8ceb blue) for selection, playhead and values, Premiere-like clip label colours. Type: Source Sans 3 (Adobe's open-source sans, the closest free relative of Adobe Clean), 12 px, tabular numbers for timecode.
- **Engine**: one project file; the AI edits it through the same operations the panels use; one Remotion composition renders the preview and the export, in the browser, so what you see is what you export and nothing heavy runs on Vercel.
- **Honesty**: no fake controls. Features that need a server we do not have (generative video, licensed music, voice enhancement) are not shown; the Assistant says so when asked.
