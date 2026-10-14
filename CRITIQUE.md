# Critique log (v2 redesign)

One critic (a separate agent seeing only renders) for the whole job. Rubric: web-designer critique.md, 13 lines plus Fidelity.

## Round 1 (renders: design/v2/shots/r3-*)

| # | Line | Score |
|---|---|---|
| 1 | Concept on the page | 4 |
| 2 | Not the category average | 4 |
| 3 | Not a slop face | 4 |
| 4 | First screen | 3 |
| 5 | Typography | 4 |
| 6 | Colour | 4 |
| 7 | Richness | 3 |
| 8 | Structure and rhythm | 3 |
| 9 | Craft | 3 |
| 10 | Responsive | 3 |
| 11 | Everyone's computer | 4 |
| 12 | Signature | 3 |
| 13 | Screenshot test | 3 |
| 14 | Fidelity | 3 |

Not done (6 of 13 at 4+).

Asks:
1. Phone first screen shows script; collapse key warning; 768 as two columns. **Taken**, except notes stay inline after the struck run on phones (a 64px margin column would leave 28 characters a line at 390).
2. One margin note per struck run, on the line where it ends, with a pencil tick. **Taken.**
3. Render the missing states and a filmstrip of the cut. **Taken** via `?state=` URLs (processing, error, exporting, exported-stale, captions, playing, selected, cut).
4. Home as a desk of pages with thumbnails and real marks; bias-cut frame instead of a dashed box; English dates; no resize grip. **Taken.**
5. Square video corners, custom scrubber with cut ticks, graphite pencil at lighter weight, irregular highlighter, hint moved off the page. **Taken**, except "multiply blend" on the highlighter (it sits behind the type already, so multiply changes nothing visible).

Answered warns: none open. The scan and matrix are clean for r3.

## Round 2 (renders: design/v2/shots/r5-*, r4-home)

| # | Line | R1 | R2 |
|---|---|---|---|
| 1 | Concept on the page | 4 | 5 |
| 2 | Not the category average | 4 | 4 |
| 3 | Not a slop face | 4 | 4 |
| 4 | First screen | 3 | 4 |
| 5 | Typography | 4 | 4 |
| 6 | Colour | 4 | 3 |
| 7 | Richness | 3 | 4 |
| 8 | Structure and rhythm | 3 | 3 |
| 9 | Craft | 3 | 3 |
| 10 | Responsive | 3 | 4 |
| 11 | Everyone's computer | 4 | 4 |
| 12 | Signature | 3 | 4 |
| 13 | Screenshot test | 3 | 4 |
| 14 | Fidelity | 3 | 4 |

**Done by the stop rule** (10 of 13 at 4+, none below 3) once one defect the scan missed was fixed: the phone "Download MP4" line clipped at the top of the screen.

Asks that landed from round 1: phone first screen, per-run margin notes, states and filmstrip, poster cards, bias-cut drop frame, square video, scrubber notches. Declines accepted by the critic: inline notes on phones, no multiply blend, Montserrat captions as the creator convention.

### Fixed after the last round, not rescored (verified with scan, matrix and filmstrip in design/v2/shots/r6-*)

- Phone exported state: the Download line now sits with the header block. The out-of-date line names what is stale ("Out of date: exported Wed 16:47, before your last changes") in light ink.
- Pink has one job again. Caption highlight colour now defaults to the same #FF8BD0 as the page highlighter, and the export progress bar is paper on graphite.
- Caption controls match the scrubber: hairline tracks with a paper tick, a square ink checkbox, and live caption samples ("THE SECOND ONE", "CUT EVERY PAUSE") in place of bare swatches.
- Selection is one seamless tint. It clears the moment Cut or Restore fires. The margin note writes in over 120 ms after the stroke. The AI's summary keeps the AI's words (no live number); the header length is what counts down.
- High Contrast keeps the scrubber track, notches and playhead.
- Home at 1100px and up uses two columns (new edit, earlier pages). On cards the pink stops at the word, and the spaces sit outside the struck run.
- The header hint gives way below 1400px, so the project title no longer truncates at 1280.
- Processing shows ruled lines with a blinking ink caret instead of grey skeleton bars. The empty preview is a true 9:16.
- Caption samples render on one line.

Scan: no FAILs on home, editor and all seven review states at 390/768/1280/1440. Matrix: clean on editor and home (Windows 125/150%, High Contrast, Linux, Android, Firefox, Safari, iPhone, 320px, reduced motion, l10n).
