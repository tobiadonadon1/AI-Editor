// Editing operations. Claude calls these as tools; the editor applies them with
// applyOps. Both sides share this file, so the AI can only do what the editor can show.
import {
  ANIMS,
  CAPTION_ANIMS,
  CAPTION_PRESET_IDS,
  CUT_REASONS,
  FONT_IDS,
  FORMAT_IDS,
  LOOK_IDS,
  NEUTRAL_GRADE,
  SFX_IDS,
  SHAPES,
  TEXT_PRESET_IDS,
  TRANSITIONS,
  FPS,
  mainAsset,
  uid,
  type AdjustItem,
  type AnimationItem,
  type Anim,
  type CaptionStyle,
  type ChangeNote,
  type CutReason,
  type Effects,
  type Grade,
  type Item,
  type ItemType,
  type MediaItem,
  type Motion,
  type MusicItem,
  type Project,
  type SfxId,
  type SfxItem,
  type TextItem,
  type TextPresetId,
  type TextStyle,
  type TransitionItem,
} from "./project.js";
import { CAPTION_PRESETS, captionPreset, fullBrief, makeShape, makeText, resolveGrade } from "./presets.js";
import { buildTimeline, cutPoints, durationSec, itemStart, outputToSource, placeItems, sourceToOutput, wordOutputTime, type Timeline } from "./timeline.js";

export interface Op {
  name: string;
  input: Record<string, unknown>;
}

export interface OpContext {
  playhead: number; // output seconds
  selectedItemId?: string | null;
  allowLists?: boolean; // the creator asked for numbered or bulleted text, so markers like "01" are kept
}

// ---------- tool definitions (JSON Schema, sent to Claude) ----------

const num = (description: string, extra: Record<string, unknown> = {}) => ({ type: "number", description, ...extra });
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });
const bool = (description: string) => ({ type: "boolean", description });
const enm = (values: readonly string[], description: string) => ({ type: "string", enum: [...values], description });

const timing = {
  start_word: str("Word id where it starts (e.g. w12). Preferred: the item then follows that word if cuts change."),
  start_sec: num("Start on the output timeline in seconds. Use when there is no word, e.g. 0 for the opening."),
  end_word: str("Word id where it ends (inclusive). Alternative to duration_sec."),
  duration_sec: num("Length in seconds."),
};

const gradeProps = {
  temperature: num("White balance, -100 (blue) to 100 (amber)"),
  tint: num("-100 (green) to 100 (magenta)"),
  exposure: num("Stops, -4 to 4"),
  contrast: num("-100 to 100"),
  highlights: num("-100 to 100"),
  shadows: num("-100 to 100"),
  whites: num("-100 to 100"),
  blacks: num("-100 to 100"),
  saturation: num("0 to 200, 100 = unchanged"),
  vibrance: num("-100 to 100"),
  vignette: num("0 to 100"),
  grain: num("Film grain 0 to 100"),
  glow: num("Bloom on highlights 0 to 100"),
  look: { type: ["string", "null"], enum: [...LOOK_IDS, null], description: "Creative look preset, or null for none" },
  look_intensity: num("0 to 100"),
};

const effectProps = {
  blur: num("Gaussian blur in px, 0-40"),
  zoom_blur: num("Radial zoom blur px, 0-80"),
  chromatic: num("RGB split px, 0-30"),
  mono: num("Black and white amount 0-100"),
  shine: bool("Light sweep across the frame"),
  light_leak: num("Film light leak 0-100"),
  pixelate: num("Pixel size, 0-60"),
  glitch: num("Digital glitch 0-100"),
};

const textStyleProps = {
  font: enm(FONT_IDS, "Typeface"),
  size: num("Font size in px at 1080 px frame width (captions ~80, hooks ~110, lower thirds ~50)"),
  weight: num("100-900"),
  color: str("Fill colour, hex"),
  accent_color: str("Colour for *starred* words, hex"),
  stroke_color: str("Outline colour"),
  stroke_width: num("Outline px, 0 for none"),
  background: { type: ["string", "null"], description: "Box colour behind the text (hex or rgba), null for none" },
  padding: num("Box padding px"),
  radius: num("Box corner radius px"),
  shadow: bool("Drop shadow"),
  uppercase: bool("All caps"),
  italic: bool("Italic"),
  letter_spacing: num("Tracking, -10 to 40"),
  align: enm(["left", "center", "right"], "Alignment"),
};

const POSITIONS = ["top", "upper", "center", "lower", "bottom"] as const;

