import * as Montserrat from "@remotion/google-fonts/Montserrat";
import * as Inter from "@remotion/google-fonts/Inter";
import * as Anton from "@remotion/google-fonts/Anton";
import * as BebasNeue from "@remotion/google-fonts/BebasNeue";
import * as Poppins from "@remotion/google-fonts/Poppins";
import * as Oswald from "@remotion/google-fonts/Oswald";
import * as ArchivoBlack from "@remotion/google-fonts/ArchivoBlack";
import * as PlayfairDisplay from "@remotion/google-fonts/PlayfairDisplay";
import * as DMSerifDisplay from "@remotion/google-fonts/DMSerifDisplay";
import * as SpaceGrotesk from "@remotion/google-fonts/SpaceGrotesk";
import * as PermanentMarker from "@remotion/google-fonts/PermanentMarker";
import * as Bangers from "@remotion/google-fonts/Bangers";
import * as RobotoMono from "@remotion/google-fonts/RobotoMono";
import * as Lora from "@remotion/google-fonts/Lora";
import type { FontId, Project } from "../shared/project";

interface FontModule {
  loadFont: (style?: never, options?: { weights?: string[]; subsets?: string[] }) => { fontFamily: string };
  getInfo: () => { fontFamily: string; fonts: Record<string, Record<string, unknown>> };
}

const MODULES: Record<FontId, FontModule> = {
  Montserrat,
  Inter,
  Anton,
  "Bebas Neue": BebasNeue,
  Poppins,
  Oswald,
  "Archivo Black": ArchivoBlack,
  "Playfair Display": PlayfairDisplay,
  "DM Serif Display": DMSerifDisplay,
  "Space Grotesk": SpaceGrotesk,
  "Permanent Marker": PermanentMarker,
  Bangers,
  "Roboto Mono": RobotoMono,
  Lora,
} as unknown as Record<FontId, FontModule>;

const WANTED = ["400", "600", "700", "800", "900"];
const loaded = new Map<string, string>();

// Loads a font the first time a layer uses it; rendering waits until it is ready.
export function font(id: FontId, italic = false): string {
  const key = `${id}:${italic ? "i" : "n"}`;
  const hit = loaded.get(key);
  if (hit) return hit;
  const mod = MODULES[id] ?? MODULES.Inter;
  const info = mod.getInfo();
  const style = italic && info.fonts.italic ? "italic" : "normal";
  const available = Object.keys(info.fonts[style] ?? info.fonts.normal ?? {});
  const weights = available.filter((w) => WANTED.includes(w));
  const { fontFamily } = mod.loadFont(style as never, { weights: weights.length ? weights : available, subsets: ["latin"] });
  loaded.set(key, fontFamily);
  return fontFamily;
}

// Before an export or a still: load every face the project uses, so no frame is drawn with a fallback font.
export async function preloadFonts(project: Project) {
  if (typeof document === "undefined") return;
  const specs = new Set<string>();
  if (project.captions.enabled) specs.add(`900 100px "${font(project.captions.font)}"`);
  for (const it of project.items) {
    if (it.type !== "text") continue;
    const s = it.style;
    specs.add(`${s.italic ? "italic " : ""}${s.weight} 100px "${font(s.font, s.italic)}"`);
  }
  await Promise.all([...specs].map((spec) => document.fonts.load(spec).catch(() => undefined)));
}
