// The project file is the single source of truth for an edit.
// The AI writes operations against it, the editor UI changes it, and the
// same Remotion composition previews and exports it.

export const FPS = 30;

export const FORMATS = {
  "9:16": { width: 1080, height: 1920, label: "Vertical 9:16", use: "Reels, TikTok, Shorts, Stories" },
  "4:5": { width: 1080, height: 1350, label: "Portrait 4:5", use: "Instagram and Facebook feed ads" },
  "1:1": { width: 1080, height: 1080, label: "Square 1:1", use: "Feed posts, LinkedIn" },
  "16:9": { width: 1920, height: 1080, label: "Landscape 16:9", use: "YouTube, websites, decks" },
} as const;
export type FormatId = keyof typeof FORMATS;
export const FORMAT_IDS = Object.keys(FORMATS) as FormatId[];

export type AssetKind = "video" | "image" | "audio";

export interface MediaAsset {
  id: string;
  name: string;
  kind: AssetKind;
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  size: number;
  proxy?: boolean; // a lighter editing copy was made in the browser
  cloud?: string; // where the edit copy is stored for this account (a Blob path, or a site URL for the sample)
  role?: "animation"; // a ready-made animation from the creator (kept as is: no proxy, so transparency survives)
  note?: string; // the creator's note on where to use it
}

export type WordKind = "word" | "audio_event";

export interface Word {
  id: string;
  text: string;
  start: number; // seconds in the main source video
  end: number;
  kind: WordKind;
}

export const CUT_REASONS = ["retake", "false_start", "filler", "stumble", "off_brief", "pause", "manual"] as const;
export type CutReason = (typeof CUT_REASONS)[number];

// A stretch of the main source removed by hand (razor + ripple delete) or by the AI.
export interface RangeCut {
  id: string;
  start: number; // source seconds
  end: number;
  reason: CutReason;
}

export interface EditSettings {
  maxPauseSec: number; // pauses longer than this are cut out
  padBeforeSec: number;
  padAfterSec: number;
}

// Lumetri-style colour, in the units Premiere shows.
export interface Grade {
  temperature: number; // -100..100
  tint: number; // -100..100
  exposure: number; // -4..4 stops
  contrast: number; // -100..100
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  saturation: number; // 0..200, 100 = unchanged
  vibrance: number; // -100..100
  look: LookId | null;
  lookIntensity: number; // 0..100
  vignette: number; // 0..100
  grain: number; // 0..100
  glow: number; // 0..100
}

export const LOOK_IDS = [
  "clean-bright",
  "warm-film",
  "teal-orange",
  "cool-cinematic",
  "moody",
  "vintage-fade",
  "punchy",
  "mono-contrast",
  "golden-hour",
  "matte-pastel",
] as const;
export type LookId = (typeof LOOK_IDS)[number];

export interface VideoSettings {
  focusX: number; // 0..100, where the frame is centred when reframing
  focusY: number;
  scale: number; // 1 = fill the frame
  rotation: number; // degrees
  opacity: number; // 0..100
  volume: number; // dialogue gain in dB, -30..12
  fit: "cover" | "contain";
}

export const CAPTION_PRESET_IDS = [
  "bold-pop",
  "hormozi",
  "karaoke",
  "boxed",
  "clean",
  "neon",
  "minimal",
  "typewriter",
] as const;
export type CaptionPresetId = (typeof CAPTION_PRESET_IDS)[number];

export const CAPTION_ANIMS = ["pop", "bounce", "karaoke", "fade", "typewriter", "slide", "none"] as const;
export type CaptionAnim = (typeof CAPTION_ANIMS)[number];