export const EDIT_TOOLS = [
  {
    name: "cut_words",
    description: "Remove a range of words from the edit (and the video under them). Use for retakes, false starts, stumbles, filler and tangents.",
    input_schema: {
      type: "object",
      properties: { from_word: str("First word id"), to_word: str("Last word id, inclusive"), reason: enm(CUT_REASONS.filter((r) => r !== "manual"), "Why") },
      required: ["from_word", "to_word", "reason"],
    },
  },
  {
    name: "restore_words",
    description: "Put previously cut words back.",
    input_schema: { type: "object", properties: { from_word: str("First word id"), to_word: str("Last word id, inclusive") }, required: ["from_word", "to_word"] },
  },
  {
    name: "cut_time",
    description: "Remove a stretch of the current output timeline by time (for parts without words, or 'cut the first second').",
    input_schema: { type: "object", properties: { start_sec: num("Output seconds"), end_sec: num("Output seconds") }, required: ["start_sec", "end_sec"] },
  },
  {
    name: "set_key_words",
    description: "Mark or unmark key words; captions show them in the emphasis colour.",
    input_schema: { type: "object", properties: { add: { type: "array", items: { type: "string" } }, remove: { type: "array", items: { type: "string" } }, replace_all: bool("Clear existing key words first") } },
  },
  {
    name: "set_pacing",
    description: "How tight the edit is: silences longer than max_pause_sec are removed. 0.15 = very fast, 0.35 = natural, 0.8 = relaxed.",
    input_schema: { type: "object", properties: { max_pause_sec: num("0.1 to 1.5") }, required: ["max_pause_sec"] },
  },
  {
    name: "set_format",
    description: "Change the output aspect ratio. Everything reframes automatically.",
    input_schema: { type: "object", properties: { format: enm(FORMAT_IDS, "9:16 Reels/TikTok, 4:5 feed ads, 1:1 square, 16:9 YouTube") }, required: ["format"] },
  },
  {
    name: "set_color",
    description: "Lumetri colour for the whole video. Only the fields you pass change. For a colour change on part of the video, use add_adjustment instead.",
    input_schema: { type: "object", properties: { ...gradeProps, reset: bool("Start from neutral first") } },
  },
  {
    name: "add_adjustment",
    description: "An adjustment layer over a time range: colour change, effects (blur, glitch, black and white, light leak...) and/or camera motion, applied to the video below.",
    input_schema: {
      type: "object",
      properties: {
        ...timing,
        name: str("Short label"),
        grade: { type: "object", properties: gradeProps, description: "Colour offsets for this range" },
        effects: { type: "object", properties: effectProps },
        fade_sec: num("Ease the layer in and out, seconds"),
      },
    },
  },
  {
    name: "add_zoom",
    description: "Camera move on the main video: punch-in zoom on emphasis, slow push-in, pull-out, or drift. Classic talking-head technique; alternate punch-ins between cuts.",
    input_schema: {
      type: "object",
      properties: {
        ...timing,
        scale: num("1.05 to 2. 1.15 subtle punch, 1.3 strong"),
        style: enm(["punch", "smooth", "push", "pull", "drift"], "punch = instant cut-in, smooth = eased in/out, push = slow push-in, pull = slow pull-out, drift = slow pan"),
        focus_x: num("Point to zoom into, 0-100 of width (50 = centre; faces are usually ~35-45 from top)"),
        focus_y: num("0-100 of height"),
      },
    },
  },
  {
    name: "add_text",
    description:
      "Add a text layer: hook titles, callouts, lower thirds, stats, quotes, CTAs. Wrap words in *asterisks* to colour them with the accent colour. Keep on-screen text short.",
    input_schema: {
      type: "object",
      properties: {
        text: str("The text. Use \\n for a line break and *word* for accent colour."),
        preset: enm(TEXT_PRESET_IDS, "Template. hook = big opening line, title = section or point title, callout = boxed keyword, lower-third = name/role, number = big figure only (\"*01*\", \"*3x*\", \"*+38%*\"; an optional short label on a second line is set small), cta = end-card button"),
        ...timing,
        position: enm(POSITIONS, "Vertical placement. Avoid the caption zone (lower) when captions are on."),
        x: num("Centre x, 0-100 of width"),
        y: num("Centre y, 0-100 of height"),
        width: num("Max width, 0-100 of frame width"),
        rotation: num("Degrees"),
        style: { type: "object", properties: textStyleProps },
        anim_in: enm(ANIMS, "Entrance animation"),
        anim_out: enm(ANIMS, "Exit animation"),
        sfx: enm([...SFX_IDS, "none"], "Sound on entrance"),
      },
      required: ["text"],
    },
  },
  {
    name: "add_graphic",
    description: "Add a shape: highlight box, circle, underline, arrow, a progress bar across the top for the whole video, a dark gradient behind text, or a frame border.",
    input_schema: {
      type: "object",
      properties: {
        shape: enm(SHAPES, "Kind"),
        ...timing,
        color: str("Hex"),
        color2: str("Second colour (gradients, progress track)"),
        x: num("Centre x 0-100"),
        y: num("Centre y 0-100"),
        w: num("Width 0-100 of frame width"),
        h: num("Height 0-100 of frame height"),
        rotation: num("Degrees (arrows point right at 0)"),
        opacity: num("0-100"),
        anim_in: enm(ANIMS, "Entrance"),
        anim_out: enm(ANIMS, "Exit"),
      },
      required: ["shape"],
    },
  },
  {
    name: "add_transition",
    description: "A transition effect at a cut point or moment: flash, dip-black, zoom-punch, glitch, whip, blur, light-leak, shake.",
    input_schema: {
      type: "object",
      properties: {
        kind: enm(TRANSITIONS, "Style"),
        at_sec: num("Centre time in output seconds"),
        at_word: str("Centre on this word"),
        at_cut: num("Index of a cut point from the list (0-based)"),
        every_cut: bool("Put this transition on every cut point"),
        duration_sec: num("Usually 0.2-0.6"),
        color: str("Flash colour, hex"),
      },
      required: ["kind"],
    },
  },
  {
    name: "add_sfx",
    description: "Add a sound effect. Only when the brief is punchy social or asks for sound design, never for calm, educational, premium or corporate edits. Use sparingly: whoosh on transitions, pop on a callout, ding on a payoff.",
    input_schema: {
      type: "object",
      properties: {
        sound: enm(SFX_IDS, "Sound"),
        at_sec: num("Output seconds"),
        at_word: str("On this word"),
        on: enm(["texts", "transitions", "zooms"], "Add one to every text layer, transition or punch-in zoom instead of a single time"),
        volume_db: num("-30 to 6, default -6"),
      },
      required: ["sound"],
    },
  },
  {
    name: "add_broll",
    description: "Place an imported image or video (from the media list) over the main video: full screen cutaway or picture-in-picture.",
    input_schema: {
      type: "object",
      properties: {
        asset_id: str("Media id"),
        ...timing,
        fit: enm(["cover", "contain", "pip"], "cover = full screen, pip = small window"),
        x: num("Centre x for pip"),
        y: num("Centre y for pip"),
        scale: num("Size for pip, 0.2-1"),
        ken_burns: bool("Slow zoom on stills"),
        anim_in: enm(ANIMS, "Entrance"),
        anim_out: enm(ANIMS, "Exit"),
        volume_db: num("Clip audio, -60 to 6"),
      },
      required: ["asset_id"],
    },
  },
  {
    name: "add_animation",
    description:
      "Add an animation layer (its own track, above graphics). Either place one of the creator's ready-made animations (asset_id of a media item marked ANIMATION), or add a placeholder: a prompt describing the motion graphic, which the animation service then generates. Use for things that are clearer animated: a process, a comparison, a product feature, a logo sting. Never over the face; overlays stay out of the caption zone.",
    input_schema: {
      type: "object",
      properties: {
        asset_id: str("A ready-made animation from the media list"),
        prompt: str("For a placeholder: what the animation shows, concretely, in one or two sentences (subject, motion, colours). No on-screen numbering."),
        ...timing,
        fit: enm(["overlay", "fullscreen"], "overlay = a graphic over the video (default), fullscreen = a cutaway that fills the frame"),
        x: num("Centre x 0-100 (overlay)"),
        y: num("Centre y 0-100 (overlay)"),
        width: num("Width 0-100 of frame width (overlay), default 60"),
        anim_in: enm(ANIMS, "Entrance"),
        anim_out: enm(ANIMS, "Exit"),
      },
    },
  },
  {
    name: "set_music",
    description: "Use an imported audio file as the music bed for the whole edit, or remove it.",
    input_schema: {
      type: "object",
      properties: {
        asset_id: { type: ["string", "null"], description: "Audio media id, or null to remove music" },
        volume_db: num("-40 to 0; -18 is a typical bed under speech"),
        duck: bool("Lower the music while someone speaks"),
        fade_in: num("Seconds"),
        fade_out: num("Seconds"),
      },
    },
  },
  {
    name: "set_captions",
    description: "Animated captions from the transcript. Only the fields you pass change; a preset sets a whole look first.",
    input_schema: {
      type: "object",
      properties: {
        enabled: bool("Show captions"),
        preset: enm(CAPTION_PRESET_IDS, "bold-pop, hormozi (big, 2 words, green/yellow), karaoke (word box), boxed (white box), clean (subtle bar), neon, minimal, typewriter"),
        font: enm(FONT_IDS, "Typeface"),
        size: num("px at 1080 wide, 50-130"),
        color: str("Base colour"),
        active_color: str("Colour of the word being spoken"),
        emphasis_color: str("Colour of key words"),
        stroke_color: str("Outline"),
        stroke_width: num("Outline px"),
        background: { type: ["string", "null"], description: "Box behind the line" },
        active_box: { type: ["string", "null"], description: "Box behind the spoken word" },
        y: num("Vertical centre 0-100 (72 lower third, 50 centre)"),
        max_words: num("Words on screen at once, 1-8"),
        uppercase: bool("All caps"),
        animation: enm(CAPTION_ANIMS, "How words appear"),
        shadow: bool("Drop shadow"),
      },
    },
  },
  {
    name: "set_video",
    description: "Main video framing and dialogue level: reframe for a new aspect ratio, scale, rotation, volume.",
    input_schema: {
      type: "object",
      properties: {
        focus_x: num("0-100: horizontal centre of the crop"),
        focus_y: num("0-100: vertical centre of the crop"),
        scale: num("1 = fill, 1.2 = 20% zoom for the whole video"),
        rotation: num("Degrees"),
        volume_db: num("Dialogue gain, -30 to 12"),
        fit: enm(["cover", "contain"], "cover fills the frame, contain letterboxes"),
      },
    },
  },
  {
    name: "update_item",
    description:
      "Change an existing layer by id: text, style, position, timing, animation, colours, grade, effects or motion. Pass only what changes.",
    input_schema: {
      type: "object",
      properties: {
        id: str("Layer id"),
        text: str("New text"),
        preset: enm(TEXT_PRESET_IDS, "Switch text template"),
        ...timing,
        position: enm(POSITIONS, "Vertical placement"),
        x: num("Centre x"),
        y: num("Centre y"),
        width: num("Width"),
        w: num("Shape width"),
        h: num("Shape height"),
        rotation: num("Degrees"),
        opacity: num("0-100"),
        scale: num("Scale (b-roll pip, zoom)"),
        style: { type: "object", properties: textStyleProps },
        anim_in: enm(ANIMS, "Entrance"),
        anim_out: enm(ANIMS, "Exit"),
        color: str("Colour"),
        color2: str("Second colour"),
        kind: enm(TRANSITIONS, "Transition style"),
        sound: enm(SFX_IDS, "Sound"),
        volume_db: num("Level"),
        grade: { type: "object", properties: gradeProps },
        effects: { type: "object", properties: effectProps },
        hidden: bool("Hide without deleting"),
        prompt: str("New description for an animation placeholder"),
        fit: enm(["overlay", "fullscreen"], "Animation fit"),
      },
      required: ["id"],
    },
  },
  {
    name: "remove_items",
    description: "Delete layers by id, or every layer of a type.",
    input_schema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" } }, type: enm(["text", "shape", "media", "animation", "adjust", "transition", "sfx", "music"], "Remove all layers of this type") },
    },
  },
  {
    name: "rename_project",
    description: "Give the project a short name.",
    input_schema: { type: "object", properties: { name: str("Name") }, required: ["name"] },
  },
] as const;

