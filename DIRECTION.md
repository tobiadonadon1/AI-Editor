# AI Editor: design direction (v2)

Brief **self-authored** from the conversation on 14 Oct 2026. The user called the v1 design "disgusting" and the logo "terrible", and asked for logo research and no AI slop. No paid image generation was used.

## Brief

1. **What:** a local web app. A creator drops in a raw vertical talking-head video and writes how it should be edited. The AI cuts retakes, filler and pauses, and adds animated captions. The creator reviews the cut, fixes it by hand, and exports an MP4.
2. **The one job (every session):** *check the AI's cut and fix what it got wrong*, fast, then export. The transcript is where the editing happens; the video proves it.
3. **Feel:** sure-handed, quick, a little playful (the output is Reels and TikTok). References from outside the web: an actor's marked-up script, a self-healing cutting mat, a karaoke screen.
4. **What exists:** the name "AI Editor" (working name), no usable logo, no brand colours worth keeping, the user's own footage (the richness source in real use), a synthetic sample clip for demos.
5. **Image generation:** not used (paid credits, self-authored brief).

## Current (v1, being replaced)

- **Look:** cool white ground `#F5F7FC`, cobalt `#315EF4` buttons, Avenir Next, white rounded panels on a grey-blue stage, pastel pills.
- **Logo:** a blue rounded square containing a play triangle (▶). This is the most generic mark in the video category. It says "media player", not "editor", and it could belong to any of a thousand apps.
- **Slop faces:** face 3 (the shadcn dashboard): boxes inside boxes, pastel status pills, one radius on everything, a generic blue accent. It is also the 2024 SaaS default.
- **Scan:** FAIL on contrast of cut words (2.55:1), FAIL on player time over video, 11px pause chips.
- **History row:** `app|object|light|grotesque|blue|shape|topbar`.
- **Keep list (contract):** upload with a brief; project list; processing steps; error state with retry; key-missing warning; 9:16 preview player; transcript with cut words (reason-coded), key words, pause markers, current word, selection; Cut / Restore / Key word actions with keyboard shortcuts (Delete, R, K, Space, ⌘Z); undo; AI summary; brief editing and "Re-edit with AI"; caption style controls (position, words at once, colours, uppercase, pause threshold); before → after duration; export with progress; download; "old export" warning.

## Logo research

