import { useState } from "react";
import { FPS, LOOK_IDS, SFX_IDS, TEXT_PRESET_IDS, TRANSITIONS, uid, type AdjustItem, type AnimationItem, type Effects, type MediaAsset, type Motion } from "../../../src/shared/project";
import { LOOKS, TEXT_PRESETS, makeText } from "../../../src/shared/presets";
import { cutPoints } from "../../../src/shared/timeline";
import { commit, get, importFiles, resume, set, useEditor } from "../lib/store";
import { previewSfx } from "../lib/sfx";
import { Icon } from "./Icons";
import { Panel, shortTc } from "./controls";

export function ProjectPanel() {
  const [tab, setTab] = useState("project");
  return (
    <Panel
      tabs={[
        { id: "project", label: "Project" },
        { id: "effects", label: "Effects" },
      ]}
      active={tab}
      onTab={setTab}
      className="project-panel"
    >
      {tab === "project" ? <Bin /> : <EffectsLibrary />}
    </Panel>
  );
}

const fmtSize = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

function Bin() {
  const project = useEditor((s) => s.project)!;
  const thumbs = useEditor((s) => s.thumbs);
  const [over, setOver] = useState(false);
  const [sel, setSel] = useState<string | null>(null);

  const place = (a: MediaAsset) => {
    const t = get().frame / FPS;
    if (a.kind === "audio") {
      const total = get().timeline!.durationInFrames / FPS;
      commit((d) => {
        d.items = d.items.filter((i) => i.type !== "music");
        d.items.push({ id: uid("mu"), type: "music", assetId: a.id, start: 0, duration: total, trimStart: 0, volume: -18, duck: true, fadeIn: 0.5, fadeOut: 1.5 });
      });
      return;
    }
    if (a.role === "animation") {
      const item: AnimationItem = { id: uid("an"), type: "animation", start: t, duration: a.kind === "image" ? 2.5 : a.durationSec, prompt: a.note || a.name, status: "ready", assetId: a.id, fit: "overlay", x: 50, y: 40, width: 60, aspect: a.width && a.height ? a.width / a.height : 1, opacity: 100, trimStart: 0, animIn: "pop", animOut: "fade" };
      commit((d) => void d.items.push(item));
      set({ selectedItem: item.id });
      return;
    }
    const id = uid("m");
    commit((d) =>
      void d.items.push({ id, type: "media", assetId: a.id, start: t, duration: a.kind === "image" ? 2.5 : Math.min(3, a.durationSec), trimStart: 0, fit: "cover", x: 50, y: 50, scale: 1, radius: 0, opacity: 100, volume: -60, animIn: "fade", animOut: "fade", kenBurns: a.kind === "image" }),
    );
    set({ selectedItem: id });
  };

  return (
    <div
      className={`bin${over ? " over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void importFiles([...e.dataTransfer.files]);
      }}
    >
      <div className="bin-tools">
        <span className="bin-count">{project.assets.length} items</span>
        <label className="mini file-btn">
          <Icon name="upload" size={12} /> Import
          <input type="file" multiple accept="video/*,image/*,audio/*" onChange={(e) => void importFiles([...(e.target.files ?? [])])} />
        </label>
      </div>
      <div className="bin-head" aria-hidden="true">
        <span>Name</span>
        <span>Duration</span>
      </div>
      <ul className="bin-list">
        <li className="bin-row seq">
          <span className="bin-icon seq-icon">
            <Icon name="film" size={12} />
          </span>
          <span className="bin-name">{project.name}</span>
          <span className="bin-dur">{shortTc((get().timeline?.durationInFrames ?? 0) / FPS)}</span>
        </li>
        {project.assets.map((a) => (
          <li key={a.id}>
            <button type="button" className={`bin-row${sel === a.id ? " sel" : ""}`} onClick={() => setSel(a.id)} onDoubleClick={() => a.id !== project.mainAssetId && place(a)} title={a.id === project.mainAssetId ? "Main video (V1)" : "Double-click to place at the playhead"}>
              <span className={`bin-icon ${a.kind}`}>
                {thumbs[a.id]?.frames[0] ? <img src={thumbs[a.id].frames[0]} alt="" /> : <Icon name={a.kind === "video" ? "film" : a.kind === "image" ? "image" : "music"} size={12} />}
              </span>
              <span className="bin-name">
                {a.name}
                <span className="bin-meta">
                  {a.id === project.mainAssetId ? "Main · " : a.role === "animation" ? "Animation · " : ""}
                  {a.kind !== "audio" ? `${a.width}×${a.height} · ` : ""}
                  {fmtSize(a.size)}
                  {a.proxy ? " · proxy" : ""}
                </span>
              </span>
              <span className="bin-dur">{a.kind === "image" ? "still" : shortTc(a.durationSec)}</span>
            </button>
            {sel === a.id && (
              <div className="bin-actions">
                {a.id !== project.mainAssetId && (
                  <button type="button" className="mini" onClick={() => place(a)}>
                    {a.kind === "audio" ? "Use as music" : "Place at playhead"}
                  </button>
                )}
                {a.kind === "video" && a.id !== project.mainAssetId && (
                  <button
                    type="button"
                    className="mini"
                    onClick={() => {
                      commit((d) => {
                        d.mainAssetId = a.id;
                        d.words = [];
                        d.cuts = {};
                        d.rangeCuts = [];
                        d.splits = [];
                        d.emphasis = [];
                      });
                      void resume();
                    }}
                  >
                    Make main video
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {!project.assets.length && <p className="empty-note">Drop video, images and music here.</p>}
    </div>
  );
}

interface Entry {
  label: string;
  hint?: string;
  run: () => void;
  preview?: () => void;
}

function addAdjust(name: string, effects?: Partial<Effects>, motion?: Motion, duration = 2) {
  const item: AdjustItem = { id: uid("a"), type: "adjust", start: get().frame / FPS, duration, name, effects, motion, fade: motion ? 0 : 0.2 };
  commit((d) => void d.items.push(item));
  set({ selectedItem: item.id });
}

function nearestCut() {
  const t = get().timeline!;
  const now = get().frame / FPS;
  const cuts = cutPoints(t);
  return cuts.reduce<number | null>((b, c) => (b === null || Math.abs(c - now) < Math.abs(b - now) ? c : b), null) ?? now;
}

function EffectsLibrary() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ Looks: true });
  const groups: { name: string; entries: Entry[] }[] = [
    { name: "Looks", entries: LOOK_IDS.map((id) => ({ label: LOOKS[id].label, hint: "Lumetri look on the whole video", run: () => commit((d) => void (d.grade.look = id)) })) },
    {
      name: "Camera",
      entries: [
        { label: "Punch-in 115%", run: () => addAdjust("Zoom 115%", undefined, { scale: 1.15, x: 50, y: 40, rotation: 0, ease: "punch" }, 1.6) },
        { label: "Punch-in 130%", run: () => addAdjust("Zoom 130%", undefined, { scale: 1.3, x: 50, y: 38, rotation: 0, ease: "punch" }, 1.4) },
        { label: "Smooth zoom", run: () => addAdjust("Smooth zoom", undefined, { scale: 1.2, x: 50, y: 40, rotation: 0, ease: "smooth" }, 2) },
        { label: "Push in", run: () => addAdjust("Push in", undefined, { scale: 1.18, x: 50, y: 40, rotation: 0, ease: "push" }, 3) },
        { label: "Pull out", run: () => addAdjust("Pull out", undefined, { scale: 1.18, x: 50, y: 40, rotation: 0, ease: "pull" }, 3) },
        { label: "Drift", run: () => addAdjust("Drift", undefined, { scale: 1.1, x: 50, y: 45, rotation: 0, ease: "drift" }, 4) },
      ],
    },
    {
      name: "Video Transitions",
      entries: TRANSITIONS.map((k) => ({
        label: k.replace("-", " "),
        hint: "At the nearest cut",
        run: () => {
          const at = nearestCut();
          const dur = k === "dip-black" ? 0.5 : 0.3;
          commit((d) => void d.items.push({ id: uid("tr"), type: "transition", kind: k, start: Math.max(0, at - dur / 2), duration: dur, color: "#FFFFFF" }));
        },
      })),
    },
    {
      name: "Video Effects",
      entries: [
        { label: "Gaussian Blur", run: () => addAdjust("Blur", { blur: 14 }) },
        { label: "Zoom Blur", run: () => addAdjust("Zoom blur", { zoomBlur: 40 }, undefined, 0.6) },
        { label: "RGB Split", run: () => addAdjust("RGB split", { chromatic: 12 }, undefined, 1) },
        { label: "Black & White", run: () => addAdjust("Black & white", { mono: 100 }) },
        { label: "Glitch", run: () => addAdjust("Glitch", { glitch: 70 }, undefined, 0.8) },
        { label: "Light Leak", run: () => addAdjust("Light leak", { lightLeak: 80 }, undefined, 1.5) },
        { label: "Pixelate", run: () => addAdjust("Pixelate", { pixelate: 24 }, undefined, 1) },
        { label: "Light Sweep", run: () => addAdjust("Light sweep", { shine: true }, undefined, 1.2) },
      ],
    },
    {
      name: "Text Templates",
      entries: TEXT_PRESET_IDS.map((id) => ({
        label: TEXT_PRESETS[id].label,
        hint: TEXT_PRESETS[id].hint,
        run: () => {
          const item = makeText(id, undefined, get().frame / FPS);
          commit((d) => void d.items.push(item));
          set({ selectedItem: item.id, workspace: "graphics" });
        },
      })),
    },
    {
      name: "Sound Effects",
      entries: SFX_IDS.map((id) => ({
        label: id,
        run: () => commit((d) => void d.items.push({ id: uid("x"), type: "sfx", sound: id, start: get().frame / FPS, duration: 1.2, volume: -6 })),
        preview: () => previewSfx(id),
      })),
    },
  ];
  const needle = q.trim().toLowerCase();
  return (
    <div className="fxlib">
      <div className="bin-tools">
        <span className="search wide">
          <Icon name="search" size={12} />
          <input value={q} placeholder="Search effects" aria-label="Search effects" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </span>
      </div>
      <ul className="tree">
        {groups.map((g) => {
          const entries = needle ? g.entries.filter((e) => e.label.toLowerCase().includes(needle)) : g.entries;
          if (needle && !entries.length) return null;
          const isOpen = needle ? true : open[g.name];
          return (
            <li key={g.name}>
              <button type="button" className="tree-folder" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [g.name]: !isOpen })}>
                <Icon name={isOpen ? "chevronDown" : "chevronRight"} size={11} />
                <Icon name="folder" size={13} />
                {g.name}
              </button>
              {isOpen && (
                <ul>
                  {entries.map((e) => (
                    <li key={e.label} className="tree-item">
                      <button type="button" className="tree-leaf" onClick={e.run} title={`${e.hint ?? "Add at the playhead"} (click to apply)`}>
                        <span className="fx-badge">fx</span>
                        {e.label}
                      </button>
                      {e.preview && (
                        <button type="button" className="icon-btn sm" title="Preview" onClick={e.preview}>
                          <Icon name="play" size={10} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