export type ToolName = (typeof EDIT_TOOLS)[number]["name"];

// ---------- applying ----------

type In = Record<string, unknown>;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | undefined => (values.includes(v as T) ? (v as T) : undefined);
const fmt = (s: number) => `${s.toFixed(1)} s`;
const POS_Y: Record<(typeof POSITIONS)[number], number> = { top: 12, upper: 28, center: 50, lower: 70, bottom: 86 };

interface Ctx {
  p: Project;
  t: Timeline;
  t0: Timeline; // the edit the AI saw when it planned this turn
  src: number; // main source duration
  ctx: OpContext;
  notes: ChangeNote[];
}

function rebuild(c: Ctx) {
  c.t = buildTimeline(c.p, c.src, FPS);
}

// The AI gives times on the edit as it was before this turn; earlier operations in the same turn
// (cuts, pacing) may have moved things since, so times go through the source footage to the edit as it is now.
function remap(c: Ctx, sec: number): number {
  const total = durationSec(c.t);
  if (c.t === c.t0) return clamp(sec, 0, total);
  const src = outputToSource(c.t0, sec);
  if (src === null) return clamp(sec, 0, total);
  const out = sourceToOutput(c.t, src);
  if (out !== null) return clamp(out, 0, total);
  // That moment was cut: use the start of the next kept clip.
  const f = src * c.t.fps;
  const next = c.t.clips.find((cl) => cl.srcStartFrame >= f);
  return next ? next.fromFrame / c.t.fps : total;
}

function wordIndex(p: Project, id: unknown) {
  if (!isStr(id)) return -1;
  return p.words.findIndex((w) => w.id === id);
}

// Start time with an optional anchor word. An unknown word is an error, not a silent jump to the playhead.
function resolveStart(c: Ctx, input: In): Pick<Item, "start" | "anchorWord" | "anchorOffset"> {
  if (isStr(input.start_word) && wordIndex(c.p, input.start_word) < 0 && !isNum(input.start_sec)) throw new Error(`unknown word ${input.start_word}`);
  if (isStr(input.start_word)) {
    const at = wordOutputTime(c.t, input.start_word);
    if (at !== null) return { start: at, anchorWord: input.start_word, anchorOffset: 0 };
    // A cut word: fall back to the next kept word.
    const i = wordIndex(c.p, input.start_word);
    if (i >= 0) {
      for (let k = i + 1; k < c.p.words.length; k++) {
        const t = wordOutputTime(c.t, c.p.words[k].id);
        if (t !== null) return { start: t, anchorWord: c.p.words[k].id, anchorOffset: 0 };
      }
    }
  }
  if (isNum(input.start_sec)) return { start: remap(c, input.start_sec) };
  return { start: remap(c, c.ctx.playhead) };
}

function resolveDuration(c: Ctx, input: In, start: number, fallback: number) {
  if (isNum(input.duration_sec) && input.duration_sec > 0) return input.duration_sec;
  if (isStr(input.end_word)) {
    const w = c.t.words.find((x) => x.id === input.end_word);
    if (w && w.endMs / 1000 > start) return w.endMs / 1000 - start + 0.15;
  }
  if (isNum(input.end_sec)) {
    const end = remap(c, input.end_sec);
    if (end > start) return end - start;
  }
  return fallback;
}

function gradeFrom(input: unknown): Partial<Grade> {
  const g = (input ?? {}) as In;
  const out: Partial<Grade> = {};
  for (const key of Object.keys(NEUTRAL_GRADE) as (keyof Grade)[]) {
    if (key === "look" || key === "lookIntensity") continue;
    if (isNum(g[key])) (out as Record<string, number>)[key] = g[key] as number;
  }
  if (g.look === null) out.look = null;
  else if (oneOf(g.look, LOOK_IDS)) out.look = g.look as Grade["look"];
  if (isNum(g.look_intensity)) out.lookIntensity = clamp(g.look_intensity, 0, 100);
  return out;
}

function effectsFrom(input: unknown): Partial<Effects> {
  const e = (input ?? {}) as In;
  const out: Partial<Effects> = {};
  if (isNum(e.blur)) out.blur = clamp(e.blur, 0, 60);
  if (isNum(e.zoom_blur)) out.zoomBlur = clamp(e.zoom_blur, 0, 120);
  if (isNum(e.chromatic)) out.chromatic = clamp(e.chromatic, 0, 40);
  if (isNum(e.mono)) out.mono = clamp(e.mono, 0, 100);
  if (typeof e.shine === "boolean") out.shine = e.shine;
  if (isNum(e.light_leak)) out.lightLeak = clamp(e.light_leak, 0, 100);
  if (isNum(e.pixelate)) out.pixelate = clamp(e.pixelate, 0, 80);
  if (isNum(e.glitch)) out.glitch = clamp(e.glitch, 0, 100);
  return out;
}

