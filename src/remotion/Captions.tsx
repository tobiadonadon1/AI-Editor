import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionPage } from "../shared/timeline";
import type { CaptionStyle } from "../shared/project";
import { clamp01, easeOutBack, easeOutCubic, easeOutElastic } from "./anim";
import { font } from "./fonts";

export const Captions: React.FC<{ pages: CaptionPage[]; style: CaptionStyle }> = ({ pages, style }) => {
  const { fps } = useVideoConfig();
  if (!style.enabled) return null;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {pages.map((page) => {
        const from = Math.round((page.startMs / 1000) * fps);
        const to = Math.round((page.endMs / 1000) * fps);
        if (to <= from) return null;
        return (
          <Sequence key={page.words[0].id} from={from} durationInFrames={to - from} layout="none" name={`Caption “${page.words.map((w) => w.text).join(" ")}”`}>
            <Page page={page} style={style} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const Page: React.FC<{ page: CaptionPage; style: CaptionStyle }> = ({ page, style }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const k = Math.min(width, height) / 1080;
  const nowMs = page.startMs + (frame / fps) * 1000;
  const family = font(style.font);
  const enterT = clamp01(frame / (0.22 * fps));
  const anim = style.animation;

  const pageOpacity = anim === "fade" || anim === "slide" ? easeOutCubic(enterT) : anim === "none" || anim === "karaoke" ? 1 : clamp01(enterT * 3);
  const pageTransform =
    anim === "pop" ? `scale(${0.8 + 0.2 * easeOutBack(enterT)})` : anim === "slide" ? `translateY(${(1 - easeOutCubic(enterT)) * 40 * k}px)` : "";

  const stroke = style.strokeWidth ? `${style.strokeWidth * 2 * k}px ${style.strokeColor}` : undefined;
  const shadow = style.shadow ? `0 ${6 * k}px ${22 * k}px rgba(0,0,0,0.5)` : undefined;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: `${style.y}%`,
          width: width * 0.86,
          transform: `translate(-50%, -50%) ${pageTransform}`,
          opacity: pageOpacity,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            alignItems: "center",
            columnGap: "0.34em",
            rowGap: "0.06em",
            fontFamily: family,
            fontWeight: 900,
            fontSize: style.size * k,
            lineHeight: 1.12,
            textAlign: "center",
            color: style.color,
            textTransform: style.uppercase ? "uppercase" : "none",
            background: style.background ?? undefined,
            padding: style.background ? `${0.18}em ${0.42}em` : 0,
            borderRadius: style.background ? 0.22 * style.size * k : 0,
          }}
        >
          {page.words.map((w) => {
            const active = nowMs >= w.startMs && nowMs < w.endMs;
            const spoken = nowMs >= w.startMs;
            const sinceStart = (nowMs - w.startMs) / 1000;
            const wordT = clamp01(sinceStart / 0.18);
            let transform = "";
            let opacity = 1;
            if (anim === "bounce" || anim === "typewriter") {
              if (!spoken) opacity = 0;
              else if (anim === "bounce") transform = `translateY(${(1 - easeOutElastic(clamp01(sinceStart / 0.45))) * 26 * k}px) scale(${0.7 + 0.3 * easeOutBack(wordT)})`;
            } else if (anim === "pop" && active) {
              transform = `scale(${1 + 0.08 * Math.sin(Math.PI * clamp01(sinceStart / 0.2))})`;
            }
            const color = w.emphasis ? style.emphasisColor : active ? style.activeColor : style.color;
            const boxed = style.activeBox && active;
            return (
              <span
                key={w.id}
                style={{
                  display: "inline-block",
                  color,
                  opacity,
                  transform,
                  WebkitTextStroke: boxed ? undefined : stroke,
                  paintOrder: "stroke fill",
                  textShadow: boxed ? undefined : shadow,
                  background: boxed ? style.activeBox! : undefined,
                  borderRadius: boxed ? 0.16 * style.size * k : undefined,
                  padding: style.activeBox ? `0 ${0.14}em` : undefined,
                  margin: style.activeBox ? `0 ${-0.14}em` : undefined,
                }}
              >
                {w.text}
              </span>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
