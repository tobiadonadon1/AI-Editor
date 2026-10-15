import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
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
  const { fps, width } = useVideoConfig();
  const k = useScale();
  const s = item.style;
  const family = font(s.font, s.italic);
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
          left: `${item.x}%`,
          top: `${item.y}%`,
          width: (item.width / 100) * width,
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
            fontSize: s.size * k,
            fontWeight: s.weight,
            fontStyle: s.italic ? "italic" : "normal",
            lineHeight: s.lineHeight,
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
            <div key={li}>
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
