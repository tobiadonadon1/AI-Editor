import {
  DEFAULT_CAPTIONS,
  NEUTRAL_GRADE,
  uid,
  type Anim,
  type CaptionPresetId,
  type CaptionStyle,
  type Grade,
  type LookId,
  type Project,
  type StyleId,
  type Shape,
  type ShapeItem,
  type TextItem,
  type TextPresetId,
  type TextStyle,
} from "./project.js";

type NumericGrade = Omit<Grade, "look" | "lookIntensity">;

// Creative looks: offsets added on top of the basic correction, scaled by intensity.
export const LOOKS: Record<LookId, { label: string; delta: Partial<NumericGrade>; mono?: number; swatch: [string, string] }> = {
  "clean-bright": { label: "Clean Bright", delta: { exposure: 0.25, contrast: 8, shadows: 18, whites: 10, vibrance: 15 }, swatch: ["#f4efe6", "#8fb7d9"] },
  "warm-film": { label: "Warm Film", delta: { temperature: 28, tint: 6, contrast: 12, blacks: 10, saturation: -8, grain: 18 }, swatch: ["#e9a25b", "#5b3b2a"] },
  "teal-orange": { label: "Teal & Orange", delta: { temperature: 12, tint: -6, contrast: 20, vibrance: 30, shadows: -8, highlights: -10 }, swatch: ["#f19a4b", "#1f6f78"] },
  "cool-cinematic": { label: "Cool Cinematic", delta: { temperature: -24, contrast: 22, highlights: -18, saturation: -12, vignette: 30 }, swatch: ["#7fa6c9", "#1a2533"] },
  moody: { label: "Moody", delta: { exposure: -0.35, contrast: 26, shadows: -20, highlights: -24, saturation: -22, vignette: 45 }, swatch: ["#4d5560", "#141619"] },
  "vintage-fade": { label: "Vintage Fade", delta: { temperature: 16, contrast: -18, blacks: 30, saturation: -25, grain: 30 }, swatch: ["#d8c3a0", "#7b6a58"] },
  punchy: { label: "Punchy Social", delta: { contrast: 24, vibrance: 40, saturation: 12, whites: 12, blacks: -10 }, swatch: ["#ff5f6d", "#ffc371"] },
  "mono-contrast": { label: "B&W Contrast", delta: { contrast: 30, whites: 10, blacks: -12, saturation: -100 }, mono: 100, swatch: ["#e8e8e8", "#1b1b1b"] },
  "golden-hour": { label: "Golden Hour", delta: { temperature: 40, tint: 8, exposure: 0.15, highlights: -12, vibrance: 18, glow: 20 }, swatch: ["#ffc66b", "#b4553a"] },
  "matte-pastel": { label: "Matte Pastel", delta: { contrast: -14, blacks: 24, saturation: -10, vibrance: 10, tint: 6 }, swatch: ["#f5c9d7", "#a8d8ea"] },
};

const NUMERIC_KEYS = Object.keys(NEUTRAL_GRADE).filter((k) => k !== "look" && k !== "lookIntensity") as (keyof NumericGrade)[];

const LIMITS: Record<keyof NumericGrade, [number, number]> = {
  temperature: [-100, 100],
  tint: [-100, 100],
  exposure: [-4, 4],
  contrast: [-100, 100],
  highlights: [-100, 100],
  shadows: [-100, 100],
  whites: [-100, 100],
  blacks: [-100, 100],
  saturation: [0, 200],
  vibrance: [-100, 100],
  vignette: [0, 100],
  grain: [0, 100],
  glow: [0, 100],
};
export const GRADE_LIMITS = LIMITS;

// The grade with its look folded in, plus any adjustment layers on top.
export function resolveGrade(base: Grade, layers: Partial<Grade>[] = []): NumericGrade & { mono: number } {
  const out = Object.fromEntries(NUMERIC_KEYS.map((k) => [k, base[k]])) as NumericGrade;
  let mono = 0;
  const addLook = (look: LookId | null | undefined, intensity: number) => {
    if (!look || !LOOKS[look]) return;
    const k = intensity / 100;
    for (const [key, v] of Object.entries(LOOKS[look].delta)) out[key as keyof NumericGrade] += (v as number) * k;
    mono = Math.max(mono, (LOOKS[look].mono ?? 0) * k);
  };
  addLook(base.look, base.lookIntensity);
  for (const layer of layers) {
    for (const key of NUMERIC_KEYS) {
      const v = layer[key];
      if (typeof v !== "number") continue;
      // Layers add their difference from neutral, the way an adjustment layer stacks.
      out[key] += v - NEUTRAL_GRADE[key];
    }
    addLook(layer.look, layer.lookIntensity ?? 100);
  }
  for (const key of NUMERIC_KEYS) out[key] = Math.min(LIMITS[key][1], Math.max(LIMITS[key][0], out[key]));
  return { ...out, mono };
}

