import { useEffect, useRef, useState } from "react";
import { FORMATS, FORMAT_IDS, FPS, mainAsset, uid, type AnimationItem, type FormatId } from "../../../src/shared/project";
import { makeText } from "../../../src/shared/presets";
import { cutPoints, outputToSource } from "../../../src/shared/timeline";
import { UserButton } from "@clerk/react";
import { closeProject, commit, flushCloud, get, importFiles, openProject, patchProject, player, redo, resume, seek, set, undo, useEditor, type Tool, type Workspace } from "../lib/store";
import { Setup } from "./Setup";
import { auth } from "../lib/api";
import { Icon, Mark } from "./Icons";
import { Splash } from "./Splash";
import { Splitter, useSize, tc } from "./controls";
import { ProgramMonitor } from "./ProgramMonitor";
import { Timeline, fitZoom } from "./Timeline";
import { Inspector, rippleDeleteClip } from "./Inspector";
import { ProjectPanel } from "./ProjectPanel";
import { Assistant } from "./Assistant";
import { cutSelection, restoreSelection, toggleKey } from "./TextPanel";
import { ExportView } from "./ExportView";

type Mode = "edit" | "export";

const WORKSPACES: { id: Workspace; label: string }[] = [
  { id: "editing", label: "Editing" },
  { id: "color", label: "Color" },
  { id: "graphics", label: "Graphics" },
  { id: "captions", label: "Captions" },
  { id: "audio", label: "Audio" },
];

export function Editor({ id }: { id: string }) {
  const project = useEditor((s) => s.project);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(() => (location.hash.includes("export") ? "export" : "edit"));
  const [help, setHelp] = useState(false);

  useEffect(() => {
    openProject(id)
      .then(() => {
        // An import that stopped before the main video arrived (the tab closed): back to setup.
        if (get().project?.status === "importing" && !get().project?.mainAssetId) patchProject({ status: "setup", statusDetail: undefined });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  // Leaving the project or the page sends the last changes to the account right away.
  useEffect(() => {
    const leave = () => void flushCloud();
    const hidden = () => document.visibilityState === "hidden" && leave();
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hidden);
      closeProject(id);
    };
  }, [id]);

  useShortcuts(setMode, () => setHelp(true));

  if (error) {
    return (
      <div className="center-note">
        <p>{error}</p>
        <a className="btn btn-blue" href="#/">
          Back to projects
        </a>
      </div>
    );
  }
  if (!project || project.id !== id) return <Splash label="Opening project…" />;
  if (project.status === "setup") return <Setup saveState={<SaveState />} />;

  return (
    <div className="app">
      <MenuBar setMode={setMode} showHelp={() => setHelp(true)} />
      <header className="header">
        <a className="header-home" href="#/" title="Home">
          <Mark size={20} />
        </a>
        <nav className="modes" aria-label="Mode">
          <a className="mode" href="#/new">
            Import
          </a>
          <button type="button" className={`mode${mode === "edit" ? " on" : ""}`} onClick={() => setMode("edit")}>
            Edit
          </button>
          <button type="button" className={`mode${mode === "export" ? " on" : ""}`} onClick={() => setMode("export")}>
            Export
          </button>
        </nav>
        <ProjectName />
        {mode === "edit" && <WorkspaceTabs />}
        <SaveState />
        {auth.enabled && (
          <span className="header-user">
            <UserButton />
          </span>
        )}
      </header>
      {mode === "edit" ? <EditMode /> : <ExportView onBack={() => setMode("edit")} />}
      <StatusBar />
      {help && <Shortcuts onClose={() => setHelp(false)} />}
    </div>
  );
}

function ProjectName() {
  const name = useEditor((s) => s.project!.name);
  const [editing, setEditing] = useState(false);
  return editing ? (
    <input
      className="project-name-input"
      autoFocus
      defaultValue={name}
      aria-label="Project name"
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v && v !== name) commit((d) => void (d.name = v));
        setEditing(false);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
      }}
    />
  ) : (
    <button type="button" className="project-name" onDoubleClick={() => setEditing(true)} title="Double-click to rename">
      {name}
    </button>
  );
}

function WorkspaceTabs() {
  const ws = useEditor((s) => s.workspace);
  return (
    <nav className="workspaces" aria-label="Workspace">
      {WORKSPACES.map((w) => (
        <button key={w.id} type="button" className={`ws${ws === w.id ? " on" : ""}`} onClick={() => set({ workspace: w.id })}>
          {w.label}
        </button>
      ))}
    </nav>
  );
}

