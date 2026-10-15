import { useMemo } from "react";
import { AbsoluteFill, Img, Sequence, useCurrentFrame, useVideoConfig, type EffectDescriptor } from "remotion";
import { Audio, Video } from "@remotion/media";
import { buildTimeline, placeItems, type PlacedItem, type Timeline } from "../shared/timeline";
import { NEUTRAL_GRADE, NEUTRAL_EFFECTS, dbToGain, mainAsset, type AdjustItem, type EditVideoProps, type Grade, type MediaAsset, type MediaItem, type MusicItem, type Project } from "../shared/project";
import { resolveGrade } from "../shared/presets";
import { Captions } from "./Captions";
import { ShapeLayer, TextLayer } from "./Layers";
import { animState, combine, easeInOutCubic, hash, inOut, clamp01 } from "./anim";
import { emptyFx, videoEffects, type FrameFx } from "./effects";

// How much an item is "on" at time t, with an optional fade at both ends.
function envelope(t: number, p: PlacedItem, fade: number) {
  if (t < p.start || t >= p.end) return 0;
  if (fade <= 0) return 1;
  const d = Math.min(fade, (p.end - p.start) / 2);
  return Math.min(1, (t - p.start) / d, (p.end - t) / d);
}

interface FrameState {
  grade: ReturnType<typeof resolveGrade>;
  fx: FrameFx;
  zoom: number;
  originX: number;
  originY: number;
  dx: number;
  dy: number;
  rot: number;
  flash: { color: string; opacity: number } | null;
  dip: number;
}

function frameState(project: Project, placed: PlacedItem[], t: number, frame: number, W: number): FrameState {
  const layers: Partial<Grade>[] = [];
  const fx = emptyFx();
  let zoom = 1;
  let originX = 50;
  let originY = 40;
  let dx = 0;
  let dy = 0;
  let rot = 0;
  let flash: FrameState["flash"] = null;
  let dip = 0;

  for (const p of placed) {
    const it = p.item;
    if (t < p.start || t >= p.end) continue;
    if (it.type === "adjust") {
      const w = envelope(t, p, it.fade);
      if (it.grade) {
        const scaled: Partial<Grade> = {};
        for (const [k, v] of Object.entries(it.grade)) {
          const key = k as keyof Grade;
          if (typeof v === "number") (scaled as Record<string, number>)[key] = (NEUTRAL_GRADE[key] as number) + (v - (NEUTRAL_GRADE[key] as number)) * w;
          else if (key === "look") scaled.look = v as Grade["look"];
        }
        if (it.grade.look) scaled.lookIntensity = (it.grade.lookIntensity ?? 100) * w;
        layers.push(scaled);
      }
      if (it.effects) {
        const e = { ...NEUTRAL_EFFECTS, ...it.effects };
        if (e.glitch > 0) zoom *= 1 + 0.05 * (e.glitch / 100) * w;
        fx.blur += e.blur * w;
        fx.zoomBlur += e.zoomBlur * w;
        fx.chromatic += e.chromatic * w;
        fx.mono = Math.max(fx.mono, e.mono * w);
        fx.pixelate = Math.max(fx.pixelate, e.pixelate * w);
        if (e.lightLeak > 0) {
          fx.lightLeak = Math.max(fx.lightLeak, e.lightLeak * w);
          fx.leakProgress = clamp01((t - p.start) / (p.end - p.start));
        }
        if (e.shine) {
          fx.shine = true;
          fx.shineProgress = clamp01((t - p.start) / Math.min(1.2, p.end - p.start));
        }
        if (e.glitch > 0 && hash(frame * 3) > 0.55) {
          fx.chromatic += (e.glitch / 100) * 18 * w;
          dx += (hash(frame) - 0.5) * (e.glitch / 100) * 0.04 * W * w;
        }
      }
      if (it.motion) {
        const m = it.motion;
        const local = t - p.start;
        const dur = p.end - p.start;
        const q = clamp01(local / dur);
        let z = m.scale;
        if (m.ease === "smooth") {
          const ramp = Math.min(0.35, dur / 3);
          z = 1 + (m.scale - 1) * easeInOutCubic(Math.min(1, local / ramp, (dur - local) / ramp));
        } else if (m.ease === "push") z = 1 + (m.scale - 1) * easeInOutCubic(q);
        else if (m.ease === "pull") z = m.scale - (m.scale - 1) * easeInOutCubic(q);
        else if (m.ease === "drift") dx += (q - 0.5) * -0.04 * W;
        zoom *= z;
        originX = m.x;
        originY = m.y;
        rot += m.rotation;
      }
    } else if (it.type === "transition") {
      const q = clamp01((t - p.start) / (p.end - p.start));
      const peak = Math.sin(Math.PI * q);
      switch (it.kind) {
        case "flash":
          flash = { color: it.color, opacity: Math.pow(peak, 1.4) * 0.92 };
          break;
        case "dip-black":
          dip = Math.max(dip, peak);
          break;
        case "zoom-punch":
          zoom *= 1 + 0.2 * peak;
          fx.zoomBlur += 46 * peak;
          break;
        case "glitch":
          fx.chromatic += 24 * peak;
          zoom *= 1 + 0.08 * peak; // covers the jitter so no black edge shows
          dx += (hash(frame) - 0.5) * 0.06 * W * peak;
          if (hash(frame + 5) > 0.6) fx.pixelate = Math.max(fx.pixelate, 14 * peak);
          break;
        case "whip": {
          // Slide one way out of the cut and in from the other side; the blur peak hides the jump.
          const dir = hash(Math.floor(p.start * 10)) > 0.5 ? 1 : -1;
          zoom *= 1 + 0.16 * peak;
          dx += (q < 0.5 ? 2 * q : 2 * q - 2) * 0.07 * W * dir;
          fx.whip += 60 * peak;
          break;
        }
        case "blur":
          fx.blur += 28 * peak;
          break;
        case "light-leak":
          fx.lightLeak = Math.max(fx.lightLeak, 100 * peak);
          fx.leakProgress = q;
          break;
        case "shake":
          zoom *= 1 + 0.07 * peak;
          dx += (hash(frame) - 0.5) * 36 * peak;
          dy += (hash(frame + 9) - 0.5) * 36 * peak;
          rot += (hash(frame + 4) - 0.5) * 2.4 * peak;
          break;
      }
    }
  }
  return { grade: resolveGrade(project.grade, layers), fx, zoom, originX, originY, dx, dy, rot, flash, dip };
}