export interface CaptionStyle {
  enabled: boolean;
  preset: CaptionPresetId;
  font: FontId;
  size: number; // px at 1080 wide
  color: string;
  activeColor: string; // the word being spoken
  emphasisColor: string; // key words
  strokeColor: string;
  strokeWidth: number;
  background: string | null; // box behind the line
  activeBox: string | null; // box behind the spoken word
  y: number; // 0..100, vertical centre of the caption
  maxWordsPerPage: number;
  uppercase: boolean;
  animation: CaptionAnim;
  shadow: boolean;
}

export const FONT_IDS = [
  "Montserrat",
  "Inter",
  "Anton",
  "Bebas Neue",
  "Poppins",
  "Oswald",
  "Archivo Black",
  "Playfair Display",
  "DM Serif Display",
  "Space Grotesk",
  "Permanent Marker",
  "Bangers",
  "Roboto Mono",
  "Lora",
] as const;
export type FontId = (typeof FONT_IDS)[number];

export const ANIMS = [
  "none",
  "fade",
  "pop",
  "slide-up",
  "slide-down",
  "slide-left",
  "slide-right",
  "scale",
  "blur",
  "typewriter",
  "words",
  "wipe",
  "bounce",
  "glitch",
] as const;
export type Anim = (typeof ANIMS)[number];

export const TEXT_PRESET_IDS = [
  "hook",
  "title",
  "lower-third",
  "callout",
  "headline-bar",
  "number",
  "quote",
  "cta",
  "label",
  "subtitle-box",
] as const;
export type TextPresetId = (typeof TEXT_PRESET_IDS)[number];

export interface TextStyle {
  font: FontId;
  size: number; // px at 1080 wide
  weight: number;
  color: string;
  accentColor: string; // *starred* words use this colour
  strokeColor: string;
  strokeWidth: number;
  background: string | null;
  padding: number;
  radius: number;
  shadow: boolean;
  uppercase: boolean;
  italic: boolean;
  letterSpacing: number; // em/100
  align: "left" | "center" | "right";
  lineHeight: number;
}

export const SHAPES = ["box", "circle", "underline", "arrow", "progress", "gradient", "frame"] as const;
export type Shape = (typeof SHAPES)[number];

export const TRANSITIONS = ["flash", "dip-black", "zoom-punch", "glitch", "whip", "blur", "light-leak", "shake"] as const;
export type TransitionKind = (typeof TRANSITIONS)[number];

export const SFX_IDS = ["whoosh", "pop", "click", "swoosh-up", "impact", "ding", "riser", "camera", "typing", "bass-drop"] as const;
export type SfxId = (typeof SFX_IDS)[number];

export interface Effects {
  blur: number; // px
  zoomBlur: number; // px
  chromatic: number; // px
  mono: number; // 0..100
  shine: boolean;
  lightLeak: number; // 0..100
  pixelate: number; // px
  glitch: number; // 0..100
}

export interface Motion {
  scale: number; // 1 = 100%
  x: number; // focus point 0..100
  y: number;
  rotation: number;
  ease: "smooth" | "punch" | "push" | "pull" | "drift";
}

interface ItemBase {
  id: string;
  start: number; // seconds on the output timeline
  duration: number;
  anchorWord?: string; // follows this word when cuts change the timeline
  anchorOffset?: number;
  name?: string;
  hidden?: boolean;
}

export interface TextItem extends ItemBase {
  type: "text";
  text: string; // *word* = accent colour, new lines allowed
  preset: TextPresetId;
  style: TextStyle;
  x: number; // centre, 0..100 of frame width
  y: number; // centre, 0..100 of frame height
  width: number; // max width, 0..100 of frame width
  rotation: number;
  opacity: number;
  animIn: Anim;
  animOut: Anim;
  animDuration: number; // seconds
}

export interface ShapeItem extends ItemBase {
  type: "shape";
  shape: Shape;
  color: string;
  color2: string;
  x: number;
  y: number;
  w: number; // 0..100 of frame width
  h: number; // 0..100 of frame height
  rotation: number;
  opacity: number;
  thickness: number;
  animIn: Anim;
  animOut: Anim;
}

