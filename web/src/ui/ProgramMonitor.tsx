import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import { renderStillOnWeb } from "@remotion/web-renderer";
import { smoothTextOutlines } from "../../../src/remotion/canvas-text";
import { EditVideo } from "../../../src/remotion/EditVideo";
import { preloadFonts } from "../../../src/remotion/fonts";
import { FORMATS, FPS, type EditVideoProps, type Item } from "../../../src/shared/project";
import { makeText } from "../../../src/shared/presets";
import { beginGesture, commit, get, player, seek, set, useEditor } from "../lib/store";
import { Icon } from "./Icons";
import { Panel, Select, tc } from "./controls";

type Zoom = "fit" | "50" | "75" | "100";

export function ProgramMonitor() {
  const project = useEditor((s) => s.project)!;
  const timeline = useEditor((s) => s.timeline)!;
  const media = useEditor((s) => s.media);
  const sfx = useEditor((s) => s.sfx);
  const frame = useEditor((s) => s.frame);
  const playing = useEditor((s) => s.playing);
  const selectedId = useEditor((s) => s.selectedItem);
  const tool = useEditor((s) => s.tool);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [safe, setSafe] = useState(false);
  const [inOut, setInOut] = useState<{ in: number | null; out: number | null }>({ in: null, out: null });
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const fmt = FORMATS[project.format];

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = zoom === "fit" ? Math.min((box.w - 24) / fmt.width, (box.h - 24) / fmt.height) : Number(zoom) / 100;
  const dispW = Math.max(1, fmt.width * scale);
  const dispH = Math.max(1, fmt.height * scale);

  const inputProps = useMemo<EditVideoProps>(() => ({ project, media, sfx, placeholders: true }), [project, media, sfx]);

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => set({ frame: e.detail.frame });
    const onPlay = () => set({ playing: true });
    const onPause = () => set({ playing: false });
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    p.addEventListener("ended", onPause);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
      p.removeEventListener("ended", onPause);
    };
  }, [timeline.durationInFrames > 1]);

  // Keep the player inside the edit when the edit gets shorter.
  useEffect(() => {
    if (frame > timeline.durationInFrames - 1) seek((timeline.durationInFrames - 1) / FPS);
  }, [timeline.durationInFrames, frame]);

  const total = timeline.durationInFrames / FPS;

  // Layers drawn in the composition carry data-item-id, so the monitor can find and move them.
  const surface = useRef<HTMLDivElement>(null);
  const rectOf = (id: string) => {
    const el = surface.current?.parentElement?.querySelector<HTMLElement>(`[data-item-id="${id}"]`);
    const host = surface.current?.getBoundingClientRect();
    if (!el || !host) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left - host.left, top: r.top - host.top, width: r.width, height: r.height };
  };
  const selected = project.items.find((i) => i.id === selectedId) ?? null;
  // Measuring forces a layout, so the selection box is only drawn while paused (it would lag a frame anyway).
  const selRect = !playing && selected && ["text", "shape", "media", "animation"].includes(selected.type) ? rectOf(selected.id) : null;

  const hitTest = (x: number, y: number): string | null => {
    const host = surface.current;
    if (!host) return null;
    const hr = host.getBoundingClientRect();
    const els = [...(host.parentElement ?? host).querySelectorAll<HTMLElement>("[data-item-id]")].reverse();
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (x >= r.left - hr.left && x <= r.right - hr.left && y >= r.top - hr.top && y <= r.bottom - hr.top) return el.dataset.itemId ?? null;
    }
    return null;
  };

  const onSurfaceDown = (e: React.PointerEvent) => {
    const host = surface.current!.getBoundingClientRect();
    const x = e.clientX - host.left;
    const y = e.clientY - host.top;
    if (tool === "type") {
      const item = makeText("title", "Your text", frame / FPS, { x: (x / dispW) * 100, y: (y / dispH) * 100 });
      commit((d) => void d.items.push(item));
      set({ selectedItem: item.id, tool: "select", workspace: "graphics" });
      return;
    }
    const hit = hitTest(x, y);
    set({ selectedItem: hit, selectedClip: null });
    if (hit) startMove(e, hit);
  };

  const startMove = (e: React.PointerEvent, id: string) => {
    const item = get().project!.items.find((i) => i.id === id) as (Item & { x: number; y: number }) | undefined;
    if (!item || !("x" in item)) return;
    e.preventDefault();
    const g = beginGesture();
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = item.x;
    const oy = item.y;
    const move = (ev: PointerEvent) => {
      let nx = ox + ((ev.clientX - sx) / dispW) * 100;
      let ny = oy + ((ev.clientY - sy) / dispH) * 100;
      // Snap to the centre lines, like Premiere's guides.
      if (Math.abs(nx - 50) < 1.2) nx = 50;
      if (Math.abs(ny - 50) < 1.2) ny = 50;
      g.update((d) => {
        const it = d.items.find((i) => i.id === id) as (Item & { x: number; y: number }) | undefined;
        if (it) {
          it.x = Math.round(nx * 10) / 10;
          it.y = Math.round(ny * 10) / 10;
        }
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

  const startScale = (e: React.PointerEvent) => {
    if (!selected) return;
    e.stopPropagation();
    e.preventDefault();
    const g = beginGesture();
    const sx = e.clientX;
    const start = structuredClone(selected);
    const move = (ev: PointerEvent) => {
      const k = Math.max(0.1, 1 + (ev.clientX - sx) / Math.max(40, (selRect?.width ?? 100) / 2));
      g.update((d) => {
        const it = d.items.find((i) => i.id === start.id);
        if (!it) return;
        if (it.type === "text" && start.type === "text") {
          it.style.size = Math.round(start.style.size * k);
          it.width = Math.min(100, Math.round(start.width * Math.max(1, k)));
        } else if (it.type === "shape" && start.type === "shape") {
          it.w = Math.round(start.w * k * 10) / 10;
          it.h = Math.round(start.h * k * 10) / 10;
        } else if (it.type === "media" && start.type === "media") it.scale = Math.min(1, Math.round(start.scale * k * 100) / 100);
        else if (it.type === "animation" && start.type === "animation") it.width = Math.min(100, Math.max(10, Math.round(start.width * k)));
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

  const exportFrame = async () => {
    await preloadFonts(project);
    smoothTextOutlines();
    const still = await renderStillOnWeb({
      composition: { component: EditVideo, durationInFrames: timeline.durationInFrames, fps: FPS, width: fmt.width, height: fmt.height, id: "still", defaultProps: inputProps },
      inputProps: { ...inputProps, placeholders: false },
      frame,
      licenseKey: "free-license",
    });
    const blob = await still.blob({ format: "png" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name} ${tc(frame / FPS).replace(/:/g, "-")}.png`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  };

  const busy = project.status === "transcribing" || project.status === "planning" || project.status === "importing";

  return (
    <Panel tabs={[{ id: "program", label: `Program: ${project.name}` }]} active="program" className="program">
      <div className="monitor" ref={stage} onPointerDown={(e) => e.target === stage.current && set({ selectedItem: null })}>
        {timeline.durationInFrames > 1 || project.mainAssetId ? (
          <div className="monitor-frame" style={{ width: dispW, height: dispH }}>
            <Player
              ref={player}
              component={EditVideo}
              inputProps={inputProps}
              durationInFrames={Math.max(1, timeline.durationInFrames)}
              compositionWidth={fmt.width}
              compositionHeight={fmt.height}
              fps={FPS}
              style={{ width: dispW, height: dispH }}
              spaceKeyToPlayOrPause={false}
              clickToPlay={false}
              doubleClickToFullscreen={false}
              acknowledgeRemotionLicense
              numberOfSharedAudioTags={8}
            />
            <div ref={surface} className={`monitor-surface tool-${tool}`} onPointerDown={onSurfaceDown} />
            {safe && <SafeZones format={project.format} />}
            {selRect && (
              <div className="sel-box" style={{ left: selRect.left, top: selRect.top, width: selRect.width, height: selRect.height }} onPointerDown={(e) => selected && startMove(e, selected.id)}>
                {["nw", "ne", "sw", "se"].map((h) => (
                  <i key={h} className={`handle h-${h}`} onPointerDown={startScale} />
                ))}
                <i className="anchor" />
              </div>
            )}
          </div>
        ) : (
          <div className="monitor-empty">
            <Icon name="film" size={28} />
            <p>Import a video to start. Drop it on the Project panel or use File → Import.</p>
          </div>
        )}
        {busy && (
          <div className="monitor-busy" role="status">
            <span className="spinner" />
            {project.statusDetail ?? "Working"}…
          </div>
        )}
      </div>

      <div className="monitor-bar">
        <span className="tc tc-now">{tc(frame / FPS)}</span>
        <Select<Zoom>
          label="Zoom level"
          value={zoom}
          onChange={setZoom}
          options={[
            { value: "fit", label: "Fit" },
            { value: "50", label: "50%" },
            { value: "75", label: "75%" },
            { value: "100", label: "100%" },
          ]}
        />
        <span className="monitor-format">{fmt.width}×{fmt.height} · {project.format}</span>
        <button type="button" className={`icon-btn${safe ? " on" : ""}`} onClick={() => setSafe(!safe)} title="Safe margins and platform UI zones">
          <Icon name="safe" />
        </button>
        <span className="tc tc-total">{tc(total)}</span>
      </div>

      <div className="scrub" onPointerDown={(e) => scrubFrom(e, total)}>
        <div className="scrub-fill" style={{ width: `${(frame / Math.max(1, timeline.durationInFrames - 1)) * 100}%` }} />
        {inOut.in !== null && <i className="scrub-in" style={{ left: `${(inOut.in / total) * 100}%` }} />}
        {inOut.out !== null && <i className="scrub-out" style={{ left: `${(inOut.out / total) * 100}%` }} />}
        <i className="scrub-head" style={{ left: `${(frame / Math.max(1, timeline.durationInFrames - 1)) * 100}%` }} />
      </div>

      <div className="transport" role="toolbar" aria-label="Transport">
        <button type="button" className="icon-btn" title="Mark In (I)" onClick={() => setInOut({ ...inOut, in: frame / FPS })}>
          <Icon name="markIn" />
        </button>
        <button type="button" className="icon-btn" title="Mark Out (O)" onClick={() => setInOut({ ...inOut, out: frame / FPS })}>
          <Icon name="markOut" />
        </button>
        <span className="transport-gap" />
        <button type="button" className="icon-btn" title="Go to In" onClick={() => seek(inOut.in ?? 0)}>
          <Icon name="goIn" />
        </button>
        <button type="button" className="icon-btn" title="Step back 1 frame (←)" onClick={() => seek((frame - 1) / FPS)}>
          <Icon name="stepBack" />
        </button>
        <button type="button" className="icon-btn play-btn" title="Play/Stop (Space)" onClick={() => player.current?.toggle()}>
          <Icon name={playing ? "pause" : "play"} size={18} />
        </button>
        <button type="button" className="icon-btn" title="Step forward 1 frame (→)" onClick={() => seek((frame + 1) / FPS)}>
          <Icon name="stepFwd" />
        </button>
        <button type="button" className="icon-btn" title="Go to Out" onClick={() => seek(inOut.out ?? total)}>
          <Icon name="goOut" />
        </button>
        <span className="transport-gap" />
        <button type="button" className="icon-btn" title="Export frame as PNG" onClick={() => void exportFrame()}>
          <Icon name="camera" />
        </button>
        <button type="button" className="icon-btn" title="Full screen" onClick={() => surface.current?.parentElement?.requestFullscreen?.()}>
          <Icon name="fullscreen" />
        </button>
      </div>
    </Panel>
  );
}

function scrubFrom(e: React.PointerEvent, total: number) {
  const el = e.currentTarget as HTMLElement;
  const at = (x: number) => {
    const r = el.getBoundingClientRect();
    seek(((x - r.left) / r.width) * total);
  };
  at(e.clientX);
  const move = (ev: PointerEvent) => at(ev.clientX);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

// Title-safe and action-safe guides, plus where TikTok/Reels put their own buttons and captions.
function SafeZones({ format }: { format: string }) {
  return (
    <div className="safe-zones" aria-hidden="true">
      <i className="safe-action" />
      <i className="safe-title" />
      <i className="safe-cross-h" />
      <i className="safe-cross-v" />
      {format === "9:16" && (
        <>
          <i className="ui-zone ui-right" title="Platform buttons" />
          <i className="ui-zone ui-bottom" title="Platform caption and username" />
          <i className="ui-zone ui-top" />
        </>
      )}
    </div>
  );
}