function styleFrom(input: unknown): Partial<TextStyle> {
  const s = (input ?? {}) as In;
  const out: Partial<TextStyle> = {};
  if (oneOf(s.font, FONT_IDS)) out.font = s.font as TextStyle["font"];
  if (isNum(s.size)) out.size = clamp(s.size, 16, 400);
  if (isNum(s.weight)) out.weight = clamp(Math.round(s.weight / 100) * 100, 100, 900);
  if (isStr(s.color)) out.color = s.color;
  if (isStr(s.accent_color)) out.accentColor = s.accent_color;
  if (isStr(s.stroke_color)) out.strokeColor = s.stroke_color;
  if (isNum(s.stroke_width)) out.strokeWidth = clamp(s.stroke_width, 0, 40);
  if (s.background === null || isStr(s.background)) out.background = (s.background as string | null) || null;
  if (isNum(s.padding)) out.padding = clamp(s.padding, 0, 120);
  if (isNum(s.radius)) out.radius = clamp(s.radius, 0, 999);
  if (typeof s.shadow === "boolean") out.shadow = s.shadow;
  if (typeof s.uppercase === "boolean") out.uppercase = s.uppercase;
  if (typeof s.italic === "boolean") out.italic = s.italic;
  if (isNum(s.letter_spacing)) out.letterSpacing = clamp(s.letter_spacing, -20, 60);
  const align = oneOf(s.align, ["left", "center", "right"] as const);
  if (align) out.align = align;
  return out;
}

const anim = (v: unknown): Anim | undefined => oneOf(v, ANIMS);

function addSfxAt(c: Ctx, sound: SfxId, at: number, volume = -6, anchor?: string) {
  const item: SfxItem = { id: uid("x"), type: "sfx", sound, start: Math.max(0, at), duration: 1.2, volume, ...(anchor ? { anchorWord: anchor, anchorOffset: 0 } : {}) };
  c.p.items.push(item);
}

function cutWordRange(c: Ctx, from: unknown, to: unknown, reason: CutReason, restore = false) {
  const a = wordIndex(c.p, from);
  const b = wordIndex(c.p, to);
  if (a < 0 || b < 0) throw new Error(`unknown word ${a < 0 ? from : to}`);
  const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
  let n = 0;
  for (let i = lo; i <= hi; i++) {
    const id = c.p.words[i].id;
    if (restore) {
      if (c.p.cuts[id]) n++;
      delete c.p.cuts[id];
    } else if (!c.p.cuts[id]) {
      c.p.cuts[id] = reason;
      n++;
    }
  }
  if (!restore) c.p.emphasis = c.p.emphasis.filter((id) => !c.p.cuts[id]);
  const text = c.p.words.slice(lo, hi + 1).map((w) => w.text).join(" ");
  const short = text.length > 48 ? `${text.slice(0, 46)}…` : text;
  c.notes.push({ op: restore ? "restore" : "cut", text: `${restore ? "Restored" : `Cut (${reason.replace("_", " ")})`}: “${short}”` });
  return n;
}