export interface MediaItem extends ItemBase {
  type: "media";
  assetId: string;
  trimStart: number; // seconds into the asset
  fit: "cover" | "contain" | "pip";
  x: number;
  y: number;
  scale: number;
  radius: number;
  opacity: number;
  volume: number; // dB
  animIn: Anim;
  animOut: Anim;
  kenBurns: boolean;
}

export interface AdjustItem extends ItemBase {
  type: "adjust";
  grade?: Partial<Grade>;
  effects?: Partial<Effects>;
  motion?: Motion;
  fade: number; // seconds to ease in and out
}

export interface TransitionItem extends ItemBase {
  type: "transition";
  kind: TransitionKind;
  color: string;
}

export interface SfxItem extends ItemBase {
  type: "sfx";
  sound: SfxId;
  volume: number; // dB
}

// A motion graphic on its own track. It starts as a placeholder (a description of what it should show) and
// becomes a real animation when the animation API returns one, or when the creator drops in a file.
export const ANIMATION_STATUSES = ["placeholder", "generating", "ready", "failed"] as const;
export type AnimationStatus = (typeof ANIMATION_STATUSES)[number];

export interface AnimationItem extends ItemBase {
  type: "animation";
  prompt: string; // what the animation shows, sent to the animation API
  status: AnimationStatus;
  assetId?: string; // the finished animation
  job?: { id: string; provider: string; startedAt: string; assetId: string }; // assetId: where the result will be kept
  error?: string;
  fit: "overlay" | "fullscreen";
  x: number; // centre, 0..100 of frame width (overlay)
  y: number;
  width: number; // 0..100 of frame width (overlay)
  aspect: number; // width / height of the box while it is a placeholder
  opacity: number;
  trimStart: number;
  animIn: Anim;
  animOut: Anim;
}

export interface MusicItem extends ItemBase {
  type: "music";
  assetId: string;
  trimStart: number;
  volume: number; // dB
  duck: boolean; // lower under speech
  fadeIn: number;
  fadeOut: number;
}

export type Item = TextItem | ShapeItem | MediaItem | AdjustItem | TransitionItem | SfxItem | MusicItem | AnimationItem;
export type ItemType = Item["type"];

// Lanes, top to bottom, as the timeline shows them. Each item type has its own lane.
export const LANES: { id: string; label: string; name: string; types: ItemType[]; kind: "video" | "audio" | "captions" }[] = [
  { id: "C1", label: "C1", name: "Captions", types: [], kind: "captions" },
  { id: "V7", label: "V7", name: "Transitions", types: ["transition"], kind: "video" },
  { id: "V6", label: "V6", name: "Text", types: ["text"], kind: "video" },
  { id: "V5", label: "V5", name: "Animations", types: ["animation"], kind: "video" },
  { id: "V4", label: "V4", name: "Graphics", types: ["shape"], kind: "video" },
  { id: "V3", label: "V3", name: "Adjustment", types: ["adjust"], kind: "video" },
  { id: "V2", label: "V2", name: "B-roll", types: ["media"], kind: "video" },
  { id: "V1", label: "V1", name: "Video", types: [], kind: "video" },
  { id: "A1", label: "A1", name: "Dialogue", types: [], kind: "audio" },
  { id: "A2", label: "A2", name: "Music", types: ["music"], kind: "audio" },
  { id: "A3", label: "A3", name: "SFX", types: ["sfx"], kind: "audio" },
];

// "setup": created, and the creator is still adding the video and choosing options before the first cut.
export type ProjectStatus = "setup" | "empty" | "importing" | "transcribing" | "planning" | "ready" | "error";

export const STYLE_IDS = ["auto", "ugc-ad", "educational", "podcast", "product-demo", "hormozi", "cinematic-vlog"] as const;
export type StyleId = (typeof STYLE_IDS)[number];

