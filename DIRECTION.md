# Advanced AI Editor — design direction

Self-authored redesign brief from the user's feedback, 14 October 2026.

## Current

The earlier Spool interface used charcoal, amber, a large editorial poster, numbered panels and many explanatory sentences. Its strongest feature was the actual editor beneath that styling: source media, preview, timeline, inspector and reversible edits. The user explicitly rejected the name, orange and black palette, density and visual style.

## Job and keep list

The first action is to add footage and describe the desired edit. The editor then makes a first cut; the creator reviews it and changes every decision. Keep upload, format and pace, project reopen, transcript captions, source media, preview, five timeline tracks, split/trim/reorder, cutaways, title graphics, image adjustments, music, export and local save. Preserve project data and the processing engine.

## Reference and decision

Higgsfield's current workspace makes a single creation action prominent and tucks secondary choices close to it. We use that economy of controls. We do not reproduce its black shell or neon accent. The new product name is **Advanced AI Editor** as requested.

## Three explorations

1. **Studio canvas** — cool white and mist blue, cobalt actions, upload as a large working surface, direction beside it. Chosen: best balance of clarity, directness and workspace feel. The final version compresses the mobile form so the action is visible sooner.
2. **Mint table** — pale mint and green, a compact form beside a sample filmstrip. Rejected: too clinical and the sample reel competes with the creator's footage.
3. **Blue field** — saturated sky blue, serif headline, floating form. Rejected: reads like a marketing page and buries the first action on phones.

The new look differs from the old on ground, type, accent, richness and shell. It refuses the dark dev-tool face and the generic paper-and-serif landing page.

## Tokens

- Ground `#F5F7FC`, surface `#FFFFFF`, soft surface `#ECF2FF`, stage `#E9EEF7`.
- Ink `#263653`, secondary `#536783`, rule `#DCE5F1`.
- Cobalt `#315EF4` handles primary actions and selected items. Aqua `#D9F3F0` and lavender `#E9E5FB` identify supporting timeline tracks without acting as status colours.
- Avenir Next carries the UI on macOS; Segoe UI and Arial are metric-conscious fallbacks. Text is 14–15px for controls, 12px minimum for metadata, 32–40px for the first-run heading.
- Spacing follows 4, 8, 12, 16, 24, 32, 48. Controls have 10–12px radii; the upload surface uses 20px.

## Shell and content

First run: brand; heading “Raw clips. First cut.”; footage drop with a three-frame edit motif; “Describe the edit”; format and pace; “Create first cut”; recent projects only when present. No decorative marketing panel.

Editor: a quiet top bar, compact media rail, prominent preview, practical timeline, and an inspector that shows only the selected item's controls. Brief and edit notes sit in one disclosure. A ready project shows factual clip and caption counts. At tablet width, preview and timeline use the full row with controls and media below. On phones, selecting an item opens its controls in a bottom sheet with a small live preview.

## Signature

Adding files replaces the three-frame edit motif with frames extracted locally from the selected video. The visual transition lasts about 240ms with an ease-out. Reduced motion makes the change instantly. Timeline blocks show source ranges, so a cut remains legible even when several blocks share a filename. The playhead remains the main movement once editing starts.

## Voice and states

Short, specific and calm: labels say what changes. Empty state has one action. Processing keeps the editor visible and reports progress. Errors keep the project and say what to retry. No virality claim.
