import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { EditVideo } from "../../src/remotion/EditVideo";
import { FPS, HEIGHT, WIDTH, type Edit, type Project } from "../../src/shared/project";
import { buildTimeline } from "../../src/shared/timeline";
import { api } from "./api";
import { goHome } from "./App";
import { CutLegend, Transcript, selectionRange, type Selection } from "./Transcript";
import { KeyBanner, StatusPill, formatDuration } from "./ui";

type Tab = "transcript" | "brief" | "style";
const BUSY: Project["status"][] = ["preparing", "transcribing", "planning"];
const STEPS: { status: Project["status"]; label: string }[] = [
  { status: "preparing", label: "Prepare footage" },
  { status: "transcribing", label: "Transcribe speech" },
  { status: "planning", label: "AI edit plan" },
];

export function Editor({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("transcript");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [past, setPast] = useState<Edit[]>([]);
  const [future, setFuture] = useState<Edit[]>([]);
  const [briefDraft, setBriefDraft] = useState<string | null>(null);
  const player = useRef<PlayerRef>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  // Load, then poll while the server is working on this project.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const fresh = await api.get(id);
        if (!alive) return;
        setProject((prev) => {
          // While only an export is running, keep local edits and refresh its progress.
          if (prev && prev.status === "ready" && fresh.status === "ready") return { ...prev, render: fresh.render };
          return fresh;
        });
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    const timer = window.setInterval(tick, 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [id]);

  const busy = project ? BUSY.includes(project.status) : true;
  const rendering = project?.render.status === "rendering";

  const timeline = useMemo(
    () =>
      project?.source
        ? buildTimeline(project.words, project.edit, project.source.durationSec || 1, FPS)
        : null,
    [project?.words, project?.edit, project?.source],
  );

  const inputProps = useMemo(
    () => (project ? { project, videoSrc: `${window.location.origin}/media/${project.id}/proxy.mp4` } : null),
    // The player only needs to change when the edit itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project?.id, project?.words, project?.edit, project?.source],
  );

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setCurrentMs((e.detail.frame / FPS) * 1000);
    p.addEventListener("frameupdate", onFrame);
    return () => p.removeEventListener("frameupdate", onFrame);
  }, [inputProps !== null, busy]);

  const currentWordId = useMemo(() => {
    if (!timeline) return null;
    let current: string | null = null;
    for (const w of timeline.words) {
      if (w.startMs <= currentMs + 1) current = w.id;
      else break;
    }
    return current;
  }, [timeline, currentMs]);

  // Every manual change goes through here: local state, undo history and a debounced save.
  const changeEdit = useCallback(
    (next: Edit) => {
      if (!project) return;
      setPast((p) => [...p.slice(-99), project.edit]);
      setFuture([]);
      setProject({ ...project, edit: next });
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void api.patch(project.id, { edit: next }).then((saved) =>
          setProject((prev) => (prev ? { ...prev, render: saved.render } : prev)),
        );
      }, 400);
    },
    [project],
  );

  const undo = useCallback(() => {
    if (!project || !past.length) return;
    const prev = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture([project.edit, ...future]);
    setProject({ ...project, edit: prev });
    void api.patch(project.id, { edit: prev });
  }, [project, past, future]);

  const redo = useCallback(() => {
    if (!project || !future.length) return;
    const next = future[0];
    setFuture(future.slice(1));
    setPast([...past, project.edit]);
    setProject({ ...project, edit: next });
    void api.patch(project.id, { edit: next });
  }, [project, past, future]);

  const selectedIds = useMemo(() => {
    const r = selectionRange(selection);
    return r && project ? project.words.slice(r[0], r[1] + 1).map((w) => w.id) : [];
  }, [selection, project]);

  const cutSelection = useCallback(() => {
    if (!project || !selectedIds.length) return;
    const cuts = { ...project.edit.cuts };
    for (const id of selectedIds) cuts[id] = "manual";
    changeEdit({ ...project.edit, cuts, emphasis: project.edit.emphasis.filter((e) => !cuts[e]) });
  }, [project, selectedIds, changeEdit]);

  const restoreSelection = useCallback(() => {
    if (!project || !selectedIds.length) return;
    const cuts = { ...project.edit.cuts };
    for (const id of selectedIds) delete cuts[id];
    changeEdit({ ...project.edit, cuts });
  }, [project, selectedIds, changeEdit]);

  const toggleKeyWord = useCallback(() => {
    if (!project || !selectedIds.length) return;
    const kept = selectedIds.filter((id) => !project.edit.cuts[id]);
    const all = kept.every((id) => project.edit.emphasis.includes(id));
    const emphasis = all
      ? project.edit.emphasis.filter((id) => !kept.includes(id))
      : [...new Set([...project.edit.emphasis, ...kept])];
    changeEdit({ ...project.edit, emphasis });
  }, [project, selectedIds, changeEdit]);

  const seekToWord = useCallback(
    (index: number) => {
      if (!project || !timeline) return;
      // A cut word has no place in the edit; jump to the next word that is kept.
      const target = project.words.slice(index).find((w) => !project.edit.cuts[w.id]);
      const tw = target && timeline.words.find((t) => t.id === target.id);
      if (tw) player.current?.seekTo(Math.floor((tw.startMs / 1000) * FPS));
    },
    [project, timeline],
  );

  // Keyboard: Delete cuts, R restores, K marks a key word, Space plays, Cmd+Z undoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("textarea, input, select")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        cutSelection();
      } else if (e.key.toLowerCase() === "r" && !mod) restoreSelection();
      else if (e.key.toLowerCase() === "k" && !mod) toggleKeyWord();
      else if (e.key === " ") {
        e.preventDefault();
        player.current?.toggle();
      } else if (e.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, cutSelection, restoreSelection, toggleKeyWord]);

  if (loadError && !project) {
    return (
      <div className="center-message">
        <p>{loadError}</p>
        <button onClick={goHome}>Back to projects</button>
      </div>
    );
  }
  if (!project) return <div className="center-message">Loading…</div>;

  const replan = async () => {
    if (briefDraft !== null) await api.patch(project.id, { brief: briefDraft });
    setBriefDraft(null);
    await api.replan(project.id);
    setProject({ ...project, brief: briefDraft ?? project.brief, status: "planning" });
    setPast([]);
    setFuture([]);
  };

  const outSec = timeline ? timeline.durationInFrames / FPS : 0;
  const srcSec = project.source?.durationSec ?? 0;
  const style = project.edit.captionStyle;
  const setStyle = (change: Partial<typeof style>) =>
    changeEdit({ ...project.edit, captionStyle: { ...style, ...change } });

  return (
    <div className="editor">
      <header className="topbar">
        <button className="ghost" onClick={goHome} aria-label="Back to projects">
          ← Projects
        </button>
        <div className="title">
          <strong>{project.name}</strong>
          <StatusPill project={project} />
        </div>
        <div className="topbar-actions">
          {timeline && project.status === "ready" && (
            <span className="stat">
              {formatDuration(srcSec)} → <strong>{formatDuration(outSec)}</strong>
            </span>
          )}
          <button className="ghost" onClick={undo} disabled={!past.length} title="Undo (⌘Z)">
            Undo
          </button>
          <ExportButton project={project} onStart={() => setProject({ ...project, render: { status: "rendering", progress: 0 } })} />
        </div>
      </header>

      <KeyBanner />

      <main className="workspace">
        <section className="stage">
          {busy || !inputProps || !timeline ? (
            <Progress project={project} />
          ) : (
            <div className="player-frame">
              <Player
                ref={player}
                component={EditVideo}
                inputProps={inputProps}
                durationInFrames={timeline.durationInFrames}
                compositionWidth={WIDTH}
                compositionHeight={HEIGHT}
                fps={FPS}
                controls
                clickToPlay
                spaceKeyToPlayOrPause={false}
                acknowledgeRemotionLicense
                style={{ width: "100%", height: "100%" }}
              />
            </div>
          )}
          {project.status === "error" && (
            <div className="error-box">
              <p>{project.error}</p>
              <button className="primary" onClick={() => api.analyze(project.id)}>
                Try again
              </button>
            </div>
          )}
        </section>

        <aside className="panel">
          <nav className="tabs" role="tablist">
            {(["transcript", "brief", "style"] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? "tab tab-active" : "tab"}
                onClick={() => setTab(t)}
              >
                {t === "transcript" ? "Transcript" : t === "brief" ? "AI edit" : "Captions"}
              </button>
            ))}
          </nav>

          {tab === "transcript" && (
            <div className="panel-body">
              <div className="toolbar">
                <button onClick={cutSelection} disabled={!selectedIds.length || busy} title="Delete">
                  Cut
                </button>
                <button onClick={restoreSelection} disabled={!selectedIds.length || busy} title="R">
                  Restore
                </button>
                <button onClick={toggleKeyWord} disabled={!selectedIds.length || busy} title="K">
                  Key word
                </button>
                <span className="hint">Click a word to jump · Shift-click or drag to select</span>
              </div>
              <CutLegend edit={project.edit} />
              <Transcript
                words={project.words}
                edit={project.edit}
                currentWordId={currentWordId}
                selection={selection}
                onSelect={setSelection}
                onWordClick={seekToWord}
              />
            </div>
          )}

          {tab === "brief" && (
            <div className="panel-body">
              {project.edit.summary && (
                <div className="summary">
                  <h3>What the AI did</h3>
                  <p>{project.edit.summary}</p>
                </div>
              )}
              <label className="field">
                <span>Brief</span>
                <textarea
                  rows={6}
                  value={briefDraft ?? project.brief}
                  onChange={(e) => setBriefDraft(e.target.value)}
                  placeholder="Describe the edit you want"
                />
              </label>
              <button className="primary" onClick={replan} disabled={busy || !project.words.length}>
                Re-edit with AI
              </button>
              <p className="muted small">
                The AI replaces its own cuts and key words. Words you cut yourself stay cut.
              </p>
            </div>
          )}

          {tab === "style" && (
            <div className="panel-body style-grid">
              <label className="field">
                <span>Position</span>
                <select value={style.position} onChange={(e) => setStyle({ position: e.target.value as "lower" | "center" })}>
                  <option value="lower">Lower third</option>
                  <option value="center">Center</option>
                </select>
              </label>
              <label className="field">
                <span>Words on screen at once: {style.maxWordsPerPage}</span>
                <input
                  type="range"
                  min={1}
                  max={6}
                  value={style.maxWordsPerPage}
                  onChange={(e) => setStyle({ maxWordsPerPage: Number(e.target.value) })}
                />
              </label>
              <label className="field checkbox">
                <input type="checkbox" checked={style.uppercase} onChange={(e) => setStyle({ uppercase: e.target.checked })} />
                <span>Uppercase</span>
              </label>
              <label className="field">
                <span>Spoken word colour</span>
                <input type="color" value={style.highlightColor} onChange={(e) => setStyle({ highlightColor: e.target.value })} />
              </label>
              <label className="field">
                <span>Key word colour</span>
                <input type="color" value={style.emphasisColor} onChange={(e) => setStyle({ emphasisColor: e.target.value })} />
              </label>
              <label className="field">
                <span>Trim pauses longer than {project.edit.settings.maxPauseSec.toFixed(2)}s</span>
                <input
                  type="range"
                  min={0.15}
                  max={1.5}
                  step={0.05}
                  value={project.edit.settings.maxPauseSec}
                  onChange={(e) =>
                    changeEdit({
                      ...project.edit,
                      settings: { ...project.edit.settings, maxPauseSec: Number(e.target.value) },
                    })
                  }
                />
              </label>
            </div>
          )}
        </aside>
      </main>
      {rendering && <div className="render-bar" style={{ width: `${project.render.progress * 100}%` }} />}
    </div>
  );
}

function Progress({ project }: { project: Project }) {
  const active = STEPS.findIndex((s) => s.status === project.status);
  return (
    <div className="progress">
      <ol>
        {STEPS.map((s, i) => (
          <li key={s.status} className={i < active ? "done" : i === active ? "active" : ""}>
            {s.label}
          </li>
        ))}
      </ol>
      {project.statusDetail && <p className="muted">{project.statusDetail}…</p>}
    </div>
  );
}

function ExportButton({ project, onStart }: { project: Project; onStart: () => void }) {
  const r = project.render;
  const start = async () => {
    onStart();
    await api.render(project.id);
  };
  if (r.status === "rendering") {
    return <button className="primary" disabled>Exporting {Math.round(r.progress * 100)}%</button>;
  }
  return (
    <>
      {r.status === "done" && (
        <a className="button" href={`/media/${project.id}/export.mp4?download`} title={r.stale ? "This export is older than your latest changes" : undefined}>
          Download{r.stale ? " (old)" : ""}
        </a>
      )}
      {r.status === "error" && <span className="error small" title={r.error}>Export failed</span>}
      <button className="primary" onClick={start} disabled={project.status !== "ready"}>
        {r.status === "done" ? "Export again" : "Export MP4"}
      </button>
    </>
  );
}
