import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { EditVideo } from "../../src/remotion/EditVideo";
import { FPS, HEIGHT, WIDTH, type Edit, type Project } from "../../src/shared/project";
import { buildTimeline } from "../../src/shared/timeline";
import { api } from "./api";
import { REASON_NOTE, Script, selectionRange, type Selection } from "./Transcript";
import { KeyStrip, Wordmark, formatDuration, timecode } from "./ui";

const BUSY: Project["status"][] = ["preparing", "transcribing", "planning"];
const STEPS: { status: Project["status"]; label: string }[] = [
  { status: "preparing", label: "Preparing the footage" },
  { status: "transcribing", label: "Transcribing" },
  { status: "planning", label: "Reading it through and cutting" },
];
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

// Every state can be opened by URL for review and screenshots, e.g. #/p/<id>?state=error.
// These are shown locally only; nothing is saved while a review state is open.
type ReviewState = "processing" | "error" | "exporting" | "exported" | "captions" | "playing" | "selected" | null;
const reviewState = (): ReviewState =>
  (new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("state") as ReviewState) ?? null;

function withReviewState(p: Project, state: ReviewState): Project {
  switch (state) {
    case "processing":
      return { ...p, status: "planning", statusDetail: "Reading it through and cutting" };
    case "error":
      return { ...p, status: "error", error: "Transcription failed (401): the ElevenLabs key was not accepted. Check ELEVENLABS_API_KEY in .env, restart, then try again." };
    case "exporting":
      return { ...p, render: { status: "rendering", progress: 0.42 } };
    case "exported":
      return { ...p, render: { status: "done", progress: 1, stale: true, finishedAt: p.updatedAt } };
    default:
      return p;
  }
}

