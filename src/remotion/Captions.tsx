import { AbsoluteFill, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Montserrat";
import type { CaptionPage } from "../shared/timeline";
import type { CaptionStyle } from "../shared/project";

const { fontFamily } = loadFont("normal", { weights: ["800", "900"], subsets: ["latin"] });

export const Captions: React.FC<{ pages: CaptionPage[]; style: CaptionStyle }> = ({
  pages,
  style,
}) => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      {pages.map((page) => {
        const from = Math.round((page.startMs / 1000) * fps);
        const to = Math.round((page.endMs / 1000) * fps);
        if (to <= from) return null;
        return (
          <Sequence key={page.words[0].id} from={from} durationInFrames={to - from} layout="none">
            <Page page={page} style={style} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const Page: React.FC<{ page: CaptionPage; style: CaptionStyle }> = ({ page, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowMs = page.startMs + (frame / fps) * 1000;
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 220, mass: 0.6 } });

  return (
    <AbsoluteFill
      style={{
        justifyContent: style.position === "center" ? "center" : "flex-end",
        alignItems: "center",
        paddingBottom: style.position === "center" ? 0 : 520,
        paddingLeft: 70,
        paddingRight: 70,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          columnGap: "0.5em",
          fontFamily,
          fontWeight: 900,
          fontSize: 92,
          lineHeight: 1.08,
          textAlign: "center",
          color: "#fff",
          textTransform: style.uppercase ? "uppercase" : "none",
          transform: `scale(${0.82 + 0.18 * enter})`,
          opacity: enter,
          WebkitTextStroke: "14px #000",
          paintOrder: "stroke fill",
          textShadow: "0 8px 24px rgba(0,0,0,0.45)",
        }}
      >
        {page.words.map((w) => {
          const active = nowMs >= w.startMs && nowMs < w.endMs;
          const spoken = nowMs >= w.startMs;
          const pop = spring({
            frame: frame - Math.round(((w.startMs - page.startMs) / 1000) * fps),
            fps,
            config: { damping: 12, stiffness: 260, mass: 0.5 },
          });
          const color = w.emphasis
            ? style.emphasisColor
            : active
              ? style.highlightColor
              : "#fff";
          return (
            <span
              key={w.id}
              style={{
                display: "inline-block",
                color,
                opacity: spoken ? 1 : 0.85,
                transform: `scale(${active || w.emphasis ? 1 + 0.06 * pop : 1})`,
              }}
            >
              {w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