export const CAPTION_PRESETS: Record<CaptionPresetId, { label: string; style: Partial<CaptionStyle> }> = {
  "bold-pop": { label: "Bold Pop", style: { font: "Montserrat", size: 84, color: "#FFFFFF", activeColor: "#FFE14D", emphasisColor: "#3FE07A", strokeColor: "#000000", strokeWidth: 12, background: null, activeBox: null, uppercase: true, animation: "pop", shadow: true, maxWordsPerPage: 3 } },
  hormozi: { label: "Hormozi", style: { font: "Montserrat", size: 92, color: "#FFFFFF", activeColor: "#FFE600", emphasisColor: "#22FF5A", strokeColor: "#000000", strokeWidth: 16, background: null, activeBox: null, uppercase: true, animation: "bounce", shadow: true, maxWordsPerPage: 2 } },
  karaoke: { label: "Karaoke", style: { font: "Poppins", size: 72, color: "#FFFFFF", activeColor: "#FFFFFF", emphasisColor: "#FFD43B", strokeColor: "#000000", strokeWidth: 0, background: null, activeBox: "#7C3AED", uppercase: false, animation: "karaoke", shadow: true, maxWordsPerPage: 4 } },
  boxed: { label: "Boxed", style: { font: "Inter", size: 64, color: "#111111", activeColor: "#111111", emphasisColor: "#E11D48", strokeColor: "#000000", strokeWidth: 0, background: "#FFFFFF", activeBox: null, uppercase: false, animation: "fade", shadow: false, maxWordsPerPage: 5 } },
  clean: { label: "Clean", style: { font: "Inter", size: 62, color: "#FFFFFF", activeColor: "#FFFFFF", emphasisColor: "#FFFFFF", strokeColor: "#000000", strokeWidth: 0, background: "rgba(0,0,0,0.55)", activeBox: null, uppercase: false, animation: "fade", shadow: false, maxWordsPerPage: 6 } },
  neon: { label: "Neon", style: { font: "Bebas Neue", size: 110, color: "#E9FBFF", activeColor: "#00E5FF", emphasisColor: "#FF2BD6", strokeColor: "#001018", strokeWidth: 6, background: null, activeBox: null, uppercase: true, animation: "pop", shadow: true, maxWordsPerPage: 3 } },
  minimal: { label: "Minimal", style: { font: "Space Grotesk", size: 58, color: "#FFFFFF", activeColor: "#FFFFFF", emphasisColor: "#FFFFFF", strokeColor: "#000000", strokeWidth: 0, background: null, activeBox: null, uppercase: false, animation: "slide", shadow: true, maxWordsPerPage: 5 } },
  typewriter: { label: "Typewriter", style: { font: "Roboto Mono", size: 58, color: "#FFFFFF", activeColor: "#FFFFFF", emphasisColor: "#FFB020", strokeColor: "#000000", strokeWidth: 0, background: "rgba(0,0,0,0.7)", activeBox: null, uppercase: false, animation: "typewriter", shadow: false, maxWordsPerPage: 6 } },
};

export function captionPreset(id: CaptionPresetId, keep?: CaptionStyle): CaptionStyle {
  return {
    ...DEFAULT_CAPTIONS,
    ...CAPTION_PRESETS[id].style,
    preset: id,
    enabled: keep?.enabled ?? true,
    y: keep?.y ?? DEFAULT_CAPTIONS.y,
  };
}

const BASE_TEXT: TextStyle = {
  font: "Montserrat",
  size: 96,
  weight: 900,
  color: "#FFFFFF",
  accentColor: "#FFE14D",
  strokeColor: "#000000",
  strokeWidth: 0,
  background: null,
  padding: 24,
  radius: 14,
  shadow: true,
  uppercase: false,
  italic: false,
  letterSpacing: 0,
  align: "center",
  lineHeight: 1.05,
};