export function Editor({ id }: { id: string }) {
  const [state] = useState(reviewState);
  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
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
          // While only an export runs, keep local edits and refresh its progress.
          if (state) return prev ?? withReviewState(fresh, state);
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
  }, [id, state]);

  const busy = project ? BUSY.includes(project.status) : true;

  const timeline = useMemo(
    () =>
      project?.source && project.status === "ready"
        ? buildTimeline(project.words, project.edit, project.source.durationSec || 1, FPS)
        : null,
    [project?.words, project?.edit, project?.source, project?.status],
  );

  const inputProps = useMemo(
    () => (project ? { project, videoSrc: `${window.location.origin}/media/${project.id}/proxy.mp4` } : null),
    // The preview only changes when the edit itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project?.id, project?.words, project?.edit, project?.source],
  );

  const playerReady = Boolean(timeline && inputProps);
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
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
  }, [playerReady]);

  const reviewApplied = useRef(false);
  useEffect(() => {
    if (!project || !timeline || reviewApplied.current) return;
    reviewApplied.current = true;
    if (state === "selected") {
      const start = project.words.findIndex((w) => w.text.toLowerCase().startsWith("ways"));
      if (start >= 0) setSelection({ anchor: start, focus: start + 3 });
    }
    if (state === "playing") {
      const target = timeline.words[Math.floor(timeline.words.length / 2)];
      const f = Math.floor((target.startMs / 1000) * FPS) + 2;
      window.setTimeout(() => {
        player.current?.seekTo(f);
        setFrame(f);
      }, 300);
    }
  }, [project, timeline, state]);

  const currentWordId = useMemo(() => {
    if (!timeline) return null;
    const ms = (frame / FPS) * 1000;
    let current: string | null = null;
    for (const w of timeline.words) {
      if (w.startMs <= ms + 1) current = w.id;
      else break;
    }
    return current;
  }, [timeline, frame]);

  // Every manual change goes through here: local state, undo history and a debounced save.
  const changeEdit = useCallback(
    (next: Edit) => {
      if (!project) return;
      setPast((p) => [...p.slice(-99), project.edit]);
      setFuture([]);
      setProject({ ...project, edit: next });
      window.clearTimeout(saveTimer.current);
      if (state) return;
      saveTimer.current = window.setTimeout(() => {
        void api.patch(project.id, { edit: next }).then((saved) =>
          setProject((prev) => (prev ? { ...prev, render: saved.render } : prev)),
        );
      }, 400);
    },
    [project, state],
  );

  const undo = useCallback(() => {
    if (!project || !past.length) return;
    const prev = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture([project.edit, ...future]);
    setProject({ ...project, edit: prev });
    if (!state) void api.patch(project.id, { edit: prev });
  }, [project, past, future, state]);

  const redo = useCallback(() => {
    if (!project || !future.length) return;
    const next = future[0];
    setFuture(future.slice(1));
    setPast([...past, project.edit]);
    setProject({ ...project, edit: next });
    if (!state) void api.patch(project.id, { edit: next });
  }, [project, past, future, state]);

  const selectedIds = useMemo(() => {
    const r = selectionRange(selection);
    return r && project ? project.words.slice(r[0], r[1] + 1).map((w) => w.id) : [];
  }, [selection, project]);

  const cutSelection = useCallback(() => {
    if (!project || !selectedIds.length) return;
    const cuts = { ...project.edit.cuts };
    for (const wid of selectedIds) cuts[wid] ??= "manual";
    changeEdit({ ...project.edit, cuts, emphasis: project.edit.emphasis.filter((e) => !cuts[e]) });
    setSelection(null);
  }, [project, selectedIds, changeEdit]);

  const restoreSelection = useCallback(() => {
    if (!project || !selectedIds.length) return;
    const cuts = { ...project.edit.cuts };
    for (const wid of selectedIds) delete cuts[wid];
    changeEdit({ ...project.edit, cuts });
    setSelection(null);
  }, [project, selectedIds, changeEdit]);

  const toggleHighlight = useCallback(() => {
    if (!project || !selectedIds.length) return;
    const kept = selectedIds.filter((wid) => !project.edit.cuts[wid]);
    const all = kept.every((wid) => project.edit.emphasis.includes(wid));
    const emphasis = all
      ? project.edit.emphasis.filter((wid) => !kept.includes(wid))
      : [...new Set([...project.edit.emphasis, ...kept])];
    changeEdit({ ...project.edit, emphasis });
  }, [project, selectedIds, changeEdit]);

  const seekToWord = useCallback(
    (index: number) => {
      if (!project || !timeline) return;
      // A cut word is not in the edit; jump to the next word that is kept.
      const target = project.words.slice(index).find((w) => !project.edit.cuts[w.id]);
      const tw = target && timeline.words.find((t) => t.id === target.id);
      if (tw) player.current?.seekTo(Math.floor((tw.startMs / 1000) * FPS));
    },
    [project, timeline],
  );

  // Keyboard: Delete cuts, R restores, K highlights, Space plays, Cmd/Ctrl+Z undoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("textarea, input, select")) return;
      if (target?.closest("button, summary, a") && (e.key === " " || e.key === "Enter")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        cutSelection();
      } else if (!mod && e.key.toLowerCase() === "r") restoreSelection();
      else if (!mod && e.key.toLowerCase() === "k") toggleHighlight();
      else if (e.key === " ") {
        e.preventDefault();
        player.current?.toggle();
      } else if (e.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, cutSelection, restoreSelection, toggleHighlight]);

  if (loadError && !project) {
    return (
      <div className="center-note">
        <p>{loadError}</p>
        <a className="btn btn-paper" href="#/">All edits</a>
      </div>
    );
  }
  if (!project) return <div className="center-note">Opening the script…</div>;

  const replan = async () => {
    if (briefDraft !== null) await api.patch(project.id, { brief: briefDraft });
    await api.replan(project.id);
    setProject({ ...project, brief: briefDraft ?? project.brief, status: "planning" });
    setBriefDraft(null);
    setPast([]);
    setFuture([]);
  };

  const outSec = timeline ? timeline.durationInFrames / FPS : 0;
  const srcSec = project.source?.durationSec ?? 0;
  const style = project.edit.captionStyle;
  const setStyle = (change: Partial<typeof style>) => changeEdit({ ...project.edit, captionStyle: { ...style, ...change } });
  const cutCount = Object.keys(project.edit.cuts).length;
  const hasSelection = selectedIds.length > 0;

  return (
    <div className="editor">
      <section className="desk" aria-label="Script">
        <header className="deskbar">
          <Wordmark />
          <span className="project-name" title={project.name}>{project.name}</span>
          {project.status === "ready" && project.words.length > 0 && (
            <span className="desk-hint" aria-live="polite">
              {hasSelection
                ? `${selectedIds.length} word${selectedIds.length > 1 ? "s" : ""} selected`
                : "Select words to cut, restore or highlight"}
            </span>
          )}
          {project.status === "ready" && (
            <div className="tools" role="toolbar" aria-label="Edit the script">
              <button className="tool" onClick={cutSelection} disabled={!hasSelection} aria-keyshortcuts="Delete">
                Cut <kbd>⌫</kbd>
              </button>
              <button className="tool" onClick={restoreSelection} disabled={!hasSelection} aria-keyshortcuts="R">
                Restore <kbd>R</kbd>
              </button>
              <button className="tool" onClick={toggleHighlight} disabled={!hasSelection} aria-keyshortcuts="K">
                Highlight <kbd>K</kbd>
              </button>
              <button className="tool" onClick={undo} disabled={!past.length} aria-keyshortcuts="Meta+Z">
                Undo <kbd>{MOD}Z</kbd>
              </button>
            </div>
          )}
        </header>
        <KeyStrip />

        <article className="sheet script-sheet">
          <h1 className="slug">{project.name}</h1>
          {project.brief && <p className="sheet-meta sheet-brief">Brief: {project.brief}</p>}
          {project.status === "ready" && project.edit.summary && (
            <p className="editor-note">
              {project.edit.summary}
            </p>
          )}

          {busy && <Working project={project} />}

          {project.status === "error" && (
            <div className="alarm-note" role="alert">
              <p>{project.error}</p>
              <button className="btn btn-ink" onClick={() => api.analyze(project.id)}>Try again</button>
            </div>
          )}

          {project.status === "ready" && project.words.length > 0 && (
            <>
              <Script
                words={project.words}
                edit={project.edit}
                currentWordId={playing || frame > 0 ? currentWordId : null}
                selection={selection}
                onSelect={setSelection}
                onWordClick={seekToWord}
              />
            </>
          )}
          {project.status === "ready" && project.words.length === 0 && (
            <p className="sheet-meta">No speech in this video, so it was kept whole.</p>
          )}
        </article>
      </section>

      <aside className="side" aria-label="Preview and export">
        <div className="side-head">
          <p className="lengths">
            {timeline ? (
              <>
                {formatDuration(srcSec)} <span aria-hidden="true">→</span>
                <span className="visually-hidden">cut to</span> <TickingLength sec={outSec} />
              </>
            ) : srcSec ? (
              formatDuration(srcSec)
            ) : (
              "No video yet"
            )}
          </p>
          <ExportButton project={project} onStart={() => setProject({ ...project, render: { status: "rendering", progress: 0 } })} />
        </div>
        <ExportFile project={project} />

        <div className="preview">
          {timeline && inputProps ? (
            <Player
              ref={player}
              component={EditVideo}
              inputProps={inputProps}
              durationInFrames={timeline.durationInFrames}
              compositionWidth={WIDTH}
              compositionHeight={HEIGHT}
              fps={FPS}
              clickToPlay
              spaceKeyToPlayOrPause={false}
              acknowledgeRemotionLicense
              className="player"
              style={{ width: "100%", height: "100%" }}
            />
          ) : (
            <div className="preview-empty">{busy ? "The preview appears when the first cut is ready." : "No preview yet."}</div>
          )}
        </div>

        {timeline && (
          <div className="transport">
            <button className="play" onClick={() => player.current?.toggle()} aria-label={playing ? "Pause" : "Play"}>
              {playing ? (
                <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" /><rect x="9.5" y="2" width="3.5" height="12" /></svg>
              ) : (
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2l10 6-10 6z" /></svg>
              )}
            </button>
            <span className="time">{timecode(frame / FPS)}</span>
            <div className="scrub">
              <div className="scrub-track" aria-hidden="true">
                {timeline.clips.slice(1).map((c) => (
                  <i key={c.fromFrame} className="scrub-cut" style={{ left: `${(c.fromFrame / timeline.durationInFrames) * 100}%` }} />
                ))}
                <b className="scrub-head" style={{ left: `${(frame / Math.max(1, timeline.durationInFrames - 1)) * 100}%` }} />
              </div>
              <input
                type="range"
                min={0}
                max={timeline.durationInFrames - 1}
                value={frame}
                aria-label="Position"
                aria-valuetext={timecode(frame / FPS)}
                onChange={(e) => {
                  const f = Number(e.target.value);
                  setFrame(f);
                  player.current?.seekTo(f);
                }}
              />
            </div>
            <span className="time">{timecode(outSec)}</span>
          </div>
        )}

        {project.status === "ready" && (
          <p className="cut-tally">
            {cutCount ? `${cutCount} words struck` : "Nothing struck yet"}
            {summaryReasons(project.edit)}
          </p>
        )}

        <details className="fold" open={state === "captions" || undefined}>
          <summary>Captions</summary>
          <div className="fold-body">
            <div className="field-row">
              <span className="field-label" id="pos-l">Position</span>
              <div className="seg" role="radiogroup" aria-labelledby="pos-l">
                {(["lower", "center"] as const).map((p) => (
                  <button key={p} role="radio" aria-checked={style.position === p} onClick={() => setStyle({ position: p })}>
                    {p === "lower" ? "Lower third" : "Centre"}
                  </button>
                ))}
              </div>
            </div>
            <label className="field-row">
              <span className="field-label">Words on screen</span>
              <span className="range-wrap">
                <input type="range" min={1} max={6} value={style.maxWordsPerPage} onChange={(e) => setStyle({ maxWordsPerPage: Number(e.target.value) })} />
                <output>{style.maxWordsPerPage}</output>
              </span>
            </label>
            <label className="field-row check">
              <input type="checkbox" checked={style.uppercase} onChange={(e) => setStyle({ uppercase: e.target.checked })} />
              <span>All capitals</span>
            </label>
            <div className="field-row swatches">
              <label className="swatch">
                <span className="swatch-sample" aria-hidden="true">
                  <span>THE <b style={{ color: style.highlightColor }}>SECOND</b> ONE</span>
                </span>
                <input type="color" value={style.highlightColor} onChange={(e) => setStyle({ highlightColor: e.target.value })} />
                <span>Spoken word</span>
              </label>
              <label className="swatch">
                <span className="swatch-sample" aria-hidden="true">
                  <span>CUT EVERY <b style={{ color: style.emphasisColor }}>PAUSE</b></span>
                </span>
                <input type="color" value={style.emphasisColor} onChange={(e) => setStyle({ emphasisColor: e.target.value })} />
                <span>Highlighted word</span>
              </label>
            </div>
            <label className="field-row">
              <span className="field-label">Trim silences longer than</span>
              <span className="range-wrap">
                <input
                  type="range"
                  min={0.15}
                  max={1.5}
                  step={0.05}
                  value={project.edit.settings.maxPauseSec}
                  onChange={(e) =>
                    changeEdit({ ...project.edit, settings: { ...project.edit.settings, maxPauseSec: Number(e.target.value) } })
                  }
                />
                <output>{project.edit.settings.maxPauseSec.toFixed(2)} s</output>
              </span>
            </label>
          </div>
        </details>

        <details className="fold">
          <summary>Brief and re-cut</summary>
          <div className="fold-body">
            <label className="field-row stack">
              <span className="field-label">How should it be cut?</span>
              <textarea rows={4} value={briefDraft ?? project.brief} onChange={(e) => setBriefDraft(e.target.value)} placeholder="Describe the edit you want" />
            </label>
            <button className="btn btn-paper" onClick={replan} disabled={busy || !project.words.length}>
              Cut it again with this brief
            </button>
            <p className="fine">The AI replaces its own cuts and highlights. Words you struck yourself stay struck.</p>
          </div>
        </details>
      </aside>
    </div>
  );
}