function SaveState() {
  const saving = useEditor((s) => s.saving);
  const synced = useEditor((s) => s.synced);
  const uploading = useEditor((s) => s.tasks.some((t) => t.label.startsWith("Uploading")));
  if (synced === "off") return <span className="save-state">{saving ? "Saving…" : "Saved in this browser"}</span>;
  if (synced === "error")
    return (
      <button type="button" className="save-state warn" title="Saved in this browser. Click to try the account again." onClick={() => (set({ synced: "pending" }), void flushCloud())}>
        Not synced · retry
      </button>
    );
  return <span className="save-state">{saving || synced === "pending" ? "Saving…" : uploading ? "Saved · uploading media" : "Saved to your account"}</span>;
}

function EditMode() {
  const [left, setLeft] = useSize("left", 360);
  const [right, setRight] = useSize("right", 340);
  const [top, setTop] = useSize("top", Math.round(window.innerHeight * 0.52));
  const [proj, setProj] = useSize("proj", 270);
  return (
    <main className="work" style={{ gridTemplateColumns: `1fr 4px ${right}px` }}>
      <div className="work-main" style={{ gridTemplateRows: `${top}px 4px 1fr` }}>
        <div className="work-top" style={{ gridTemplateColumns: `${left}px 4px 1fr` }}>
          <Inspector />
          <Splitter dir="col" onDrag={(d) => setLeft(Math.max(260, Math.min(640, left + d)))} />
          <ProgramMonitor />
        </div>
        <Splitter dir="row" onDrag={(d) => setTop(Math.max(240, Math.min(window.innerHeight - 220, top + d)))} />
        <div className="work-bottom" style={{ gridTemplateColumns: `${proj}px 4px 36px 1fr 34px` }}>
          <ProjectPanel />
          <Splitter dir="col" onDrag={(d) => setProj(Math.max(180, Math.min(520, proj + d)))} />
          <Tools />
          <Timeline />
          <Meters />
        </div>
      </div>
      <Splitter dir="col" onDrag={(d) => setRight(Math.max(280, Math.min(560, right - d)))} />
      <Assistant />
    </main>
  );
}

const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: "select", icon: "select", label: "Selection Tool", key: "V" },
  { id: "razor", icon: "razor", label: "Razor Tool", key: "C" },
  { id: "type", icon: "type", label: "Type Tool", key: "T" },
];

function Tools() {
  const tool = useEditor((s) => s.tool);
  return (
    <section className="panel tools" aria-label="Tools">
      {TOOLS.map((t) => (
        <button key={t.id} type="button" className={`tool${tool === t.id ? " on" : ""}`} title={`${t.label} (${t.key})`} aria-pressed={tool === t.id} onClick={() => set({ tool: t.id })}>
          <Icon name={t.icon} size={17} />
        </button>
      ))}
    </section>
  );
}

// Level meter driven by the dialogue waveform under the playhead.
function Meters() {
  const frame = useEditor((s) => s.frame);
  const timeline = useEditor((s) => s.timeline);
  const project = useEditor((s) => s.project)!;
  const waves = useEditor((s) => s.waves);
  const peak = useRef(0);
  const asset = mainAsset(project);
  const src = timeline ? outputToSource(timeline, frame / FPS) : null;
  const w = asset ? waves[asset.id] : undefined;
  let level = 0;
  if (w && src !== null) {
    const i = Math.floor(src * 60);
    for (let k = i; k < i + 3 && k < w.length; k++) level = Math.max(level, w[k] ?? 0);
    level *= Math.pow(10, project.video.volume / 20);
  }
  const db = level > 0 ? 20 * Math.log10(level) : -60;
  const h = Math.max(0, Math.min(1, (db + 60) / 60));
  peak.current = Math.max(h, peak.current - 0.01);
  return (
    <section className="panel meters" aria-label="Audio meters">
      <div className="meter-scale" aria-hidden="true">
        {[0, -6, -12, -18, -24, -30, -36, -42, -48, -54].map((d) => (
          <span key={d} style={{ top: `${(-d / 60) * 100}%` }}>
            {d}
          </span>
        ))}
      </div>
      <div className="meter-bars" aria-hidden="true">
        {[0, 1].map((c) => (
          <span key={c} className="meter">
            <i style={{ height: `${h * 100}%` }} />
            <b style={{ bottom: `${peak.current * 100}%` }} />
          </span>
        ))}
      </div>
      <span className="meter-label">S S</span>
    </section>
  );
}