export const TEXT_PRESETS: Record<
  TextPresetId,
  { label: string; hint: string; sample: string; style: Partial<TextStyle>; x: number; y: number; width: number; animIn: Anim; animOut: Anim; duration: number }
> = {
  hook: { label: "Hook title", hint: "Big opening line, first 2 s", sample: "Stop *scrolling*", style: { size: 118, weight: 900, uppercase: true, strokeWidth: 14, accentColor: "#FFE14D" }, x: 50, y: 24, width: 86, animIn: "pop", animOut: "fade", duration: 2.4 },
  title: { label: "Title", hint: "Clean centred title", sample: "The *3* rules", style: { font: "Inter", size: 96, weight: 800 }, x: 50, y: 50, width: 80, animIn: "blur", animOut: "fade", duration: 2.5 },
  "lower-third": { label: "Lower third", hint: "Name and role", sample: "Alex Rivera\nFounder, Northwind", style: { font: "Inter", size: 52, weight: 700, align: "left", background: "rgba(10,10,12,0.82)", padding: 28, radius: 10, shadow: false, accentColor: "#4CC9F0" }, x: 36, y: 80, width: 60, animIn: "slide-right", animOut: "slide-left", duration: 3.5 },
  callout: { label: "Callout", hint: "Short keyword pop-up", sample: "*+38%* sales", style: { size: 88, weight: 900, background: "#FFE14D", color: "#111111", accentColor: "#E11D48", padding: 22, radius: 18, shadow: true }, x: 50, y: 38, width: 70, animIn: "bounce", animOut: "scale", duration: 1.6 },
  "headline-bar": { label: "Headline bar", hint: "Full-width news strip", sample: "BREAKING: we cut 40% of the fluff", style: { font: "Oswald", size: 60, weight: 700, uppercase: true, background: "#E11D48", padding: 22, radius: 0, shadow: false }, x: 50, y: 14, width: 100, animIn: "wipe", animOut: "fade", duration: 3 },
  number: { label: "Big number", hint: "A figure from the speech", sample: "*3x*", style: { font: "Anton", size: 260, weight: 400, strokeWidth: 0, accentColor: "#FFE14D" }, x: 50, y: 34, width: 60, animIn: "scale", animOut: "fade", duration: 1.8 },
  quote: { label: "Quote", hint: "Pull quote in serif", sample: "“Make it *simple*.”", style: { font: "Playfair Display", size: 84, weight: 700, italic: true, shadow: true }, x: 50, y: 46, width: 82, animIn: "words", animOut: "fade", duration: 3.2 },
  cta: { label: "Call to action", hint: "End card button", sample: "Link in bio →", style: { font: "Poppins", size: 72, weight: 800, background: "#FFFFFF", color: "#111111", padding: 30, radius: 999, shadow: true }, x: 50, y: 78, width: 74, animIn: "pop", animOut: "fade", duration: 3 },
  label: { label: "Label", hint: "Small tag", sample: "NEW", style: { font: "Space Grotesk", size: 44, weight: 700, uppercase: true, letterSpacing: 12, background: "rgba(0,0,0,0.6)", padding: 14, radius: 8, shadow: false }, x: 50, y: 18, width: 50, animIn: "slide-down", animOut: "fade", duration: 2 },
  "subtitle-box": { label: "Subtitle box", hint: "Plain sentence on a box", sample: "Here is what nobody tells you", style: { font: "Inter", size: 58, weight: 600, background: "rgba(0,0,0,0.65)", padding: 20, radius: 12, shadow: false }, x: 50, y: 64, width: 84, animIn: "fade", animOut: "fade", duration: 2.5 },
};

export function makeText(preset: TextPresetId, text: string | undefined, start: number, opts: Partial<TextItem> = {}): TextItem {
  const p = TEXT_PRESETS[preset];
  return {
    id: uid("t"),
    type: "text",
    start,
    duration: p.duration,
    text: text ?? p.sample,
    preset,
    style: { ...BASE_TEXT, ...p.style },
    x: p.x,
    y: p.y,
    width: p.width,
    rotation: 0,
    opacity: 100,
    animIn: p.animIn,
    animOut: p.animOut,
    animDuration: 0.35,
    ...opts,
  };
}