// What the creator chose in the setup steps. The first cut follows these; the captions choice is enforced.
export interface SetupOptions {
  style: StyleId;
  captions: { enabled: boolean; preset: CaptionPresetId | null }; // null = let the AI pick
  ownAnimations: boolean;
  generateAnimations: boolean;
  instructions: string;
}

export const DEFAULT_SETUP: SetupOptions = { style: "auto", captions: { enabled: true, preset: null }, ownAnimations: false, generateAnimations: false, instructions: "" };

export interface ChangeNote {
  op: string;
  text: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  changes?: ChangeNote[];
  undoable?: boolean;
  error?: boolean;
  pending?: boolean;
}

export interface Project {
  version: 2;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  brief: string;
  format: FormatId;
  status: ProjectStatus;
  statusDetail?: string;
  error?: string;
  mainAssetId?: string;
  assets: MediaAsset[];
  words: Word[];
  language?: string;
  cuts: Record<string, CutReason>; // word id -> why it was removed
  rangeCuts: RangeCut[];
  splits: number[]; // source seconds where V1 is split without removing anything
  emphasis: string[]; // word ids shown as key words in captions
  settings: EditSettings;
  grade: Grade;
  video: VideoSettings;
  captions: CaptionStyle;
  items: Item[];
  chat: ChatMessage[];
  summary?: string;
  setup?: SetupOptions;
}

export const DEFAULT_SETTINGS: EditSettings = { maxPauseSec: 0.35, padBeforeSec: 0.08, padAfterSec: 0.14 };

export const NEUTRAL_GRADE: Grade = {
  temperature: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  saturation: 100,
  vibrance: 0,
  look: null,
  lookIntensity: 100,
  vignette: 0,
  grain: 0,
  glow: 0,
};

export const DEFAULT_VIDEO: VideoSettings = { focusX: 50, focusY: 50, scale: 1, rotation: 0, opacity: 100, volume: 0, fit: "cover" };

export const DEFAULT_CAPTIONS: CaptionStyle = {
  enabled: true,
  preset: "bold-pop",
  font: "Montserrat",
  size: 84,
  color: "#FFFFFF",
  activeColor: "#FFE14D",
  emphasisColor: "#3FE07A",
  strokeColor: "#000000",
  strokeWidth: 12,
  background: null,
  activeBox: null,
  y: 72,
  maxWordsPerPage: 3,
  uppercase: true,
  animation: "pop",
  shadow: true,
};

export const NEUTRAL_EFFECTS: Effects = {
  blur: 0,
  zoomBlur: 0,
  chromatic: 0,
  mono: 0,
  shine: false,
  lightLeak: 0,
  pixelate: 0,
  glitch: 0,
};

export function newProject(id: string, name: string, brief: string, format: FormatId): Project {
  const now = new Date().toISOString();
  return {
    version: 2,
    id,
    name: name || "Untitled",
    createdAt: now,
    updatedAt: now,
    brief,
    format,
    status: "empty",
    assets: [],
    words: [],
    cuts: {},
    rangeCuts: [],
    splits: [],
    emphasis: [],
    settings: { ...DEFAULT_SETTINGS },
    grade: { ...NEUTRAL_GRADE },
    video: { ...DEFAULT_VIDEO },
    captions: { ...DEFAULT_CAPTIONS },
    items: [],
    chat: [],
  };
}

export const mainAsset = (p: Project) => p.assets.find((a) => a.id === p.mainAssetId);

// Props passed to the Remotion composition, both in the browser player and when exporting.
export interface EditVideoProps {
  project: Project;
  media: Record<string, string>; // asset id -> URL
  sfx: Record<string, string>; // sound id -> URL
  placeholders?: boolean; // draw empty animation placeholders (the editor's monitor, never the export)
  [key: string]: unknown;
}

export const uid = (prefix = "") => `${prefix}${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

export const dbToGain = (db: number) => Math.pow(10, db / 20);