function StatusBar() {
  const tasks = useEditor((s) => s.tasks);
  const notice = useEditor((s) => s.notice);
  const project = useEditor((s) => s.project)!;
  const timeline = useEditor((s) => s.timeline)!;
  const src = mainAsset(project)?.durationSec ?? 0;
  return (
    <footer className="statusbar">
      {tasks.length ? (
        <span className="task">
          <span className="spinner sm" />
          {tasks[0].label}
          {tasks[0].progress !== null && <span className="task-bar"><i style={{ width: `${tasks[0].progress * 100}%` }} /></span>}
          {tasks.length > 1 && <span className="fine">+{tasks.length - 1} more</span>}
        </span>
      ) : project.status === "error" ? (
        <span className="status-error">
          {project.error}{" "}
          <button type="button" className="link" onClick={() => void resume()}>
            Try again
          </button>
        </span>
      ) : (
        <span>
          {src ? `${tc(src)} raw → ${tc(timeline.durationInFrames / FPS)} edit · ${timeline.clips.length} clips · ${project.items.length} layers` : "No media"}
        </span>
      )}
      {notice && (
        <span className="notice">
          {notice}
          <button type="button" className="icon-btn sm" aria-label="Dismiss" onClick={() => set({ notice: null })}>
            <Icon name="close" size={11} />
          </button>
        </span>
      )}
      <span className="status-right">{FORMATS[project.format].width}×{FORMATS[project.format].height} · 30 fps</span>
    </footer>
  );
}

// ---------- menu bar ----------

interface MenuItem {
  label: string;
  key?: string;
  run?: () => void;
  disabled?: boolean;
  sep?: boolean;
}

