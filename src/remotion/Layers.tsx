import { useEffect, useState } from "react";
import { AbsoluteFill, continueRender, delayRender, useCurrentFrame, useVideoConfig } from "remotion";
import type { ShapeItem, TextItem } from "../shared/project";
import { animState, combine, inOut, type AnimState } from "./anim";
import { font } from "./fonts";

// Splits "Stop *scrolling*\nnow" into lines of plain and accent runs.
export function parseRich(text: string): { text: string; accent: boolean }[][] {
  return text.split("\n").map((line) => {
    const parts: { text: string; accent: boolean }[] = [];
    line.split(/(\*[^*]+\*)/g).forEach((s) => {
      if (!s) return;
      const accent = s.startsWith("*") && s.endsWith("*") && s.length > 2;
      parts.push({ text: accent ? s.slice(1, -1) : s, accent });
    });
    return parts;
  });
}

// Text is measured with a canvas so a layer can shrink until every word fits inside the frame.
let measureCtx: CanvasRenderingContext2D | null | undefined;
function measure(text: string, spec: string): number {
  if (measureCtx === undefined) measureCtx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * 55; // rough width at 100px
  measureCtx.font = spec;
  return measureCtx.measureText(text).width;
}

// Re-measures once the web font has arrived; rendering waits for it.
function useFontReady(spec: string) {
  const [ready, setReady] = useState(() => typeof document === "undefined" || document.fonts.check(spec));
  useEffect(() => {
    if (ready) return;
    let live = true;
    let open = true;
    const handle = delayRender(`Loading font ${spec}`, { timeoutInMilliseconds: 15000 });
    const done = () => {
      if (open) continueRender(handle);
      open = false;
    };
    document.fonts.load(spec).then(() => live && setReady(true), () => live && setReady(true)).finally(done);
    return () => {
      live = false;
      done();
    };
  }, [spec, ready]);
  return ready;
}

// "*1*\nBought a blackboard" in a big-number layer: the figure stays big, the label under it is set small.
export const isNumberWithLabel = (item: TextItem) => {
  if (item.preset !== "number") return false;
  const lines = item.text.split("\n");
  return lines.length > 1 && lines[0].replace(/\*/g, "").trim().length <= 6;
};
const LABEL_SCALE = 0.3;

interface Fit {
  size: number; // px
  lineHeight: number;
  boxWidth: number; // px
  x: number; // % of frame width
  y: number; // % of frame height
}

// Largest size up to the requested one at which no word overflows the box and the block fits the frame,
// with the box kept inside a safe margin.
function fitText(item: TextItem, family: string, W: number, H: number, k: number): Fit {
  const s = item.style;
  const marginX = 0.04 * W;
  const marginY = 0.05 * H;
  const boxWidth = Math.min((item.width / 100) * W, W - 2 * marginX);
  const padX = s.background ? s.padding * k : 0;
  const padY = s.background ? s.padding * k * 0.6 : 0;
  const stroke = s.strokeWidth ? s.strokeWidth * 2 * k : 0;
  const avail = Math.max(20, (boxWidth - 2 * padX - stroke) * 0.97);
  const spec = (px: number) => `${s.italic ? "italic " : ""}${s.weight} ${px}px "${family}"`;
  const at100 = spec(100);
  const spacing = s.letterSpacing / 100; // em
  const width100 = (t: string) => {
    const shown = s.uppercase ? t.toUpperCase() : t;
    return measure(shown, at100) + spacing * 100 * shown.length;
  };
  const labelled = isNumberWithLabel(item);
  const lines = parseRich(item.text).map((runs, i) => ({ text: runs.map((r) => r.text).join(""), scale: labelled && i > 0 ? LABEL_SCALE : 1 }));
  // Tall display faces collide across lines when set too tight, mostly through descenders.
  const lineHeight = Math.max(s.lineHeight, s.uppercase ? 1.0 : 1.12);

  let size = s.size * k;
  for (const line of lines)
    for (const word of line.text.split(/\s+/).filter(Boolean)) {
      const w = (width100(word) / 100) * line.scale;
      if (w * size > avail) size = avail / w;
    }
  const height = (px: number) => {
    let h = 0;
    for (const line of lines) {
      const words = line.text.split(/\s+/).filter(Boolean);
      let rows = 1;
      let current = "";
      for (const word of words) {
        const next = current ? `${current} ${word}` : word;
        if (current && (width100(next) / 100) * line.scale * px > avail) {
          rows++;
          current = word;
        } else current = next;
      }
      h += rows * px * line.scale * lineHeight;
    }
    return h + 2 * padY;
  };
  const maxH = 0.72 * H;
  for (let n = 0; n < 16 && height(size) > maxH; n++) size *= 0.92;

  const h = height(size);
  const halfW = (boxWidth / 2 / W) * 100;
  const halfH = (h / 2 / H) * 100;
  const x = Math.min(100 - halfW - (marginX / W) * 100, Math.max(halfW + (marginX / W) * 100, item.x));
  const y = Math.min(100 - halfH - (marginY / H) * 100, Math.max(halfH + (marginY / H) * 100, item.y));
  return { size, lineHeight, boxWidth, x: halfW * 2 > 100 - 8 ? 50 : x, y: halfH * 2 > 100 - 10 ? 50 : y };
}

