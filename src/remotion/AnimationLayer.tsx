import { Img, useCurrentFrame, useVideoConfig } from "remotion";
import { Video } from "@remotion/media";
import type { AnimationItem, MediaAsset } from "../shared/project";
import { animState, combine, inOut } from "./anim";

// V5: a finished animation (the creator's file or one the animation API returned), or, in the editor only,
// the placeholder box that marks where one will go. Exports leave empty placeholders out.
export const AnimationLayer: React.FC<{ item: AnimationItem; duration: number; asset?: MediaAsset; src?: string; placeholders: boolean }> = ({ item, duration, asset, src, placeholders }) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const ready = Boolean(item.assetId && asset && src);
  if (!ready && !placeholders) return null;
  const { pin, pout } = inOut(frame / fps, duration, 0.3);
  const a = combine(animState(item.animIn, pin, "in", frame), animState(item.animOut, pout, "out", frame));
  const full = item.fit === "fullscreen";
  const aspect = ready && asset!.width && asset!.height ? asset!.width / asset!.height : item.aspect || 1;
  const boxW = full ? W : (W * item.width) / 100;
  const boxH = full ? H : boxW / aspect;
  return (
    <div
      data-item-id={item.id}
      style={{
        position: "absolute",
        left: full ? 0 : (item.x / 100) * W - boxW / 2,
        top: full ? 0 : (item.y / 100) * H - boxH / 2,
        width: boxW,
        height: boxH,
        opacity: a.opacity * (item.opacity / 100),
        transform: a.transform,
        filter: a.filter,
        clipPath: a.clipPath,
      }}
    >
      {!ready ? (
        <Placeholder item={item} w={boxW} h={boxH} scale={W / 1080} />
      ) : asset!.kind === "image" ? (
        <Img src={src!} style={{ width: "100%", height: "100%", objectFit: full ? "cover" : "contain" }} />
      ) : (
        <Video src={src!} trimBefore={Math.round(item.trimStart * fps)} objectFit={full ? "cover" : "contain"} muted={!asset!.hasAudio} style={{ width: "100%", height: "100%" }} />
      )}
    </div>
  );
};

const LABEL: Record<AnimationItem["status"], string> = {
  placeholder: "Animation placeholder",
  generating: "Generating animation…",
  ready: "Animation file missing",
  failed: "Animation failed",
};

function Placeholder({ item, w, h, scale }: { item: AnimationItem; w: number; h: number; scale: number }) {
  const frame = useCurrentFrame();
  const s = Math.max(0.5, Math.min(w, h * 1.4) / (560 * scale)) * scale;
  const moving = item.status === "generating";
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        border: `${Math.max(2, 4 * scale)}px dashed ${item.status === "failed" ? "rgba(255,120,120,0.9)" : "rgba(255,255,255,0.75)"}`,
        borderRadius: 18 * scale,
        background: `repeating-linear-gradient(135deg, rgba(20,22,28,0.72) 0 ${22 * scale}px, rgba(45,140,235,0.32) ${22 * scale}px ${44 * scale}px)`,
        backgroundPosition: moving ? `${(frame * 2 * scale) % (62 * scale)}px 0` : undefined,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14 * s,
        padding: 28 * s,
        color: "#fff",
        fontFamily: "Inter, system-ui, sans-serif",
        textAlign: "center",
        overflow: "hidden",
        textShadow: "0 2px 8px rgba(0,0,0,0.6)",
      }}
    >
      <span style={{ fontSize: 30 * s, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", background: "rgba(0,0,0,0.55)", padding: `${6 * s}px ${14 * s}px`, borderRadius: 8 * s }}>
        {LABEL[item.status]}
      </span>
      <span style={{ fontSize: 34 * s, fontWeight: 600, lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.status === "failed" && item.error ? item.error : item.prompt}</span>
    </div>
  );
}
