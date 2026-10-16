import { memo, useEffect, useMemo, useRef, useState } from "react";
import { FPS, LANES, mainAsset, uid, type Item } from "../../../src/shared/project";
import { cutPoints, durationSec, outputToSource, placeItems, type PlacedItem } from "../../../src/shared/timeline";
import { describeItem } from "../../../src/shared/ops";
import { beginGesture, commit, get, seek, set, useEditor } from "../lib/store";
import { Icon } from "./Icons";
import { Panel, tc } from "./controls";

const HEAD = 168; // track header width
const ROW = 26;
const LANE_H: Record<string, number> = { C1: 24, V1: 54, A1: 46, A2: 30, A3: 26 };
const TYPE_LANE = Object.fromEntries(LANES.flatMap((l) => l.types.map((t) => [t, l.id])));

// Overlapping items in one lane stack into rows, the way Premiere would need extra tracks.
function pack(items: PlacedItem[]): Map<string, number> {
  const rows: number[] = [];
  const out = new Map<string, number>();
  for (const p of [...items].sort((a, b) => a.start - b.start)) {
    let r = rows.findIndex((end) => end <= p.start + 0.001);
    if (r < 0) {
      r = rows.length;
      rows.push(0);
    }
    rows[r] = p.end;
    out.set(p.item.id, r);
  }
  return out;
}

function niceStep(pps: number) {
  const targets = [1 / FPS, 2 / FPS, 5 / FPS, 10 / FPS, 0.5, 1, 2, 5, 10, 15, 30, 60];
  return targets.find((s) => s * pps >= 70) ?? 60;
}