// The new length counts to its value after a cut, so the change is felt, not just read.
function TickingLength({ sec }: { sec: number }) {
  const [shown, setShown] = useState(sec);
  const from = useRef(sec);
  useEffect(() => {
    const start = from.current;
    if (start === sec || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = sec;
      setShown(sec);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 320);
      const eased = 1 - Math.pow(1 - k, 3);
      const value = start + (sec - start) * eased;
      from.current = value;
      setShown(value);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [sec]);
  return <b>{formatDuration(shown)}</b>;
}

function summaryReasons(edit: Edit) {
  const counts = new Map<string, number>();
  for (const r of Object.values(edit.cuts)) counts.set(REASON_NOTE[r], (counts.get(REASON_NOTE[r]) ?? 0) + 1);
  if (!counts.size) return null;
  return `: ${[...counts].map(([r, n]) => `${n} ${r}`).join(", ")}`;
}

function Working({ project }: { project: Project }) {
  const active = STEPS.findIndex((s) => s.status === project.status);
  return (
    <div className="working" aria-live="polite">
      <ol>
        {STEPS.map((s, i) => (
          <li key={s.status} className={i < active ? "done" : i === active ? "now" : "todo"}>
            {s.label}
            {i === active && <span className="dots" aria-hidden="true" />}
            {i < active && <span className="visually-hidden"> (done)</span>}
          </li>
        ))}
      </ol>
      <div className="ruled" aria-hidden="true">
        <span className="caret" />
      </div>
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
    return (
      <div className="export">
        <button className="btn btn-paper" disabled>
          Exporting {Math.round(r.progress * 100)}%
        </button>
        <span className="export-bar" style={{ ["--p" as string]: r.progress }} aria-hidden="true" />
      </div>
    );
  }
  const fresh = r.status === "done" && !r.stale;
  return (
    <div className="export">
      <button className={fresh ? "btn btn-quiet" : "btn btn-paper"} onClick={start} disabled={project.status !== "ready"}>
        {r.status === "done" ? "Export again" : "Export MP4"}
      </button>
    </div>
  );
}

// The last exported file, on its own line under the header.
function ExportFile({ project }: { project: Project }) {
  const r = project.render;
  if (r.status === "error") return <p className="export-file alarm-on-desk">The export failed. Export again to retry.</p>;
  if (r.status !== "done") return null;
  const when = r.finishedAt
    ? new Date(r.finishedAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })
    : "";
  return (
    <p className="export-file">
      <a href={`/media/${project.id}/export.mp4?download`}>Download MP4</a>
      <span className={r.stale ? "export-stale" : undefined}>
        {r.stale ? `Out of date: exported ${when}, before your last changes` : `Exported ${when}`}
      </span>
    </p>
  );
}
