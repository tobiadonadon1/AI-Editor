import type { Anim } from "../shared/project";

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t: number, s = 1.9) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
export const easeOutElastic = (t: number) =>
  t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;

// Deterministic noise, so preview and export glitch the same way.
export const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export interface AnimState {
  opacity: number;
  transform: string;
  filter?: string;
  clipPath?: string;
  reveal: number; // 0..1, for typewriter and word-by-word
  glitch: number;
}

// p is 0 (hidden) to 1 (fully on). "in" plays forwards, "out" plays the same curve backwards.
export function animState(anim: Anim, p: number, phase: "in" | "out", frame: number): AnimState {
  const t = clamp01(p);
  const e = easeOutCubic(t);
  const base: AnimState = { opacity: 1, transform: "", reveal: 1, glitch: 0 };
  if (t >= 1 || anim === "none") return base;
  const dir = phase === "in" ? 1 : -1;
  switch (anim) {
    case "fade":
      return { ...base, opacity: e };
    case "pop":
      return { ...base, opacity: clamp01(t * 3), transform: `scale(${phase === "in" ? 0.4 + 0.6 * easeOutBack(t) : 0.7 + 0.3 * e})` };
    case "scale":
      return { ...base, opacity: e, transform: `scale(${1.5 - 0.5 * e})` };
    case "slide-up":
      return { ...base, opacity: e, transform: `translateY(${(1 - e) * 90 * dir}px)` };
    case "slide-down":
      return { ...base, opacity: e, transform: `translateY(${-(1 - e) * 90 * dir}px)` };
    case "slide-left":
      return { ...base, opacity: e, transform: `translateX(${(1 - e) * 140 * dir}px)` };
    case "slide-right":
      return { ...base, opacity: e, transform: `translateX(${-(1 - e) * 140 * dir}px)` };
    case "blur":
      return { ...base, opacity: e, filter: `blur(${(1 - e) * 24}px)`, transform: `scale(${1.08 - 0.08 * e})` };
    case "typewriter":
    case "words":
      return { ...base, reveal: t };
    case "wipe":
      return phase === "in"
        ? { ...base, clipPath: `inset(0 ${(1 - e) * 100}% 0 0)` }
        : { ...base, clipPath: `inset(0 0 0 ${(1 - e) * 100}%)` };
    case "bounce":
      return { ...base, opacity: clamp01(t * 4), transform: `translateY(${(1 - easeOutElastic(t)) * 160}px) scale(${0.85 + 0.15 * e})` };
    case "glitch": {
      const j = (1 - t) * 40;
      return { ...base, opacity: hash(frame) > 0.25 || t > 0.7 ? 1 : 0.3, transform: `translate(${(hash(frame + 1) - 0.5) * j}px, ${(hash(frame + 2) - 0.5) * j * 0.4}px)`, glitch: 1 - t };
    }
  }
  return base;
}

// Progress of an item's entrance and exit at a given time inside it.
export function inOut(local: number, duration: number, animDuration: number) {
  const d = Math.min(animDuration, duration / 2);
  return {
    pin: d > 0 ? clamp01(local / d) : 1,
    pout: d > 0 ? clamp01((duration - local) / d) : 1,
  };
}

export function combine(a: AnimState, b: AnimState): AnimState {
  return {
    opacity: a.opacity * b.opacity,
    transform: `${a.transform} ${b.transform}`.trim(),
    filter: [a.filter, b.filter].filter(Boolean).join(" ") || undefined,
    clipPath: a.clipPath ?? b.clipPath,
    reveal: Math.min(a.reveal, b.reveal),
    glitch: Math.max(a.glitch, b.glitch),
  };
}