const HANDLERS: Record<string, (c: Ctx, input: In) => void> = {
  cut_words(c, i) {
    cutWordRange(c, i.from_word, i.to_word, oneOf(i.reason, CUT_REASONS) ?? "off_brief");
    rebuild(c);
  },
  restore_words(c, i) {
    cutWordRange(c, i.from_word, i.to_word, "manual", true);
    rebuild(c);
  },
  cut_time(c, i) {
    if (!isNum(i.start_sec) || !isNum(i.end_sec) || i.end_sec <= i.start_sec) throw new Error("bad range");
    const s = outputToSource(c.t0, i.start_sec);
    const e = outputToSource(c.t0, i.end_sec - 1 / FPS);
    if (s === null || e === null) throw new Error("range outside the edit");
    c.p.rangeCuts.push({ id: uid("r"), start: s, end: e + 1 / FPS, reason: "manual" });
    c.notes.push({ op: "cut", text: `Cut ${fmt(i.end_sec - i.start_sec)} at ${fmt(i.start_sec)}` });
    rebuild(c);
  },
  set_key_words(c, i) {
    const set = new Set(i.replace_all ? [] : c.p.emphasis);
    for (const id of (Array.isArray(i.add) ? i.add : []) as unknown[]) if (wordIndex(c.p, id) >= 0 && !c.p.cuts[id as string]) set.add(id as string);
    for (const id of (Array.isArray(i.remove) ? i.remove : []) as unknown[]) set.delete(id as string);
    c.p.emphasis = [...set];
    c.notes.push({ op: "keywords", text: `${c.p.emphasis.length} key words highlighted` });
    rebuild(c);
  },
  set_pacing(c, i) {
    if (!isNum(i.max_pause_sec)) throw new Error("max_pause_sec missing");
    c.p.settings = { ...c.p.settings, maxPauseSec: clamp(i.max_pause_sec, 0.1, 2) };
    c.notes.push({ op: "pacing", text: `Pauses over ${c.p.settings.maxPauseSec.toFixed(2)} s trimmed` });
    rebuild(c);
  },
  set_format(c, i) {
    const f = oneOf(i.format, FORMAT_IDS);
    if (!f) throw new Error("unknown format");
    c.p.format = f;
    c.notes.push({ op: "format", text: `Format ${f}` });
  },
  set_color(c, i) {
    const g = gradeFrom(i);
    c.p.grade = { ...(i.reset ? NEUTRAL_GRADE : c.p.grade), ...g };
    const parts = Object.entries(g).map(([k, v]) => (k === "look" ? `look ${v ?? "none"}` : `${k} ${typeof v === "number" ? Math.round(v * 100) / 100 : v}`));
    c.notes.push({ op: "color", text: `Colour: ${parts.join(", ") || "reset"}` });
  },
  add_adjustment(c, i) {
    const at = resolveStart(c, i);
    const item: AdjustItem = {
      id: uid("a"),
      type: "adjust",
      ...at,
      duration: resolveDuration(c, i, at.start, 2),
      name: isStr(i.name) ? i.name : undefined,
      grade: i.grade ? gradeFrom(i.grade) : undefined,
      effects: i.effects ? effectsFrom(i.effects) : undefined,
      fade: isNum(i.fade_sec) ? clamp(i.fade_sec, 0, 3) : 0.2,
    };
    c.p.items.push(item);
    c.notes.push({ op: "adjust", text: `Adjustment layer${item.name ? ` “${item.name}”` : ""} at ${fmt(item.start)} for ${fmt(item.duration)}` });
  },
  add_zoom(c, i) {
    const at = resolveStart(c, i);
    const ease = oneOf(i.style, ["punch", "smooth", "push", "pull", "drift"] as const) ?? "punch";
    const motion: Motion = {
      scale: clamp(isNum(i.scale) ? i.scale : 1.18, 1, 3),
      x: clamp(isNum(i.focus_x) ? i.focus_x : 50, 0, 100),
      y: clamp(isNum(i.focus_y) ? i.focus_y : 40, 0, 100),
      rotation: 0,
      ease,
    };
    const item: AdjustItem = { id: uid("z"), type: "adjust", ...at, duration: resolveDuration(c, i, at.start, 1.6), name: `Zoom ${Math.round(motion.scale * 100)}%`, motion, fade: 0 };
    c.p.items.push(item);
    c.notes.push({ op: "zoom", text: `${ease[0].toUpperCase()}${ease.slice(1)} zoom ${Math.round(motion.scale * 100)}% at ${fmt(item.start)}` });
  },
  add_text(c, i) {
    if (!isStr(i.text) || !i.text.trim()) throw new Error("text missing");
    const preset = oneOf(i.preset, TEXT_PRESET_IDS) ?? "callout";
    const text = c.ctx.allowLists ? i.text.replace(/\\n/g, "\n") : withoutListMarkers(i.text.replace(/\\n/g, "\n"));
    const at = resolveStart(c, i);
    const item = makeText(preset, text, at.start);
    item.style = { ...item.style, ...houseStyle(c.p, preset) };
    Object.assign(item, at);
    item.duration = resolveDuration(c, i, at.start, item.duration);
    applyTextFields(item, i);
    c.p.items.push(item);
    makeRoomFor(c, item);
    const sfx = oneOf(i.sfx, SFX_IDS);
    if (sfx) addSfxAt(c, sfx, item.start, -6, item.anchorWord);
    c.notes.push({ op: "text", text: `Text “${item.text.replace(/\*/g, "").replace(/\n/g, " ")}” at ${fmt(item.start)}` });
  },
  add_graphic(c, i) {
    const shape = oneOf(i.shape, SHAPES);
    if (!shape) throw new Error("unknown shape");
    const at = resolveStart(c, shape === "progress" ? { start_sec: 0, ...i } : i);
    const total = durationSec(c.t);
    const item = makeShape(shape, at.start, resolveDuration(c, i, at.start, shape === "progress" ? total : 2));
    Object.assign(item, at);
    for (const k of ["x", "y", "w", "h", "rotation", "opacity"] as const) if (isNum(i[k])) item[k] = i[k] as number;
    if (isStr(i.color)) item.color = i.color;
    if (isStr(i.color2)) item.color2 = i.color2;
    item.animIn = anim(i.anim_in) ?? item.animIn;
    item.animOut = anim(i.anim_out) ?? item.animOut;
    c.p.items.push(item);
    c.notes.push({ op: "graphic", text: `${shape[0].toUpperCase()}${shape.slice(1)} at ${fmt(item.start)}` });
  },
  add_transition(c, i) {
    const kind = oneOf(i.kind, TRANSITIONS);
    if (!kind) throw new Error("unknown transition");
    const dur = isNum(i.duration_sec) ? clamp(i.duration_sec, 0.1, 2) : kind === "dip-black" ? 0.5 : 0.3;
    const cuts = cutPoints(c.t);
    const cuts0 = cutPoints(c.t0); // at_cut numbers refer to the cut list the AI was shown
    let times: number[] = [];
    if (i.every_cut) times = cuts;
    else if (isNum(i.at_cut) && cuts0[Math.round(i.at_cut)] !== undefined) times = [remap(c, cuts0[Math.round(i.at_cut)])];
    else if (isStr(i.at_word) && wordOutputTime(c.t, i.at_word) !== null) times = [wordOutputTime(c.t, i.at_word)!];
    else if (isNum(i.at_sec)) times = [remap(c, i.at_sec)];
    else {
      // Nearest cut to the playhead.
      const here = remap(c, c.ctx.playhead);
      const near = cuts.reduce<number | null>((best, t) => (best === null || Math.abs(t - here) < Math.abs(best - here) ? t : best), null);
      times = [near ?? here];
    }
    if (!times.length) throw new Error("there are no cuts to put a transition on yet");
    for (const t of times) {
      const item: TransitionItem = { id: uid("tr"), type: "transition", kind, start: Math.max(0, t - dur / 2), duration: dur, color: isStr(i.color) ? i.color : "#FFFFFF" };
      c.p.items.push(item);
    }
    c.notes.push({ op: "transition", text: `${kind} transition${times.length > 1 ? ` on ${times.length} cuts` : ` at ${fmt(times[0] ?? 0)}`}` });
  },
  add_sfx(c, i) {
    const sound = oneOf(i.sound, SFX_IDS);
    if (!sound) throw new Error("unknown sound");
    const volume = isNum(i.volume_db) ? clamp(i.volume_db, -40, 0) : -6;
    const on = oneOf(i.on, ["texts", "transitions", "zooms"] as const);
    if (on) {
      const placed = placeItems(c.p.items, c.t);
      const targets = placed.filter(({ item }) =>
        on === "texts" ? item.type === "text" : on === "transitions" ? item.type === "transition" : item.type === "adjust" && item.motion,
      );
      for (const { item, start } of targets) {
        const at = item.type === "transition" ? start + item.duration / 2 - 0.15 : start;
        addSfxAt(c, sound, at, volume, item.type === "transition" ? undefined : item.anchorWord);
      }
      c.notes.push({ op: "sfx", text: `${sound} on ${targets.length} ${on}` });
      return;
    }
    let at = c.ctx.playhead;
    let anchor: string | undefined;
    if (isStr(i.at_word) && wordOutputTime(c.t, i.at_word) !== null) {
      at = wordOutputTime(c.t, i.at_word)!;
      anchor = i.at_word;
    } else if (isNum(i.at_sec)) at = remap(c, i.at_sec);
    else at = remap(c, at);
    addSfxAt(c, sound, at, volume, anchor);
    c.notes.push({ op: "sfx", text: `${sound} at ${fmt(at)}` });
  },
  add_animation(c, i) {
    const asset = isStr(i.asset_id) ? c.p.assets.find((a) => a.id === i.asset_id) : undefined;
    if (isStr(i.asset_id) && (!asset || asset.kind === "audio")) throw new Error(`unknown animation ${i.asset_id}`);
    const prompt = isStr(i.prompt) ? i.prompt.trim().slice(0, 600) : "";
    if (!asset && !prompt) throw new Error("give an asset_id or a prompt");
    const at = resolveStart(c, i);
    const fit = oneOf(i.fit, ["overlay", "fullscreen"] as const) ?? "overlay";
    const fallback = asset ? (asset.kind === "image" ? 2.5 : asset.durationSec) : 3;
    const item: AnimationItem = {
      id: uid("an"),
      type: "animation",
      ...at,
      duration: Math.min(resolveDuration(c, i, at.start, fallback), asset?.kind === "video" ? asset.durationSec : 30),
      prompt: prompt || asset!.note || asset!.name,
      status: asset ? "ready" : "placeholder",
      assetId: asset?.id,
      fit,
      x: isNum(i.x) ? clamp(i.x, 0, 100) : 50,
      y: isNum(i.y) ? clamp(i.y, 0, 100) : 40,
      width: isNum(i.width) ? clamp(i.width, 10, 100) : 60,
      aspect: asset && asset.width && asset.height ? asset.width / asset.height : 1,
      opacity: 100,
      trimStart: 0,
      animIn: anim(i.anim_in) ?? (fit === "fullscreen" ? "fade" : "pop"),
      animOut: anim(i.anim_out) ?? "fade",
    };
    c.p.items.push(item);
    c.notes.push({ op: "animation", text: asset ? `Animation “${asset.name}” at ${fmt(item.start)}` : `Animation placeholder at ${fmt(item.start)}: “${prompt.length > 60 ? `${prompt.slice(0, 58)}…` : prompt}”` });
  },
  add_broll(c, i) {
    const asset = c.p.assets.find((a) => a.id === i.asset_id);
    if (!asset || asset.kind === "audio") throw new Error("unknown image or video");
    const at = resolveStart(c, i);
    const fit = oneOf(i.fit, ["cover", "contain", "pip"] as const) ?? "cover";
    const item: MediaItem = {
      id: uid("m"),
      type: "media",
      assetId: asset.id,
      ...at,
      duration: Math.min(resolveDuration(c, i, at.start, asset.kind === "image" ? 2.5 : Math.min(3, asset.durationSec)), asset.kind === "video" ? asset.durationSec : 600),
      trimStart: 0,
      fit,
      x: isNum(i.x) ? i.x : fit === "pip" ? 72 : 50,
      y: isNum(i.y) ? i.y : fit === "pip" ? 30 : 50,
      scale: isNum(i.scale) ? clamp(i.scale, 0.1, 1) : fit === "pip" ? 0.42 : 1,
      radius: fit === "pip" ? 24 : 0,
      opacity: 100,
      volume: isNum(i.volume_db) ? clamp(i.volume_db, -60, 0) : -60,
      animIn: anim(i.anim_in) ?? (fit === "pip" ? "pop" : "fade"),
      animOut: anim(i.anim_out) ?? "fade",
      kenBurns: typeof i.ken_burns === "boolean" ? i.ken_burns : asset.kind === "image",
    };
    c.p.items.push(item);
    c.notes.push({ op: "broll", text: `B-roll “${asset.name}” at ${fmt(item.start)}` });
  },
  set_music(c, i) {
    if (i.asset_id === null) {
      c.p.items = c.p.items.filter((it) => it.type !== "music");
      c.notes.push({ op: "music", text: "Music removed" });
      return;
    }
    const asset = c.p.assets.find((a) => a.id === i.asset_id && (a.kind === "audio" || a.hasAudio));
    if (!asset) throw new Error("unknown audio");
    c.p.items = c.p.items.filter((it) => it.type !== "music");
    const item: MusicItem = {
      id: uid("mu"),
      type: "music",
      assetId: asset.id,
      start: 0,
      duration: durationSec(c.t),
      trimStart: 0,
      volume: isNum(i.volume_db) ? clamp(i.volume_db, -60, 0) : -18,
      duck: typeof i.duck === "boolean" ? i.duck : true,
      fadeIn: isNum(i.fade_in) ? i.fade_in : 0.5,
      fadeOut: isNum(i.fade_out) ? i.fade_out : 1.5,
    };
    c.p.items.push(item);
    c.notes.push({ op: "music", text: `Music “${asset.name}” at ${item.volume} dB${item.duck ? ", ducked under speech" : ""}` });
  },
  set_captions(c, i) {
    let next: CaptionStyle = { ...c.p.captions };
    const preset = oneOf(i.preset, CAPTION_PRESET_IDS);
    if (preset) next = captionPreset(preset, next);
    if (typeof i.enabled === "boolean") next.enabled = i.enabled;
    const font = oneOf(i.font, FONT_IDS);
    if (font) next.font = font;
    if (isNum(i.size)) next.size = clamp(i.size, 24, 200);
    if (isStr(i.color)) next.color = i.color;
    if (isStr(i.active_color)) next.activeColor = i.active_color;
    if (isStr(i.emphasis_color)) next.emphasisColor = i.emphasis_color;
    if (isStr(i.stroke_color)) next.strokeColor = i.stroke_color;
    if (isNum(i.stroke_width)) next.strokeWidth = clamp(i.stroke_width, 0, 40);
    if (i.background === null || isStr(i.background)) next.background = (i.background as string | null) || null;
    if (i.active_box === null || isStr(i.active_box)) next.activeBox = (i.active_box as string | null) || null;
    if (isNum(i.y)) next.y = clamp(i.y, 5, 95);
    if (isNum(i.max_words)) next.maxWordsPerPage = clamp(Math.round(i.max_words), 1, 10);
    if (typeof i.uppercase === "boolean") next.uppercase = i.uppercase;
    const a = oneOf(i.animation, CAPTION_ANIMS);
    if (a) next.animation = a;
    if (typeof i.shadow === "boolean") next.shadow = i.shadow;
    c.p.captions = next;
    c.notes.push({ op: "captions", text: next.enabled ? `Captions: ${CAPTION_PRESETS[next.preset].label}${preset ? "" : " (adjusted)"}` : "Captions off" });
    rebuild(c);
  },
  set_video(c, i) {
    const v = { ...c.p.video };
    if (isNum(i.focus_x)) v.focusX = clamp(i.focus_x, 0, 100);
    if (isNum(i.focus_y)) v.focusY = clamp(i.focus_y, 0, 100);
    if (isNum(i.scale)) v.scale = clamp(i.scale, 0.3, 4);
    if (isNum(i.rotation)) v.rotation = clamp(i.rotation, -180, 180);
    if (isNum(i.volume_db)) v.volume = clamp(i.volume_db, -60, 0);
    const fit = oneOf(i.fit, ["cover", "contain"] as const);
    if (fit) v.fit = fit;
    c.p.video = v;
    c.notes.push({ op: "video", text: "Video framing and level updated" });
  },
  update_item(c, i) {
    const item = c.p.items.find((it) => it.id === i.id);
    if (!item) throw new Error(`unknown layer ${String(i.id)}`);
    if (isStr(i.start_word) || isNum(i.start_sec)) {
      const at = resolveStart(c, i);
      item.start = at.start;
      item.anchorWord = at.anchorWord;
      item.anchorOffset = at.anchorOffset;
    }
    if (isStr(i.end_word) && wordIndex(c.p, i.end_word) < 0) throw new Error(`unknown word ${i.end_word}`);
    if (isNum(i.duration_sec) || isStr(i.end_word) || isNum(i.end_sec)) item.duration = resolveDuration(c, i, itemStart(item, c.t), item.duration);
    if (typeof i.hidden === "boolean") item.hidden = i.hidden;
    switch (item.type) {
      case "text":
        if (isStr(i.text)) item.text = c.ctx.allowLists ? i.text.replace(/\\n/g, "\n") : withoutListMarkers(i.text.replace(/\\n/g, "\n"));
        if (oneOf(i.preset, TEXT_PRESET_IDS)) {
          const fresh = makeText(i.preset as TextItem["preset"], item.text, item.start);
          Object.assign(item, { preset: fresh.preset, style: fresh.style, x: fresh.x, y: fresh.y, width: fresh.width, animIn: fresh.animIn, animOut: fresh.animOut });
        }
        applyTextFields(item, i);
        break;
      case "shape":
        for (const k of ["x", "y", "w", "h", "rotation", "opacity"] as const) if (isNum(i[k])) item[k] = i[k] as number;
        if (isStr(i.color)) item.color = i.color;
        if (isStr(i.color2)) item.color2 = i.color2;
        item.animIn = anim(i.anim_in) ?? item.animIn;
        item.animOut = anim(i.anim_out) ?? item.animOut;
        break;
      case "media":
        for (const k of ["x", "y", "opacity"] as const) if (isNum(i[k])) item[k] = i[k] as number;
        if (isNum(i.scale)) item.scale = clamp(i.scale, 0.1, 3);
        if (isNum(i.volume_db)) item.volume = clamp(i.volume_db, -60, 0);
        item.animIn = anim(i.anim_in) ?? item.animIn;
        item.animOut = anim(i.anim_out) ?? item.animOut;
        break;
      case "adjust":
        if (i.grade) item.grade = { ...item.grade, ...gradeFrom(i.grade) };
        if (i.effects) item.effects = { ...item.effects, ...effectsFrom(i.effects) };
        if (item.motion && isNum(i.scale)) item.motion = { ...item.motion, scale: clamp(i.scale, 1, 3) };
        break;
      case "transition":
        item.kind = oneOf(i.kind, TRANSITIONS) ?? item.kind;
        if (isStr(i.color)) item.color = i.color;
        break;
      case "sfx":
        item.sound = oneOf(i.sound, SFX_IDS) ?? item.sound;
        if (isNum(i.volume_db)) item.volume = clamp(i.volume_db, -40, 0);
        break;
      case "music":
        if (isNum(i.volume_db)) item.volume = clamp(i.volume_db, -60, 0);
        break;
      case "animation":
        for (const k of ["x", "y", "opacity"] as const) if (isNum(i[k])) item[k] = clamp(i[k] as number, 0, 100);
        if (isNum(i.width)) item.width = clamp(i.width, 10, 100);
        if (isStr(i.prompt) && i.prompt.trim()) item.prompt = i.prompt.trim().slice(0, 600);
        item.fit = oneOf(i.fit, ["overlay", "fullscreen"] as const) ?? item.fit;
        item.animIn = anim(i.anim_in) ?? item.animIn;
        item.animOut = anim(i.anim_out) ?? item.animOut;
        break;
    }
    c.notes.push({ op: "update", text: `Updated ${describeItem(item)}` });
  },
  remove_items(c, i) {
    const ids = new Set((Array.isArray(i.ids) ? i.ids : []) as string[]);
    const type = i.type as ItemType | undefined;
    const before = c.p.items.length;
    c.p.items = c.p.items.filter((it) => !ids.has(it.id) && it.type !== type);
    c.notes.push({ op: "remove", text: `Removed ${before - c.p.items.length} layer${before - c.p.items.length === 1 ? "" : "s"}` });
  },
  rename_project(c, i) {
    if (isStr(i.name) && i.name.trim()) c.p.name = i.name.trim().slice(0, 80);
  },
};