- **Bierut (Pentagram):** a new logo is "an empty vessel awaiting the meaning". It is a signature ("this is me"), not a description. Keep it simple enough to be filled over time. [It's Nice That](https://www.itsnicethat.com/features/michael-bierut-logo-design)
- **Wordmark vs symbol:** wordmarks are easier to own, but a product that lives as an app icon and a favicon needs a symbol that survives at 16px. [Subtraction](https://subtraction.com/2015/08/21/should-your-logo-be-a-wordmark-or-a-symbol)
- **The AI-logo cliché:** a circle, a central void, radiating strokes, a purple-to-blue gradient (the "sphincter" look shared by many AI companies). Refused. [velvetshark](https://velvetshark.com/ai-company-logos-that-look-like-buttholes), [braindetox](https://braindetox.kr/en/posts/ai_logo_design_convergence_2026.html)
- **The video-category clichés:** the play triangle, the clapperboard, the film strip with sprocket holes, scissors, a lens, a sparkle ✨ for "AI", purple/pink gradients (OpusClip, Captions, Submagic all lean violet). Refused.
- **What is specific to this product:** it edits video *by editing words*. A cut is a word struck out; the two sides close up. Film history gives the honest precedent: the guillotine **tape splice** (late 1960s) let editors "peel the tape off and remake a splice or restore the frames". That is exactly this app's non-destructive cut and Restore. [RedShark News](https://www.redsharknews.com/post-vfx/item/3014-the-dramatic-ways-that-technology-has-changed-editing), [Sprocket School](https://www.sprocketschool.org/wiki/Splicer)

## Category default we refuse

CapCut, Descript, OpusClip, Submagic and Captions share: a dark grey NLE shell or a white SaaS dashboard; Inter-like UI type; violet-to-pink gradients and a sparkle for AI; a play-button or abstract-blob logo; feature cards. Slop faces this brief falls into naturally: face 3 (shadcn dashboard) and face 4 (dark dev tool, since video editors default to dark grey).

## Concepts (one per family)

First ideas, crossed out: ~~a film strip~~, ~~a clapperboard~~, ~~a broadcast control room~~, ~~a departure board of clips~~.

- **A. Printed matter:** *AI Editor is an actor's script, marked up.* Courier pages, pencil strike-throughs where lines are cut, fluorescent highlighter on the words that matter. Ground: photocopy paper. Type: Courier Prime (mono). Richness: hand-drawn marks (illustration). Accent: highlighter pink. Shell: split.
- **B. Objects and materials:** *AI Editor is a self-healing cutting mat.* The green mat with its printed grid and ruler is the timeline; cuts are made with a knife and the pieces close up. Ground: mat green (colour field). Type: Archivo expanded. Richness: colour-material. Accent: cutter-handle orange. Shell: canvas.
- **C. Media:** *AI Editor is a karaoke screen.* Words light up as they are spoken, the way the captions will; cut lines drop out of the lyrics. Ground: deep night blue (dark). Type: M PLUS Rounded 1c heavy. Richness: the transcript as live data. Accent: lyric-wipe cyan. Shell: topbar.

## Exploration and choice

Shots: `design/v2/shots/explore-{a,b,c}/` (not committed).

- **Chosen: A, the marked-up script.** It is the only direction that is *this* product: you edit video by striking out words, and the script page makes that the whole interface. It is calm enough for long sessions.
- **Merged in from B:** the *offcut* idea. Cut lines stay on the page, struck through, with the reason in the margin, so "Restore" means pulling an offcut back. Nothing is ever deleted.
- **Merged in from C:** the live follow-along. During playback the script tracks the spoken word with an ink underline, like a lyric screen.
- **B lost:** the mat-green grid everywhere is loud for an all-day tool, and the strips became boxes.
- **C lost:** the giant lyric line wastes the screen. Editing selection in a karaoke layout is awkward. The dark navy app is close to face 4.
- **History:** `app|printed|paper|mono|pink|illustration|split`, clear of earlier projects and of v1.
- **The one paper-and-ink direction, justified:** it is an app, not a marketing page. No serif display, no italic accent word, no pills, no mono eyebrows. The paper is cool photocopy stock (not warm cream). The accent is fluorescent highlighter pink (not forest green or vermilion). The richness is the user's own footage beside the page, plus the marks made on it.

## Logo

Shots: `design/v2/shots/logo-r1`, `logo-r2`. Twelve marks tried. Rejected: tape splice (reads as a pause button), proofreader's deleatur (beautiful but reads as a "6"), E monogram (generic), script-line icon and [/] brackets (generic UI icons).

**Chosen: the bias cut.** A 9:16 frame (the format the app makes) sliced on a diagonal, the halves offset by a few units, as a jump cut leaves them. It is one colour, so it survives at 16px, in a fax, embroidered or stamped. It owes nothing to play buttons, film strips, sparkles or gradient blobs. On the app icon and the favicon the frame sits on highlighter pink, so the cut shows pink, the same colour as the highlighter marks in the script.

Files: `web/public/mark.svg` (one colour), `favicon.svg`, `icon.svg` (512, square, for app icons). Construction on a 64 grid: top piece `M17 5H45V27L17 33Z`, bottom piece `M21 37L49 31V59H21Z`; the slope is 6 in 28; the gap is 4 units, the offset 4.

**Wordmark:** "AI Editor" in Courier Prime Bold, the face of the script, tracked -1%. The name is a working name (decision for the user).

## Tokens

Colour (one accent, one job: **pink means "this word matters"**, i.e. key words, plus the logo):

| Role | Value | Source |
|---|---|---|
| `--paper` | `oklch(96.8% 0.004 120)` #F3F4F0 | photocopy stock, faintly cool |
| `--desk` | `oklch(26.5% 0.008 120)` #2A2C27 | graphite desk; a neutral dark surround is also correct for judging picture |
| `--desk-2` | `oklch(33% 0.008 120)` | raised graphite: controls on the desk |
| `--ink` | `oklch(23% 0.01 120)` #22251F | typewriter ink |
| `--ink-2` | `oklch(44% 0.01 120)` | pencil notes; 7.0:1 on paper |
| `--rule` | `oklch(86% 0.006 120)` | ruled lines on the page |
| `--on-desk` | `oklch(93% 0.006 120)` / `--on-desk-2` `oklch(76% 0.008 120)` | type on graphite, 5.6:1 or better |
| `--hl` | `oklch(82% 0.15 350)` #FF8BD0 | fluorescent highlighter |
| `--alarm` | `oklch(52% 0.17 28)` | red pencil, only for errors |

No dark mode: the page is paper by concept; the desk is already dark.

Type: **Courier Prime** for the script, timecodes and margin notes, because the transcript *is* a script and Courier is the screenplay face (Courier Prime was drawn for screenwriters). **Hanken Grotesk** for the UI chrome around the page, because it is a quiet neo-grotesque with open shapes that stays clear at 13 to 14px without being the default Inter. Scale: script 18/36 (line height 2.0, room for marks), title 15 caps Courier bold, UI 14, meta 13, caption-preview display set by Remotion. Tabular figures for every duration.

Radius: sheets and the page are square (paper), controls 3px (printed buttons), the video 6px. Shadow only on the sheet, which lies on the desk.

## Shell and density

**Split.** Left, the desk with the script sheet, scrolling. Right, a 400px graphite column: the logo and project, the preview (9:16), the transport, and two folding sections, *Captions* and *Brief*. A thin tool strip sticks to the top of the desk: Cut, Restore, Highlight, Undo, with shortcuts. Comfortable density (script lines are reading text). Phone: the preview sticks to the top at 38vh, the script below, the tool strip fixed at the bottom.

## Signature

**The pencil cut.** Select words, press Delete: a graphite pencil stroke draws through them left to right (220ms, ease-out, slight wobble so it looks hand-drawn), the reason "you" appears in the margin, and the duration in the header ticks down to the new length. Restore erases the stroke right to left (180ms). Highlight swipes pink left to right (260ms). During playback an ink underline walks the spoken word. Reduced motion: every mark appears complete, instantly.

## Voice

Talks like a good script editor: brief, exact, a little dry. Says what changed and by how much ("7.8 s shorter"), never hypes the AI.

## Content

**Home (new edit):**
- Header: mark + "AI Editor".
- Sheet title: "New edit"
- Drop area: "Drop the raw video here" / "MP4 or MOV, filmed vertically. Or choose a file." Filled: file name, "182 MB · change".
- Brief label: "How should it be cut?" Placeholder: "Tight and energetic for Reels. Cut mistakes and repeated takes. Under 45 seconds."
- Button: "Make the first cut". Uploading: "Uploading 42%".
- Recent list heading: "Earlier edits". Row: title, "22.3 s → 14.5 s", "Tue 14 Oct", status word ("Ready", "Transcribing", "Needs a key").
- Empty list: nothing (the section is absent).

**Editor, ready:** header "Three ways to edit faster", "22.3 s → 14.5 s", "Export MP4". Script header: title in caps, "Brief: …", editor's note: "Removed the false start, two filler words and a repeated phrase. 7.8 s shorter." Lines with timecodes, margin notes "retake", "filler", "false start", "stumble", "off brief", "you". Pause marks "(1.4 s)". Tools: "Cut ⌫", "Restore R", "Highlight K", "Undo ⌘Z". Empty selection hint: "Select words to cut, restore or highlight. Click a word to hear it."
**Processing:** sheet shows the three steps as typed lines: "Preparing the footage", "Transcribing", "Reading it through and cutting", the current one with an animated ellipsis; skeleton script lines below.
**Error:** red-pencil note on the sheet with the message and "Try again".
**Missing keys:** a strip at the top of the desk: "Add ELEVENLABS_API_KEY and ANTHROPIC_API_KEY to .env, then restart npm run dev. Until then videos upload but are not transcribed or cut."
**Export:** "Export MP4" → "Exporting 34%" → "Download MP4" + "Export again"; if edited after: "Download (before your last changes)".