export function Timeline() {
  const project = useEditor((s) => s.project)!;
  const timeline = useEditor((s) => s.timeline)!;
  const pps = useEditor((s) => s.pxPerSec);
  const tool = useEditor((s) => s.tool);
  const selectedItem = useEditor((s) => s.selectedItem);
  const selectedClip = useEditor((s) => s.selectedClip);
  const thumbs = useEditor((s) => s.thumbs);
  const waves = useEditor((s) => s.waves);
  const [snap, setSnap] = useState(true);
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);

  const total = durationSec(timeline);
  const asset = mainAsset(project);
  const placed = useMemo(() => placeItems(project.items, timeline, true), [project.items, timeline]);
  const byLane = useMemo(() => {
    const m = new Map<string, PlacedItem[]>();
    for (const p of placed) {
      const lane = TYPE_LANE[p.item.type];
      m.set(lane, [...(m.get(lane) ?? []), p]);
    }
    return m;
  }, [placed]);
  const rows = useMemo(() => new Map([...byLane].map(([lane, items]) => [lane, pack(items)])), [byLane]);
  const laneHeight = (id: string) => LANE_H[id] ?? Math.max(1, ...[...(rows.get(id)?.values() ?? [])].map((r) => r + 1)) * ROW + 2;
  const width = Math.max(total * pps + 240, (scroller.current?.clientWidth ?? 800) - HEAD);
  const x = (sec: number) => sec * pps;

  // The tracks do not re-render on every frame; only the playhead and timecode below do.

  // Ctrl/Cmd + wheel zooms around the cursor.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const at = (el.scrollLeft + e.clientX - r.left - HEAD) / get().pxPerSec;
      const next = Math.min(600, Math.max(8, get().pxPerSec * (e.deltaY > 0 ? 0.88 : 1.14)));
      set({ pxPerSec: next });
      requestAnimationFrame(() => (el.scrollLeft = at * next - (e.clientX - r.left - HEAD)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const snapTargets = useMemo(() => {
    const t = [0, total, ...cutPoints(timeline), ...placed.flatMap((p) => [p.start, p.end])];
    return t;
  }, [timeline, placed, total]);

  const snapTo = (sec: number, skip?: string) => {
    if (!snap) return sec;
    const candidates = [...snapTargets, get().frame / FPS];
    let best = sec;
    let bestD = 8 / pps;
    for (const c of candidates) {
      if (Math.abs(c - sec) < bestD) {
        bestD = Math.abs(c - sec);
        best = c;
      }
    }
    void skip;
    return best;
  };

  const timeAt = (clientX: number) => {
    const el = scroller.current!;
    const r = el.getBoundingClientRect();
    return Math.max(0, (el.scrollLeft + clientX - r.left - HEAD) / pps);
  };

  const scrub = (e: React.PointerEvent) => {
    seek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => seek(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onItemDown = (e: React.PointerEvent, p: PlacedItem, mode: "move" | "start" | "end") => {
    e.stopPropagation();
    const lane = TYPE_LANE[p.item.type];
    if (tool === "razor") {
      const at = timeAt(e.clientX);
      if (at <= p.start + 0.05 || at >= p.end - 0.05) return;
      commit((d) => {
        const it = d.items.find((i) => i.id === p.item.id)!;
        const second = { ...structuredClone(it), id: uid("i"), start: at, duration: p.end - at, anchorWord: undefined, anchorOffset: undefined };
        it.start = p.start;
        it.anchorWord = undefined;
        it.duration = at - p.start;
        d.items.push(second);
      });
      return;
    }
    set({ selectedItem: p.item.id, selectedClip: null });
    if (locked.has(lane)) return;
    const g = beginGesture();
    const t0 = timeAt(e.clientX);
    const { start, end } = p;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dt = timeAt(ev.clientX) - t0;
      if (!moved && Math.abs(dt * pps) < 3) return;
      moved = true;
      g.update((d) => {
        const it = d.items.find((i) => i.id === p.item.id);
        if (!it) return;
        if (mode === "move") {
          let ns = Math.max(0, start + dt);
          const sEdge = snapTo(ns);
          const eEdge = snapTo(ns + (end - start));
          ns = sEdge !== ns ? sEdge : eEdge !== ns + (end - start) ? eEdge - (end - start) : ns;
          it.start = Math.max(0, ns);
        } else if (mode === "start") {
          const ns = Math.min(end - 0.1, Math.max(0, snapTo(start + dt)));
          it.start = ns;
          it.duration = end - ns;
        } else {
          const ne = Math.max(start + 0.1, snapTo(end + dt));
          it.start = start;
          it.duration = ne - start;
        }
        // Dragged by hand: it no longer follows a word.
        it.anchorWord = undefined;
        it.anchorOffset = undefined;
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      g.end();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onClipDown = (e: React.PointerEvent, index: number) => {
    e.stopPropagation();
    if (tool === "razor") {
      const src = outputToSource(timeline, timeAt(e.clientX));
      if (src !== null) commit((d) => void d.splits.push(Math.round(src * FPS) / FPS));
      return;
    }
    set({ selectedClip: index, selectedItem: null });
  };

  const lanes = LANES;
  const step = niceStep(pps);
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let s = 0; s <= total + 4; s += step) out.push(s);
    return out;
  }, [total, step]);

  const eye = (laneId: string) => {
    const items = byLane.get(laneId) ?? [];
    return items.length > 0 && items.every((p) => p.item.hidden);
  };
  const toggleLane = (laneId: string) => {
    const hide = !eye(laneId);
    commit((d) => {
      for (const it of d.items) if (TYPE_LANE[it.type] === laneId) it.hidden = hide;
    });
  };
  const dialogueMuted = project.video.volume <= -59;

  return (
    <Panel
      tabs={[{ id: "seq", label: project.name }]}
      active="seq"
      className="timeline-panel"
      actions={<span className="tl-zoom-label">{Math.round(pps)} px/s</span>}
    >
      <div className="tl">
        <div className="tl-scroll" ref={scroller} onPointerDown={(e) => e.target === e.currentTarget && set({ selectedItem: null, selectedClip: null })}>
          <div className="tl-content" style={{ width: width + HEAD }}>
            <div className="tl-ruler-row">
              <div className="tl-corner">
                <NowTimecode />
                <div className="tl-toggles">
                  <button type="button" className={`icon-btn sm${snap ? " on" : ""}`} title="Snap in Timeline (S)" onClick={() => setSnap(!snap)}>
                    <Icon name="magnet" size={14} />
                  </button>
                  <button type="button" className="icon-btn sm on" title="Linked selection" aria-pressed="true">
                    <Icon name="link" size={14} />
                  </button>
                  <button type="button" className="icon-btn sm" title="Zoom to sequence (\\)" onClick={() => fitZoom(scroller.current, total)}>
                    <Icon name="zoomOut" size={14} />
                  </button>
                </div>
              </div>
              <div className="tl-ruler" onPointerDown={scrub}>
                {ticks.map((s) => (
                  <span key={s} className="tick" style={{ left: x(s) }}>
                    <i />
                    <b>{tc(s)}</b>
                  </span>
                ))}
                {cutPoints(timeline).map((c) => (
                  <i key={c} className="ruler-cut" style={{ left: x(c) }} />
                ))}
                <i className="ruler-end" style={{ left: x(total) }} />
                <Playhead className="playhead-head" offset={0} pps={pps} scroller={scroller} follow />
              </div>
            </div>

            {lanes.map((lane) => {
              const h = laneHeight(lane.id);
              const isAudio = lane.kind === "audio";
              const items = byLane.get(lane.id) ?? [];
              const laneRows = rows.get(lane.id);
              return (
                <div key={lane.id} className={`track track-${lane.kind}${lane.id === "V1" ? " track-v1" : ""}${lane.id === "A1" ? " track-a1" : ""}`} style={{ height: h }}>
                  <div className="track-head">
                    <span className={`track-target${lane.id === "V1" || lane.id === "A1" ? " on" : ""}`}>{lane.label}</span>
                    <button type="button" className={`track-btn${locked.has(lane.id) ? " on" : ""}`} title="Toggle track lock" onClick={() => setLocked((s) => { const n = new Set(s); n.has(lane.id) ? n.delete(lane.id) : n.add(lane.id); return n; })}>
                      <Icon name={locked.has(lane.id) ? "lock" : "unlock"} size={12} />
                    </button>
                    {isAudio ? (
                      <>
                        <button
                          type="button"
                          className={`track-btn m${(lane.id === "A1" ? dialogueMuted : eye(lane.id)) ? " on" : ""}`}
                          title="Mute track"
                          onClick={() => (lane.id === "A1" ? commit((d) => void (d.video.volume = dialogueMuted ? 0 : -60)) : toggleLane(lane.id))}
                        >
                          M
                        </button>
                        <span className="track-name">{lane.name}</span>
                      </>
                    ) : lane.kind === "captions" ? (
                      <>
                        <button type="button" className={`track-btn${project.captions.enabled ? "" : " off"}`} title="Toggle captions" onClick={() => commit((d) => void (d.captions.enabled = !d.captions.enabled))}>
                          <Icon name={project.captions.enabled ? "eye" : "eyeOff"} size={12} />
                        </button>
                        <span className="track-name">{lane.name}</span>
                      </>
                    ) : (
                      <>
                        {lane.id !== "V1" ? (
                          <button type="button" className={`track-btn${eye(lane.id) ? " off" : ""}`} title="Toggle track output" onClick={() => toggleLane(lane.id)}>
                            <Icon name={eye(lane.id) ? "eyeOff" : "eye"} size={12} />
                          </button>
                        ) : (
                          <span className="track-btn ghost" />
                        )}
                        <span className="track-name">{lane.name}</span>
                      </>
                    )}
                  </div>

                  <div className="track-lane" onPointerDown={(e) => e.target === e.currentTarget && (set({ selectedItem: null, selectedClip: null }), scrub(e))}>
                    {lane.id === "V1" &&
                      timeline.clips.map((c) => {
                        const left = x(c.fromFrame / FPS);
                        const w = x(c.durationInFrames / FPS);
                        return (
                          <div key={c.index} className={`clip clip-video${selectedClip === c.index ? " selected" : ""}`} style={{ left, width: w }} onPointerDown={(e) => onClipDown(e, c.index)} title={`Clip ${c.index + 1}: ${tc(c.srcStartFrame / FPS)}–${tc(c.srcEndFrame / FPS)} in the source`}>
                            <Filmstrip assetId={asset?.id} thumbs={thumbs} from={c.srcStartFrame / FPS} to={c.srcEndFrame / FPS} width={w} />
                            <span className="clip-name">{asset?.name ?? "Video"}</span>
                          </div>
                        );
                      })}
                    {lane.id === "A1" &&
                      timeline.clips.map((c) => {
                        const left = x(c.fromFrame / FPS);
                        const w = x(c.durationInFrames / FPS);
                        return (
                          <div key={c.index} className={`clip clip-audio${selectedClip === c.index ? " selected" : ""}${dialogueMuted ? " muted" : ""}`} style={{ left, width: w }} onPointerDown={(e) => onClipDown(e, c.index)}>
                            <Wave peaks={asset ? waves[asset.id] : undefined} from={c.srcStartFrame / FPS} to={c.srcEndFrame / FPS} width={w} height={h - 4} />
                            <span className="clip-name">{asset?.name ?? "Audio"}</span>
                          </div>
                        );
                      })}
                    {lane.id === "C1" &&
                      project.captions.enabled &&
                      timeline.pages.map((pg) => (
                        <div key={pg.words[0].id} className="clip clip-caption" style={{ left: x(pg.startMs / 1000), width: Math.max(2, x((pg.endMs - pg.startMs) / 1000)) }} onPointerDown={(e) => (e.stopPropagation(), set({ workspace: "captions" }), seek(pg.startMs / 1000))}>
                          <span className="clip-name">{pg.words.map((w) => w.text).join(" ")}</span>
                        </div>
                      ))}
                    {items.map((p) => {
                      const row = laneRows?.get(p.item.id) ?? 0;
                      const left = x(p.start);
                      const w = Math.max(4, x(p.end - p.start));
                      return (
                        <div
                          key={p.item.id}
                          className={`clip clip-${p.item.type}${selectedItem === p.item.id ? " selected" : ""}${p.item.hidden ? " hidden-item" : ""}`}
                          style={{ left, width: w, top: lane.id === "A2" ? 2 : 1 + row * ROW, height: lane.id === "A2" ? h - 4 : ROW - 2 }}
                          onPointerDown={(e) => onItemDown(e, p, "move")}
                          onDoubleClick={() => set({ workspace: p.item.type === "text" ? "graphics" : p.item.type === "adjust" ? "color" : p.item.type === "music" || p.item.type === "sfx" ? "audio" : "editing" })}
                          title={`${describeItem(p.item)} · ${tc(p.start)}–${tc(p.end)}${p.item.anchorWord ? " · follows its word" : ""}`}
                        >
                          <i className="edge edge-l" onPointerDown={(e) => onItemDown(e, p, "start")} />
                          <span className="clip-name">
                            {p.item.type === "adjust" && <span className="fx-badge">fx</span>}
                            {itemLabel(p.item)}
                          </span>
                          {p.item.type === "music" && <Wave peaks={waves[p.item.assetId]} from={p.item.trimStart} to={p.item.trimStart + (p.end - p.start)} width={w} height={h - 8} />}
                          <i className="edge edge-r" onPointerDown={(e) => onItemDown(e, p, "end")} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <Playhead className="playhead" offset={HEAD} pps={pps} />
          </div>
        </div>
        <div className="tl-zoombar">
          <Icon name="zoomOut" size={12} />
          <input type="range" min={Math.log(8)} max={Math.log(600)} step={0.01} value={Math.log(pps)} aria-label="Timeline zoom" onChange={(e) => set({ pxPerSec: Math.exp(Number(e.target.value)) })} onKeyDown={(e) => e.stopPropagation()} />
          <Icon name="zoomIn" size={12} />
        </div>
      </div>
    </Panel>
  );
}

export function fitZoom(el: HTMLElement | null, total: number) {
  const w = (el?.clientWidth ?? 900) - HEAD - 40;
  set({ pxPerSec: Math.min(600, Math.max(8, w / Math.max(1, total))) });
  if (el) el.scrollLeft = 0;
}

function itemLabel(item: Item) {
  switch (item.type) {
    case "text":
      return item.text.replace(/\*/g, "").replace(/\n/g, " ");
    case "shape":
      return item.shape[0].toUpperCase() + item.shape.slice(1);
    case "media":
      return get().project?.assets.find((a) => a.id === item.assetId)?.name ?? "B-roll";
    case "adjust":
      return item.name ?? (item.motion ? `Zoom ${Math.round(item.motion.scale * 100)}%` : "Adjustment Layer");
    case "transition":
      return item.kind;
    case "sfx":
      return item.sound;
    case "music":
      return get().project?.assets.find((a) => a.id === item.assetId)?.name ?? "Music";
  }
}

function NowTimecode() {
  const frame = useEditor((s) => s.frame);
  return <span className="tc tc-big">{tc(frame / FPS)}</span>;
}

// The playhead subscribes to the frame by itself; the head also keeps itself in view while playing.
function Playhead({ className, offset, pps, scroller, follow }: { className: string; offset: number; pps: number; scroller?: React.RefObject<HTMLDivElement | null>; follow?: boolean }) {
  const frame = useEditor((s) => s.frame);
  const playing = useEditor((s) => s.playing);
  const playX = (frame / FPS) * pps;
  useEffect(() => {
    const el = scroller?.current;
    if (!follow || !el || !playing) return;
    const view = el.clientWidth - HEAD;
    if (playX < el.scrollLeft || playX > el.scrollLeft + view - 40) el.scrollLeft = Math.max(0, playX - 40);
  }, [playX, playing, follow, scroller]);
  return className === "playhead" ? <div className={className} style={{ left: offset + playX }} /> : <span className={className} style={{ left: offset + playX }} />;
}

const Filmstrip = memo(function Filmstrip({ assetId, thumbs, from, to, width }: { assetId?: string; thumbs: Record<string, { every: number; frames: string[] }>; from: number; to: number; width: number }) {
  const t = assetId ? thumbs[assetId] : undefined;
  if (!t || !t.frames.length || width < 8) return null;
  const tileW = 30;
  const n = Math.max(1, Math.floor(width / tileW));
  const tiles = Array.from({ length: n }, (_, i) => {
    const at = from + ((to - from) * (i + 0.5)) / n;
    return t.frames[Math.min(t.frames.length - 1, Math.max(0, Math.round(at / t.every)))];
  });
  return (
    <span className="filmstrip" aria-hidden="true">
      {tiles.map((src, i) => (src ? <img key={i} src={src} alt="" draggable={false} /> : <i key={i} />))}
    </span>
  );
});

const Wave = memo(function Wave({ peaks, from, to, width, height }: { peaks?: number[]; from: number; to: number; width: number; height: number }) {
  if (!peaks || width < 4) return null;
  const n = Math.max(2, Math.floor(width / 2));
  const mid = height / 2;
  let d = "";
  for (let i = 0; i < n; i++) {
    const a = Math.floor((from + ((to - from) * i) / n) * 60);
    const b = Math.max(a + 1, Math.floor((from + ((to - from) * (i + 1)) / n) * 60));
    let m = 0;
    for (let k = a; k < b && k < peaks.length; k++) m = Math.max(m, peaks[k]);
    const amp = Math.max(0.5, Math.sqrt(m) * mid * 0.95);
    d += `M${i * 2 + 1} ${mid - amp}V${mid + amp}`;
  }
  return (
    <svg className="wave" width={width} height={height} aria-hidden="true">
      <path d={d} />
    </svg>
  );
});