// On-screen text is not a slide deck: list markers ("01", "1.", "Step 2", "#3", "•") are taken off, and a
// layer that would only show a step number is refused. Real figures ("3x", "+38%", "$49") are untouched.
const BULLET = "[•·▪●○◦■►▶➤→✓✔☑]";
const ORDINAL = String.raw`(?:0\d|#\s?\d{1,2}|\d{1,2}\s*[.)]|(?:step|tip|point|part|rule|passo|punto|parte|regola)\s*#?\d{1,2}\s*[.:)]?)`;
const MARKER_LINE = new RegExp(String.raw`^\s*\*?\s*(?:${ORDINAL}|${BULLET}|-)\s*\*?\s*[:.\-–—]?\s*$`, "i");
const MARKER_PREFIX = new RegExp(String.raw`^(\s*\*?)\s*(?:${ORDINAL}|${BULLET}|-)\s*\*?\s*[:\-–—]?\s+(?=\S)`, "i");
export function withoutListMarkers(text: string): string {
  const lines = text.split("\n");
  const kept = lines.filter((l) => !MARKER_LINE.test(l));
  if (!kept.some((l) => l.replace(/[*\s]/g, ""))) throw new Error("on-screen numbering and bullet points are not used; show a real figure or a short phrase instead");
  return kept
    .map((l) => {
      const m = l.match(MARKER_PREFIX);
      if (!m) return l;
      // "*01* Start" -> "Start"; an asterisk that opened an accent span before the marker stays open.
      const stars = m[0].match(/\*/g)?.length ?? 0;
      return `${stars % 2 === 1 ? "*" : ""}${l.slice(m[0].length)}`;
    })
    .join("\n");
}