function MenuBar({ setMode, showHelp }: { setMode: (m: Mode) => void; showHelp: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  useEffect(() => {
    const close = () => setOpen(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);
  const menus: Record<string, MenuItem[]> = {
    File: [
      { label: "New Project…", run: () => (location.hash = "#/new") },
      { label: "Import…", key: `${mod}I`, run: () => file.current?.click() },
      { sep: true, label: "" },
      { label: "Export Media…", key: `${mod}M`, run: () => setMode("export") },
      { sep: true, label: "" },
      { label: "Close Project", run: () => (location.hash = "#/") },
    ],
    Edit: [
      { label: "Undo", key: `${mod}Z`, run: undo, disabled: !past },
      { label: "Redo", key: `⇧${mod}Z`, run: redo, disabled: !future },
      { sep: true, label: "" },
      { label: "Delete", key: "⌫", run: deleteSelection },
      { label: "Deselect All", key: "Esc", run: () => set({ selectedItem: null, selectedClip: null, wordSel: null }) },
    ],
    Clip: [
      { label: "Add Edit at Playhead", key: `${mod}K`, run: addEdit },
      { label: "Ripple Delete Clip", run: () => get().selectedClip !== null && rippleDeleteClip(get().selectedClip!) },
    ],
    Sequence: [
      ...FORMAT_IDS.map((f) => ({ label: `Format: ${FORMATS[f].label}`, run: () => commit((d) => void (d.format = f as FormatId)) })),
      { sep: true, label: "" },
      { label: "Apply Default Transition", key: `${mod}D`, run: addDefaultTransition },
      { label: "Zoom to Sequence", key: "\\", run: () => fitZoom(document.querySelector(".tl-scroll"), get().timeline!.durationInFrames / FPS) },
    ],
    Graphics: [
      { label: "New Text Layer", key: `${mod}T`, run: () => addTitle() },
      { label: "New Animation Placeholder", run: () => addAnimationPlaceholder() },
      { label: "Browse Templates", run: () => set({ workspace: "graphics" }) },
    ],
    Window: WORKSPACES.map((w) => ({ label: `Workspace: ${w.label}`, run: () => set({ workspace: w.id }) })),
    Help: [{ label: "Keyboard Shortcuts", key: "?", run: showHelp }],
  };
  return (
    <nav className="menubar" aria-label="Menu" onPointerDown={(e) => e.stopPropagation()}>
      <input ref={file} type="file" multiple hidden accept="video/*,image/*,audio/*" onChange={(e) => void importFiles([...(e.target.files ?? [])])} />
      {Object.entries(menus).map(([name, items]) => (
        <div key={name} className="menu">
          <button type="button" className={`menu-title${open === name ? " on" : ""}`} onClick={() => setOpen(open === name ? null : name)} onPointerEnter={() => open && setOpen(name)}>
            {name}
          </button>
          {open === name && (
            <div className="menu-list" role="menu">
              {items.map((it, i) =>
                it.sep ? (
                  <hr key={i} />
                ) : (
                  <button
                    key={it.label}
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    disabled={it.disabled}
                    onClick={() => {
                      setOpen(null);
                      it.run?.();
                    }}
                  >
                    <span>{it.label}</span>
                    {it.key && <kbd>{it.key}</kbd>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

// ---------- actions ----------

function deleteSelection() {
  const s = get();
  if (s.wordSel) return cutSelection();
  if (s.selectedItem) {
    commit((d) => void (d.items = d.items.filter((i) => i.id !== s.selectedItem)));
    set({ selectedItem: null });
    return;
  }
  if (s.selectedClip !== null) rippleDeleteClip(s.selectedClip);
}

function addEdit() {
  const t = get().timeline;
  if (!t) return;
  const src = outputToSource(t, get().frame / FPS);
  if (src !== null) commit((d) => void d.splits.push(Math.round(src * FPS) / FPS));
}

function addDefaultTransition() {
  const t = get().timeline!;
  const now = get().frame / FPS;
  const at = cutPoints(t).reduce<number | null>((b, c) => (b === null || Math.abs(c - now) < Math.abs(b - now) ? c : b), null) ?? now;
  commit((d) => void d.items.push({ id: uid("tr"), type: "transition", kind: "blur", start: Math.max(0, at - 0.2), duration: 0.4, color: "#FFFFFF" }));
}

function addTitle() {
  const item = makeText("title", "Your text", get().frame / FPS);
  commit((d) => void d.items.push(item));
  set({ selectedItem: item.id, workspace: "graphics" });
}

function addAnimationPlaceholder() {
  const item: AnimationItem = { id: uid("an"), type: "animation", start: get().frame / FPS, duration: 3, prompt: "Describe the animation, then press Generate", status: "placeholder", fit: "overlay", x: 50, y: 40, width: 60, aspect: 1, opacity: 100, trimStart: 0, animIn: "pop", animOut: "fade" };
  commit((d) => void d.items.push(item));
  set({ selectedItem: item.id, workspace: "editing" });
}

function useShortcuts(setMode: (m: Mode) => void, showHelp: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest("textarea, input, select, [contenteditable]")) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const s = get();
      const fps = FPS;
      const step = (n: number) => seek((s.frame + n) / fps);
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === "k") {
        e.preventDefault();
        addEdit();
      } else if (mod && k === "d") {
        e.preventDefault();
        addDefaultTransition();
      } else if (mod && k === "t") {
        e.preventDefault();
        addTitle();
      } else if (mod && (k === "m" || k === "e")) {
        e.preventDefault();
        setMode("export");
      } else if (mod && k === "i") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".menubar input[type=file]")?.click();
      } else if (mod) return;
      else if (e.key === " ") {
        if (t?.closest("button")) return;
        e.preventDefault();
        player.current?.toggle();
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(e.shiftKey ? -5 : -1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(e.shiftKey ? 5 : 1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const now = s.frame / fps;
        const pts = [0, ...cutPoints(s.timeline!), s.timeline!.durationInFrames / fps];
        const next = e.key === "ArrowUp" ? [...pts].reverse().find((p) => p < now - 0.01) : pts.find((p) => p > now + 0.01);
        if (next !== undefined) seek(next);
      } else if (e.key === "Home") seek(0);
      else if (e.key === "End") seek(s.timeline!.durationInFrames / fps);
      else if (k === "j") seek(s.frame / fps - 1);
      else if (k === "k") {
        if (s.wordSel) toggleKey();
        else player.current?.pause();
      } else if (k === "l") player.current?.play();
      else if (k === "r" && s.wordSel) restoreSelection();
      else if (k === "v") set({ tool: "select" });
      else if (k === "c") set({ tool: "razor" });
      else if (k === "t") set({ tool: "type" });
      else if (e.key === "=" || e.key === "+") set({ pxPerSec: Math.min(600, s.pxPerSec * 1.25) });
      else if (e.key === "-") set({ pxPerSec: Math.max(8, s.pxPerSec / 1.25) });
      else if (e.key === "\\") fitZoom(document.querySelector(".tl-scroll"), s.timeline!.durationInFrames / fps);
      else if (e.key === "Escape") set({ selectedItem: null, selectedClip: null, wordSel: null, tool: "select" });
      else if (e.key === "?") showHelp();
      else if (e.key === "/") {
        e.preventDefault();
        document.querySelector<HTMLTextAreaElement>(".prompt textarea")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMode, showHelp]);
}

function Shortcuts({ onClose }: { onClose: () => void }) {
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const rows: [string, string][] = [
    ["Space", "Play / stop"],
    ["J / K / L", "Back 1 s / stop / play"],
    ["← →", "Step one frame (Shift: five)"],
    ["↑ ↓", "Previous / next edit point"],
    ["V / C / T", "Selection, Razor, Type tool"],
    [`${mod}K`, "Add edit at playhead"],
    ["Delete", "Delete layer, ripple delete clip, or cut selected words"],
    ["R / K", "Restore / key word (with words selected)"],
    [`${mod}D`, "Default transition at nearest cut"],
    [`${mod}T`, "New text layer"],
    ["= / −", "Zoom timeline"],
    ["\\", "Zoom to sequence"],
    ["/", "Ask the Assistant"],
    [`${mod}Z / ⇧${mod}Z`, "Undo / redo"],
    [`${mod}M`, "Export"],
  ];
  return (
    <div className="modal-back" onPointerDown={onClose}>
      <div className="modal" role="dialog" aria-label="Keyboard shortcuts" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Keyboard Shortcuts</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <dl className="shortcuts">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

