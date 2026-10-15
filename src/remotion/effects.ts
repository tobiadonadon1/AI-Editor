import type { EffectDescriptor } from "remotion";
import { colorCorrection } from "@remotion/effects/color-correction";
import { vignette } from "@remotion/effects/vignette";
import { noise } from "@remotion/effects/noise";
import { glow } from "@remotion/effects/glow";
import { grayscale } from "@remotion/effects/grayscale";
import { blur } from "@remotion/effects/blur";
import { zoomBlur } from "@remotion/effects/zoom-blur";
import { chromaticAberration } from "@remotion/effects/chromatic-aberration";
import { pixelate } from "@remotion/effects/pixelate";
import { lightLeak } from "@remotion/effects/light-leak";
import { shine } from "@remotion/effects/shine";
import type { Effects } from "../shared/project";
import type { resolveGrade } from "../shared/presets";

export type ResolvedGrade = ReturnType<typeof resolveGrade>;

export interface FrameFx extends Effects {
  whip: number; // horizontal motion blur for whip pans
  leakProgress: number;
  shineProgress: number;
}

export const emptyFx = (): FrameFx => ({
  blur: 0,
  zoomBlur: 0,
  chromatic: 0,
  mono: 0,
  shine: false,
  lightLeak: 0,
  pixelate: 0,
  glitch: 0,
  whip: 0,
  leakProgress: 0.5,
  shineProgress: 0.5,
});

const isNeutral = (g: ResolvedGrade) =>
  g.temperature === 0 &&
  g.tint === 0 &&
  g.exposure === 0 &&
  g.contrast === 0 &&
  g.highlights === 0 &&
  g.shadows === 0 &&
  g.whites === 0 &&
  g.blacks === 0 &&
  g.saturation === 100 &&
  g.vibrance === 0;

// Lumetri units -> shader parameters. Tuned so the panel's ranges feel like Premiere's.
export function videoEffects(g: ResolvedGrade, fx: FrameFx, frame: number): EffectDescriptor[] {
  const list: EffectDescriptor[] = [];
  if (!isNeutral(g)) {
    list.push(
      colorCorrection({
        exposure: g.exposure,
        contrast: 1 + g.contrast / 125,
        shadows: (g.shadows / 100) * 0.6,
        highlights: (g.highlights / 100) * 0.6,
        whites: (g.whites / 100) * 0.5,
        blacks: (g.blacks / 100) * 0.5,
        temperature: (g.temperature / 100) * 0.45,
        tint: (g.tint / 100) * 0.4,
        saturation: g.saturation / 100,
        vibrance: g.vibrance / 100,
      }),
    );
  }
  const mono = Math.max(g.mono, fx.mono);
  if (mono > 0) list.push(grayscale({ amount: mono / 100 }));
  if (g.glow > 0) list.push(glow({ radius: 28, intensity: (g.glow / 100) * 0.9, threshold: 0.72 }));
  if (fx.blur > 0.5) list.push(blur({ radius: fx.blur }));
  if (fx.whip > 0.5) list.push(blur({ radius: fx.whip, vertical: false }));
  if (fx.zoomBlur > 0.5) list.push(zoomBlur({ amount: fx.zoomBlur }));
  if (fx.pixelate >= 2) list.push(pixelate({ blockSize: fx.pixelate }));
  if (fx.chromatic > 0.5) list.push(chromaticAberration({ amount: fx.chromatic, angle: 0 }));
  if (fx.lightLeak > 0) list.push(lightLeak({ progress: fx.leakProgress, seed: 3 }));
  if (fx.shine) list.push(shine({ progress: fx.shineProgress }));
  if (g.vignette > 0) list.push(vignette({ amount: (g.vignette / 100) * 0.85, radius: 0.55, feather: 0.5 }));
  if (g.grain > 0) list.push(noise({ amount: (g.grain / 100) * 0.22, seed: frame % 97 }));
  return list;
}