// One typographic system per video: titles, numbers and the rest take the font (and, for titles, the whole
// look) of the video's first title, unless the request sets a style explicitly.
const TITLE_LIKE: TextPresetId[] = ["hook", "title", "number"];
function houseStyle(p: Project, preset: TextPresetId): Partial<TextStyle> {
  if (preset === "quote") return {};
  const texts = p.items.filter((it): it is TextItem => it.type === "text");
  const lead = texts.find((t) => TITLE_LIKE.includes(t.preset)) ?? texts[0];
  if (!lead) return {};
  const ls = lead.style;
  if (!TITLE_LIKE.includes(preset) || ls.background) return { font: ls.font, weight: ls.weight };
  return {
    font: ls.font,
    weight: ls.weight,
    uppercase: ls.uppercase,
    italic: ls.italic,
    color: ls.color,
    accentColor: ls.accentColor,
    strokeColor: ls.strokeColor,
    strokeWidth: preset === "number" ? Math.min(ls.strokeWidth, 10) : ls.strokeWidth,
    shadow: ls.shadow,
    letterSpacing: ls.letterSpacing,
  };
}

// A new text layer replaces whatever text sits in the same spot: an earlier one ends when it appears (or
// is removed if almost nothing of it would be left), and the new one ends before a later one there.
function makeRoomFor(c: Ctx, item: TextItem) {
  const placed = placeItems(c.p.items, c.t, true);
  const mine = placed.find((p) => p.item === item);
  if (!mine) return;
  const drop = new Set<string>();
  for (const p of placed) {
    if (p.item === item || p.item.type !== "text") continue;
    const other = p.item;
    const sameSpot = Math.abs(other.x - item.x) < 30 && Math.abs(other.y - item.y) < 18;
    if (!sameSpot || p.end <= mine.start || p.start >= mine.end) continue;
    if (p.start < mine.start - 0.6) {
      other.duration = mine.start - p.start;
      c.notes.push({ op: "text", text: `Shortened ${describeItem(other)} so it ends when the new text appears` });
    } else if (p.start <= mine.start + 0.05) {
      drop.add(other.id);
      c.notes.push({ op: "remove", text: `Replaced ${describeItem(other)} (same place and time)` });
    } else item.duration = Math.max(0.4, p.start - mine.start);
  }
  if (drop.size) c.p.items = c.p.items.filter((it) => !drop.has(it.id));
}

