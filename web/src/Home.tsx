import { Fragment, useEffect, useRef, useState } from "react";
import type { Project } from "../../src/shared/project";
import { FPS } from "../../src/shared/project";
import { buildTimeline } from "../../src/shared/timeline";
import { api, uploadSource } from "./api";
import { openProject } from "./App";
import { KeyStrip, StatusWord, Wordmark, formatDate, formatDuration } from "./ui";

const PLACEHOLDER =
  "Tight and energetic for Reels. Cut mistakes and repeated takes. Under 45 seconds.";

function lengths(p: Project) {
  if (!p.source?.durationSec) return "No video yet";
  if (p.status !== "ready") return formatDuration(p.source.durationSec);
  const t = buildTimeline(p.words, p.edit, p.source.durationSec, FPS);
  return `${formatDuration(p.source.durationSec)} → ${formatDuration(t.durationInFrames / FPS)}`;
}

// The opening words of the script, with the real strikes and highlights.
function Snippet({ project }: { project: Project }) {
  const spoken = project.words.filter((w) => w.kind === "word").slice(0, 14);
  if (!spoken.length) return <span className="page-snippet page-snippet-empty">No script yet.</span>;
  const key = new Set(project.edit.emphasis);
  return (
    <span className="page-snippet">
      {spoken.map((w) => (
        <Fragment key={w.id}>
          <span className={project.edit.cuts[w.id] ? "s-cut" : key.has(w.id) ? "s-hl" : undefined}>{w.text}</span>{" "}
        </Fragment>
      ))}
      …
    </span>
  );
}

export function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [brief, setBrief] = useState("");
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.list().then(setProjects).catch(() => setProjects([]));
  }, []);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("video/")) return setError("That is not a video. Choose an MP4 or MOV.");
    setError(null);
    setFile(f);
  };

  const start = async () => {
    if (!file) return setError("Add the raw video first.");
    setError(null);
    setProgress(0);
    try {
      const project = await api.create(brief, file.name.replace(/\.[^.]+$/, ""));
      await uploadSource(project.id, file, setProgress);
      openProject(project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    }
  };

  return (
    <div className="home">
      <header className="deskbar">
        <Wordmark />
      </header>
      <KeyStrip />
      <main className="home-main">
        <form
          className="sheet new-edit"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <h1 className="slug">New edit</h1>
          <label
            className={`drop${dragging ? " drop-over" : ""}${file ? " drop-has" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files[0]);
            }}
          >
            <input ref={input} type="file" accept="video/*" aria-label="Choose the raw video" onChange={(e) => pick(e.target.files?.[0])} />
            <span className="drop-frame" aria-hidden="true">
              <svg viewBox="0 0 40 72">
                <path d="M3 3H33V31L3 37Z" />
                <path d="M7 41L37 35V69H7Z" />
              </svg>
            </span>
            {file ? (
              <span className="drop-text">
                <strong>{file.name}</strong>
                <span>{(file.size / 1e6).toFixed(0)} MB · choose another</span>
              </span>
            ) : (
              <span className="drop-text">
                <strong className="drop-say-drag">Drop the raw video here</strong>
                <strong className="drop-say-tap">Choose the raw video</strong>
                <span>MP4 or MOV, filmed vertically.</span>
              </span>
            )}
          </label>
          <label className="brief">
            <span className="field-label">How should it be cut?</span>
            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={PLACEHOLDER} rows={3} />
          </label>
          {error && <p className="alarm">{error}</p>}
          <div className="form-end">
            <button className="btn btn-ink" type="submit" disabled={progress !== null}>
              {progress === null ? "Make the first cut" : `Uploading ${Math.round(progress * 100)}%`}
            </button>
          </div>
        </form>

        {projects.length > 0 && (
          <section className="earlier" aria-labelledby="earlier-h">
            <h2 id="earlier-h">Earlier edits</h2>
            <ol className="pages">
              {projects.map((p) => (
                <li key={p.id}>
                  <button type="button" className="page-card" onClick={() => openProject(p.id)}>
                    <span className="page-thumb">
                      {p.source?.durationSec ? <img src={`/media/${p.id}/poster.jpg`} alt="" loading="lazy" /> : null}
                    </span>
                    <span className="page-body">
                      <span className="page-name">{p.name}</span>
                      <Snippet project={p} />
                      <span className="page-meta">
                        <span>{lengths(p)}</span>
                        <span>{formatDate(p.updatedAt)}</span>
                        <StatusWord project={p} />
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}
      </main>
    </div>
  );
}