const useScale = () => {
  const { width, height } = useVideoConfig();
  return Math.min(width, height) / 1080;
};

function itemAnim(frame: number, fps: number, duration: number, animIn: TextItem["animIn"], animOut: TextItem["animOut"], animDuration: number): AnimState {
  const local = frame / fps;
  const { pin, pout } = inOut(local, duration, animDuration);
  return combine(animState(animIn, pin, "in", frame), animState(animOut, pout, "out", frame));
}

export const TextLayer: React.FC<{ item: TextItem; duration: number }> = ({ item, duration }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const k = useScale();
  const s = item.style;
  const family = font(s.font, s.italic);
  const fontReady = useFontReady(`${s.italic ? "italic " : ""}${s.weight} 100px "${family}"`);
  const fit = fitText(item, family, width, height, k);
  void fontReady; // measuring again after the font loads is what this re-render is for
  const labelled = isNumberWithLabel(item);
  const typing = item.animIn === "typewriter" || item.animIn === "words";
  // Typing reveals take longer than a simple entrance.
  const lines = parseRich(item.text);
  const totalChars = lines.flat().reduce((n, r) => n + r.text.length, 0);
  const totalWords = lines.flat().reduce((n, r) => n + r.text.split(/\s+/).filter(Boolean).length, 0);
  const revealDur = item.animIn === "typewriter" ? Math.min(duration * 0.6, totalChars * 0.035) : item.animIn === "words" ? Math.min(duration * 0.6, totalWords * 0.14) : item.animDuration;
  const a = itemAnim(frame, fps, duration, item.animIn, item.animOut, item.animDuration);
  const reveal = typing ? Math.min(1, frame / fps / Math.max(0.01, revealDur)) : a.reveal;

  let charBudget = Math.round(reveal * totalChars);
  let wordBudget = Math.ceil(reveal * totalWords);
  const glitchShadow = a.glitch > 0 ? `${6 * a.glitch * k}px 0 rgba(255,0,80,0.85), ${-6 * a.glitch * k}px 0 rgba(0,240,255,0.85)` : "";
  const shadow = s.shadow && !s.background ? `0 ${6 * k}px ${26 * k}px rgba(0,0,0,0.55)` : "";

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        data-item-id={item.id}
        style={{
          position: "absolute",
          left: `${fit.x}%`,
          top: `${fit.y}%`,
          width: fit.boxWidth,
          transform: `translate(-50%, -50%) rotate(${item.rotation}deg) ${a.transform}`,
          opacity: a.opacity * (item.opacity / 100),
          filter: a.filter,
          clipPath: a.clipPath,
          display: "flex",
          justifyContent: s.align === "left" ? "flex-start" : s.align === "right" ? "flex-end" : "center",
        }}
      >
        <div
          style={{
            display: "inline-block",
            fontFamily: family,
            fontSize: fit.size,
            fontWeight: s.weight,
            fontStyle: s.italic ? "italic" : "normal",
            lineHeight: fit.lineHeight,
            letterSpacing: `${s.letterSpacing / 100}em`,
            textTransform: s.uppercase ? "uppercase" : "none",
            textAlign: s.align,
            color: s.color,
            background: s.background ?? undefined,
            padding: s.background ? `${s.padding * k * 0.6}px ${s.padding * k}px` : 0,
            borderRadius: s.radius * k,
            boxShadow: s.background && s.shadow ? `0 ${10 * k}px ${30 * k}px rgba(0,0,0,0.35)` : undefined,
            WebkitTextStroke: s.strokeWidth ? `${s.strokeWidth * 2 * k}px ${s.strokeColor}` : undefined,
            paintOrder: "stroke fill",
            textShadow: [shadow, glitchShadow].filter(Boolean).join(", ") || undefined,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {lines.map((line, li) => (
            <div key={li} style={labelled && li > 0 ? { fontSize: `${LABEL_SCALE}em`, marginTop: "0.25em", WebkitTextStroke: s.strokeWidth ? `${s.strokeWidth * 2 * k * LABEL_SCALE}px ${s.strokeColor}` : undefined } : undefined}>
              {line.map((run, ri) => {
                let shown = run.text;
                if (item.animIn === "typewriter" && reveal < 1) {
                  shown = run.text.slice(0, Math.max(0, charBudget));
                  charBudget -= run.text.length;
                } else if (item.animIn === "words" && reveal < 1) {
                  const words = run.text.split(/(\s+)/);
                  let out = "";
                  for (const w of words) {
                    if (/^\s+$/.test(w)) out += w;
                    else if (wordBudget > 0) {
                      out += w;
                      wordBudget--;
                    } else out += w.replace(/./g, " ");
                  }
                  shown = out;
                }
                return (
                  <span key={ri} style={{ color: run.accent ? s.accentColor : undefined }}>
                    {shown}
                  </span>
                );
              })}
              {line.length === 0 ? " " : null}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const ShapeLayer: React.FC<{ item: ShapeItem; duration: number }> = ({ item, duration }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const k = useScale();
  const local = frame / fps;
  const a = itemAnim(frame, fps, duration, item.animIn, item.animOut, 0.35);
  const draw = Math.min(1, local / 0.45); // stroke draw-on for line shapes
  const w = (item.w / 100) * width;
  const h = (item.h / 100) * height;
  const t = item.thickness * k;
  const tag = { "data-item-id": item.id };
  const common: React.CSSProperties = {
    position: "absolute",
    left: `${item.x}%`,
    top: `${item.y}%`,
    transform: `translate(-50%, -50%) rotate(${item.rotation}deg) ${a.transform}`,
    opacity: a.opacity * (item.opacity / 100),
    filter: a.filter,
  };

  switch (item.shape) {
    case "box":
      return <div {...tag} style={{ ...common, width: w, height: h, border: `${t}px solid ${item.color}`, borderRadius: 18 * k, boxShadow: `0 0 ${24 * k}px ${item.color}55` }} />;
    case "circle": {
      const d = w;
      return (
        <svg {...tag} style={{ ...common, width: d, height: d * 0.8, overflow: "visible" }} viewBox="0 0 100 80">
          <ellipse cx="50" cy="40" rx="48" ry="37" fill="none" stroke={item.color} strokeWidth={(t / d) * 100} strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - draw} transform="rotate(-8 50 40)" />
        </svg>
      );
    }
    case "underline":
      return (
        <svg {...tag} style={{ ...common, width: w, height: Math.max(h, t * 3), overflow: "visible" }} viewBox="0 0 100 10" preserveAspectRatio="none">
          <path d="M2 6 C 30 3, 65 8, 98 4" fill="none" stroke={item.color} strokeWidth={4} strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - draw} vectorEffect="non-scaling-stroke" style={{ strokeWidth: t }} />
        </svg>
      );
    case "arrow":
      return (
        <svg {...tag} style={{ ...common, width: w, height: w * 0.5, overflow: "visible" }} viewBox="0 0 100 50">
          <path d="M4 30 C 30 10, 60 12, 88 24 M72 10 L90 25 L70 38" fill="none" stroke={item.color} strokeWidth={(t / w) * 100 * 1.2} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - draw} />
        </svg>
      );
    case "progress": {
      const p = Math.min(1, local / Math.max(0.1, duration));
      return (
        <div {...tag} style={{ ...common, transform: "translate(-50%, -50%)", width: w, height: Math.max(h, 0.4), background: item.color2 + "55" }}>
          <div style={{ width: `${p * 100}%`, height: "100%", background: item.color }} />
        </div>
      );
    }
    case "gradient":
      return <div {...tag} style={{ ...common, transform: "translate(-50%, -50%)", width: w, height: h, background: `linear-gradient(to bottom, ${item.color}00, ${item.color}D9)` }} />;
    case "frame":
      return <div {...tag} style={{ ...common, transform: "translate(-50%, -50%)", width: w, height: h, border: `${t}px solid ${item.color}`, borderRadius: 28 * k }} />;
  }
};