function applyTextFields(item: TextItem, i: In) {
  const pos = oneOf(i.position, POSITIONS);
  if (pos) item.y = POS_Y[pos];
  for (const k of ["x", "y", "width", "rotation", "opacity"] as const) if (isNum(i[k])) item[k] = clamp(i[k] as number, k === "rotation" ? -180 : 0, k === "rotation" ? 180 : 100);
  if (i.style) item.style = { ...item.style, ...styleFrom(i.style) };
  item.animIn = anim(i.anim_in) ?? item.animIn;
  item.animOut = anim(i.anim_out) ?? item.animOut;
}

export function describeItem(item: Item): string {
  switch (item.type) {
    case "text":
      return `text “${item.text.replace(/\*/g, "").replace(/\n/g, " ").slice(0, 40)}”`;
    case "shape":
      return item.shape;
    case "media":
      return "b-roll";
    case "adjust":
      return item.name ?? (item.motion ? "zoom" : "adjustment layer");
    case "transition":
      return `${item.kind} transition`;
    case "sfx":
      return `${item.sound} sound`;
    case "music":
      return "music";
    case "animation":
      return `animation “${item.prompt.slice(0, 40)}”`;
  }
}

const clone = <T,>(v: T): T => structuredClone(v);

// Applies operations in order. A bad operation is skipped and reported, the rest still apply.
export function applyOps(project: Project, ops: Op[], ctx: OpContext): { project: Project; notes: ChangeNote[]; errors: string[] } {
  const p = clone(project);
  const src = mainAsset(p)?.durationSec ?? 0;
  const t = buildTimeline(p, src, FPS);
  const c: Ctx = { p, t, t0: t, src, ctx, notes: [] };
  const errors: string[] = [];
  for (const op of ops) {
    const handler = HANDLERS[op.name];
    if (!handler) {
      errors.push(`Unknown operation ${op.name}`);
      continue;
    }
    try {
      handler(c, (op.input ?? {}) as In);
    } catch (e) {
      errors.push(`${op.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Music follows the edit length.
  const total = durationSec(buildTimeline(p, src, FPS));
  for (const it of p.items) if (it.type === "music") it.duration = Math.max(0.5, total - it.start);
  return { project: p, notes: c.notes, errors };
}

// ---------- the project as the AI reads it ----------

export function describeForAI(p: Project, ctx: OpContext): string {
  const src = mainAsset(p)?.durationSec ?? 0;
  const t = buildTimeline(p, src, FPS);
  const timed = new Map(t.words.map((w) => [w.id, w]));
  const lines: string[] = [];
  lines.push(`Project: ${p.name}`);
  lines.push(`Format: ${p.format}. Raw length ${src.toFixed(1)} s, current edit ${durationSec(t).toFixed(1)} s, ${t.clips.length} clips.`);
  lines.push(`Playhead: ${ctx.playhead.toFixed(2)} s${ctx.selectedItemId ? `. Selected layer: ${ctx.selectedItemId}` : ""}.`);
  lines.push(`Pacing: pauses over ${p.settings.maxPauseSec} s are trimmed.`);
  lines.push(`Brief: ${fullBrief(p).trim() || "(none)"}`);

  lines.push("\nMedia:");
  for (const a of p.assets) {
    lines.push(
      `- ${a.id} ${a.kind}${a.id === p.mainAssetId ? " (MAIN VIDEO)" : ""}${a.role === "animation" ? " ANIMATION" : ""} "${a.name}" ${a.kind !== "image" ? `${a.durationSec.toFixed(1)} s` : ""} ${a.width}x${a.height}${a.note ? ` note: ${JSON.stringify(a.note)}` : ""}`,
    );
  }

  const g = resolveGrade(p.grade);
  const changed = Object.entries(p.grade).filter(([k, v]) => (NEUTRAL_GRADE as unknown as Record<string, unknown>)[k] !== v);
  lines.push(`\nColour (global): ${changed.length ? changed.map(([k, v]) => `${k}=${v}`).join(", ") : "neutral"}${g.mono ? " (black and white)" : ""}`);
  const cap = p.captions;
  lines.push(
    `Captions: ${cap.enabled ? `on, preset ${cap.preset}, font ${cap.font} ${cap.size}px, y ${cap.y}, ${cap.maxWordsPerPage} words, animation ${cap.animation}, colours ${cap.color}/${cap.activeColor}/${cap.emphasisColor}` : "off"}`,
  );
  lines.push(`Video: focus ${p.video.focusX},${p.video.focusY} scale ${p.video.scale} volume ${p.video.volume} dB`);

  const cuts = cutPoints(t);
  lines.push(`\nCut points (output s): ${cuts.length ? cuts.map((s, i) => `#${i} ${s.toFixed(2)}`).join(", ") : "none"}`);

  const placed = placeItems(p.items, t, true);
  lines.push("\nLayers:");
  if (!placed.length) lines.push("(none)");
  for (const { item, start, end } of placed) {
    const extra =
      item.type === "text"
        ? ` preset=${item.preset} text=${JSON.stringify(item.text)} x=${item.x} y=${item.y} font=${item.style.font} size=${item.style.size} in=${item.animIn} out=${item.animOut}`
        : item.type === "adjust"
          ? `${item.motion ? ` zoom ${item.motion.scale} ${item.motion.ease}` : ""}${item.grade ? ` grade=${JSON.stringify(item.grade)}` : ""}${item.effects ? ` effects=${JSON.stringify(item.effects)}` : ""}`
          : item.type === "shape"
            ? ` shape=${item.shape} color=${item.color} x=${item.x} y=${item.y}`
            : item.type === "media"
              ? ` asset=${item.assetId} fit=${item.fit}`
              : item.type === "animation"
                ? ` ${item.status}${item.assetId ? ` asset=${item.assetId}` : ""} fit=${item.fit} x=${item.x} y=${item.y} width=${item.width} prompt=${JSON.stringify(item.prompt)}`
              : item.type === "transition"
                ? ` kind=${item.kind}`
                : item.type === "sfx"
                  ? ` sound=${item.sound} ${item.volume} dB`
                  : ` asset=${item.assetId} ${item.volume} dB duck=${item.duck}`;
    lines.push(`- ${item.id} ${item.type} ${start.toFixed(2)}-${end.toFixed(2)} s${item.anchorWord ? ` (on ${item.anchorWord})` : ""}${item.hidden ? " hidden" : ""}${extra}`);
  }

  lines.push("\nTranscript (id, source time, output time or CUT, word). Key words marked *:");
  const emphasis = new Set(p.emphasis);
  p.words.forEach((w, i) => {
    const prev = p.words[i - 1];
    if (prev && w.start - prev.end >= 0.5) lines.push(`(pause ${(w.start - prev.end).toFixed(1)} s)`);
    const tw = timed.get(w.id);
    // Sound events are not in the timeline's word list; place them by their source time instead.
    const evAt = w.kind === "audio_event" ? sourceToOutput(t, w.start) : null;
    const where = p.cuts[w.id] ? `CUT:${p.cuts[w.id]}` : tw ? `@${(tw.startMs / 1000).toFixed(2)}` : evAt !== null ? `@${evAt.toFixed(2)}` : "CUT:range";
    const label = w.kind === "audio_event" ? `[sound: ${w.text}]` : w.text;
    lines.push(`${w.id} ${w.start.toFixed(2)} ${where} ${label}${emphasis.has(w.id) ? " *" : ""}`);
  });
  return lines.join("\n");
}