// Where the source sits in the frame for cover/contain with a focus point.
function frameRect(asset: MediaAsset | undefined, W: number, H: number, fit: "cover" | "contain", focusX: number, focusY: number) {
  const sw = asset?.width || W;
  const sh = asset?.height || H;
  const s = fit === "cover" ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
  const w = sw * s;
  const h = sh * s;
  return { left: (W - w) * (focusX / 100), top: (H - h) * (focusY / 100), width: w, height: h };
}

// Music ducks under speech: a gain per output frame, eased around every word.
function duckCurve(timeline: Timeline, fps: number) {
  const n = timeline.durationInFrames;
  const curve = new Float32Array(n).fill(1);
  const ease = 0.25 * fps;
  for (const w of timeline.words) {
    const a = Math.floor((w.startMs / 1000) * fps);
    const b = Math.ceil((w.endMs / 1000) * fps);
    for (let f = Math.max(0, a - ease); f < Math.min(n, b + ease); f++) {
      const d = f < a ? (a - f) / ease : f > b ? (f - b) / ease : 0;
      curve[f] = Math.min(curve[f], 0.32 + 0.68 * Math.min(1, d));
    }
  }
  return curve;
}

export const EditVideo: React.FC<EditVideoProps> = ({ project, media, sfx }) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const asset = mainAsset(project);
  const src = asset ? media[asset.id] : undefined;

  const timeline = useMemo(() => buildTimeline(project, asset?.durationSec ?? 0, fps), [project, asset?.durationSec, fps]);
  const placed = useMemo(() => placeItems(project.items.filter((i) => !i.hidden), timeline), [project.items, timeline]);
  const duck = useMemo(() => duckCurve(timeline, fps), [timeline, fps]);

  const t = frame / fps;
  const st = frameState(project, placed, t, frame, W);
  const effects = videoEffects(st.grade, st.fx, frame);
  const v = project.video;
  const rect = frameRect(asset, W, H, v.fit, v.focusX, v.focusY);
  const dialogueGain = Math.min(1, dbToGain(v.volume));

  const byType = <T extends PlacedItem["item"]["type"]>(type: T) => placed.filter((p) => p.item.type === type);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      {/* V1 + V2 sit inside the camera, so zooms and shakes move both, like an adjustment layer above them. */}
      <AbsoluteFill
        style={{
          transformOrigin: `${st.originX}% ${st.originY}%`,
          transform: `translate(${st.dx}px, ${st.dy}px) rotate(${v.rotation + st.rot}deg) scale(${v.scale * st.zoom})`,
          opacity: v.opacity / 100,
        }}
      >
        {src
          ? timeline.clips.map((clip) => (
              <Sequence key={`${clip.srcStartFrame}-${clip.srcEndFrame}`} from={clip.fromFrame} durationInFrames={clip.durationInFrames} premountFor={fps} name={`V1 clip ${clip.index + 1}`}>
                <Video src={src} trimBefore={clip.srcStartFrame} objectFit="fill" effects={effects} volume={dialogueGain} style={{ position: "absolute", ...rect }} />
              </Sequence>
            ))
          : null}
        {byType("media").map((p) => (
          <Sequence key={p.item.id} from={Math.round(p.start * fps)} durationInFrames={Math.max(1, Math.round((p.end - p.start) * fps))} premountFor={fps} name="V2 b-roll">
            <BRoll item={p.item as MediaItem} duration={p.end - p.start} asset={project.assets.find((a) => a.id === (p.item as MediaItem).assetId)} src={media[(p.item as MediaItem).assetId]} effects={effects} />
          </Sequence>
        ))}
      </AbsoluteFill>

      {byType("shape").map((p) => (
        <Sequence key={p.item.id} from={Math.round(p.start * fps)} durationInFrames={Math.max(1, Math.round((p.end - p.start) * fps))} layout="none" name="V4 graphic">
          <ShapeLayer item={p.item as never} duration={p.end - p.start} />
        </Sequence>
      ))}
      <Captions pages={timeline.pages} style={project.captions} />
      {byType("text").map((p) => (
        <Sequence key={p.item.id} from={Math.round(p.start * fps)} durationInFrames={Math.max(1, Math.round((p.end - p.start) * fps))} layout="none" name="V5 text">
          <TextLayer item={p.item as never} duration={p.end - p.start} />
        </Sequence>
      ))}

      {st.dip > 0 && <AbsoluteFill style={{ background: "#000", opacity: st.dip }} />}
      {st.flash && <AbsoluteFill style={{ background: st.flash.color, opacity: st.flash.opacity }} />}

      {byType("music").map((p) => {
        const it = p.item as MusicItem;
        const url = media[it.assetId];
        if (!url) return null;
        const from = Math.round(p.start * fps);
        const len = Math.max(1, Math.round((p.end - p.start) * fps));
        const base = Math.min(1, dbToGain(it.volume));
        return (
          <Sequence key={it.id} from={from} durationInFrames={len} layout="none" name="A2 music">
            <Audio
              src={url}
              trimBefore={Math.round(it.trimStart * fps)}
              loop
              volume={(f) => {
                const fadeIn = it.fadeIn > 0 ? Math.min(1, f / (it.fadeIn * fps)) : 1;
                const fadeOut = it.fadeOut > 0 ? Math.min(1, (len - f) / (it.fadeOut * fps)) : 1;
                const d = it.duck ? duck[Math.min(duck.length - 1, from + f)] ?? 1 : 1;
                return Math.max(0, base * fadeIn * fadeOut * d);
              }}
            />
          </Sequence>
        );
      })}
      {byType("sfx").map((p) => {
        const it = p.item as Extract<PlacedItem["item"], { type: "sfx" }>;
        const url = sfx[it.sound];
        if (!url) return null;
        return (
          <Sequence key={it.id} from={Math.round(p.start * fps)} durationInFrames={Math.round(1.6 * fps)} layout="none" name={`A3 ${it.sound}`}>
            <Audio src={url} volume={Math.min(1, dbToGain(it.volume))} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const BRoll: React.FC<{ item: MediaItem; duration: number; asset?: MediaAsset; src?: string; effects: EffectDescriptor[] }> = ({ item, duration, asset, src, effects }) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  if (!src || !asset) return null;
  const local = frame / fps;
  const { pin, pout } = inOut(local, duration, 0.35);
  const a = combine(animState(item.animIn, pin, "in", frame), animState(item.animOut, pout, "out", frame));
  const kb = item.kenBurns ? 1 + 0.12 * (local / Math.max(0.1, duration)) : 1;
  const pip = item.fit === "pip";
  const boxW = pip ? W * item.scale : W;
  const boxH = pip ? (boxW * asset.height) / Math.max(1, asset.width) : H;
  const rect = frameRect(asset, boxW, boxH, item.fit === "contain" ? "contain" : "cover", 50, 50);
  const style: React.CSSProperties = { position: "absolute", ...rect, transform: `scale(${kb})` };
  return (
    <div
      data-item-id={item.id}
      style={{
        position: "absolute",
        left: pip ? (item.x / 100) * W - boxW / 2 : 0,
        top: pip ? (item.y / 100) * H - boxH / 2 : 0,
        width: boxW,
        height: boxH,
        overflow: "hidden",
        borderRadius: item.radius,
        boxShadow: pip ? "0 18px 50px rgba(0,0,0,0.45)" : undefined,
        background: item.fit === "contain" ? "#000" : undefined,
        opacity: a.opacity * (item.opacity / 100),
        transform: a.transform,
        filter: a.filter,
        clipPath: a.clipPath,
      }}
    >
      {asset.kind === "image" ? (
        <Img src={src} effects={effects} style={{ ...style, objectFit: "fill" }} />
      ) : (
        <Video src={src} trimBefore={Math.round(item.trimStart * fps)} objectFit="fill" effects={effects} volume={item.volume <= -59 ? 0 : Math.min(1, dbToGain(item.volume))} muted={item.volume <= -59} style={style} />
      )}
    </div>
  );
};

// Exported for tests and the Studio.
export type { AdjustItem };