export const SHAPE_LABELS: Record<Shape, string> = {
  box: "Highlight box",
  circle: "Circle",
  underline: "Underline",
  arrow: "Arrow",
  progress: "Progress bar",
  gradient: "Gradient backer",
  frame: "Frame border",
};

export function makeShape(shape: Shape, start: number, duration: number, opts: Partial<ShapeItem> = {}): ShapeItem {
  const geometry: Record<Shape, Pick<ShapeItem, "x" | "y" | "w" | "h">> = {
    box: { x: 50, y: 50, w: 60, h: 14 },
    circle: { x: 50, y: 45, w: 34, h: 0 },
    underline: { x: 50, y: 60, w: 50, h: 2 },
    arrow: { x: 50, y: 55, w: 22, h: 0 },
    progress: { x: 50, y: 1, w: 100, h: 1.2 },
    gradient: { x: 50, y: 85, w: 100, h: 35 },
    frame: { x: 50, y: 50, w: 94, h: 96 },
  };
  return {
    id: uid("s"),
    type: "shape",
    shape,
    start,
    duration,
    color: shape === "gradient" ? "#000000" : "#FFE14D",
    color2: "#FF5F6D",
    ...geometry[shape],
    rotation: 0,
    opacity: 100,
    thickness: 10,
    animIn: shape === "progress" || shape === "gradient" ? "fade" : "pop",
    animOut: "fade",
    ...opts,
  };
}

// Editing styles offered when a project is set up. The text goes to the AI as part of the brief.
export const STYLES: Record<StyleId, { label: string; hint: string; text: string }> = {
  auto: { label: "Let the AI decide", hint: "Reads the footage and picks", text: "" },
  "ugc-ad": { label: "UGC ad", hint: "Hook, fast, CTA", text: "Direct-response UGC ad: strong hook in the first second, fast pacing, bold captions with key words, punch-in zooms, product benefits as short callouts, and a clear call to action at the end." },
  educational: { label: "Educational", hint: "Calm and clear", text: "Educational explainer: clear and calm pacing, clean captions, one hook title naming the topic, a callout only for a key figure or term, subtle zooms." },
  podcast: { label: "Podcast clip", hint: "Best 30-60 s", text: "Podcast clip: keep the best 30-60 seconds, cut filler, karaoke captions, a hook title naming the topic, light warm grade." },
  "product-demo": { label: "Product demo", hint: "Features, clean look", text: "Product demo: tight cuts, callouts for features, clean bright look, lower third with the product name, CTA at the end." },
  hormozi: { label: "Hormozi style", hint: "Very fast, bold caps", text: "Hormozi style: very fast, no pauses, 2-word captions in big bold caps with green and yellow key words, constant punch-ins, pops on keywords." },
  "cinematic-vlog": { label: "Cinematic vlog", hint: "Relaxed, filmic", text: "Cinematic vlog: relaxed pacing, teal and orange look with grain, minimal captions, elegant serif title at the start." },
};

// Everything the creator chose during setup, written as the brief for the first cut (and later turns).
export function fullBrief(p: Project): string {
  const s = p.setup;
  if (!s) return p.brief;
  const parts: string[] = [];
  if (s.instructions.trim()) parts.push(`Creator's instructions: ${s.instructions.trim()}`);
  if (s.style !== "auto") parts.push(`Style: ${STYLES[s.style].label}. ${STYLES[s.style].text}`);
  parts.push(
    !s.captions.enabled
      ? "Captions: off. The creator does not want captions; do not turn them on."
      : s.captions.preset
        ? `Captions: on, preset ${s.captions.preset}, chosen by the creator (keep that preset; you may mark key words).`
        : "Captions: on; pick the preset that fits.",
  );
  const own = p.assets.filter((a) => a.role === "animation");
  if (own.length)
    parts.push(
      `The creator's own animations (place every one with add_animation and its asset_id, where its note says or where it fits best): ${own.map((a) => `${a.id} "${a.name}"${a.note ? ` (${a.note})` : ""}`).join("; ")}.`,
    );
  if (s.generateAnimations)
    parts.push("Generated animations: add 2-4 animation placeholders (add_animation with a prompt) where a motion graphic makes a point clearer; the animation service creates them after the cut.");
  return parts.join("\n");
}
