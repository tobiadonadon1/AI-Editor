# Spool — direction and product brief

Self-authored from the user's brief, 14 October 2026.

## Job

A creator brings an idea and raw clips. Spool makes a strong first edit: removes dead air, prepares captions, suggests restrained graphics, balances the image, and gives the creator direct control of every decision before export. It does not promise virality.

## First version

Short talking-head videos with optional supporting clips and a music track. Local processing on the user's computer. No account or paywall yet. The architecture keeps project data separate from processing so hosted storage, queues, authentication and billing can be added later.

## Three directions

1. **Cutting room** (object/material): a charcoal editing bench with a large, honest video stage. Warm amber marks selected moments. Compact sans labels and a ribbon timeline. Motion is the playhead and clip blocks responding to edits.
2. **Story wall** (place): a bright pin-up space where shots look like contact sheets. Blue marks the chosen take. Editorial type and rearranged strips. Motion is clips sliding onto a board.
3. **Broadcast desk** (media): a saturated blue console with hard yellow signals and precise condensed lettering. The story is monitored like a live transmission. Motion is stepped meters.

Chosen: **Cutting room**. The user's footage provides the visual richness; the application should recede while supporting precise editing. The bright board would compete with footage; the broadcast look suggests live production rather than reflective editing.

## Style

- Ground: `#151513`; stage: `#0b0b0a`; panel: `#22221f`; raised: `#2c2b27`.
- Text: `#f3f0e8`; secondary: `#b8b4a9`; rules: `#3c3b35`.
- Accent: `#e8ad69`, used for the primary action and selected timeline content.
- UI type: system sans, with clear weight contrast and tabular time figures.
- Corners: 8px on controls, 14px on large panels. Clip edges remain square so cuts are exact.
- Density: spacious stage, compact timeline and inspector.
- Signature: when an edit is planned, the amber cut markers appear sequentially along the footage strip. Reduced motion shows them immediately.

## Core screen content

Header: Spool, project name, save state, Export video.
Left: Story brief, source media, Edit decisions.
Center: large preview, transport, edit timeline and tracks.
Right: settings for the selected clip, title, caption or audio. Values can be changed directly.
First run: “Start with footage.” Import clips and describe the video you want.
Processing: show the actual phase, with media and existing edits still visible.
Error: preserve project and explain the failed step and retry.

## Technical boundary

Local FFmpeg handles media operations and export. Local speech recognition is optional and downloaded separately. With no transcription model installed, the app can still find quiet sections and build a reversible first cut, but captions require transcription. Future hosted AI can use the same project format.
