import { useEffect, useRef, useState } from "react";
import type { Project } from "../../src/shared/project";
import { api, uploadSource } from "./api";
import { openProject } from "./App";
import { KeyBanner, StatusPill, formatDuration } from "./ui";

const EXAMPLE =
  "Tight, energetic edit for Reels. Cut mistakes and repeated takes. Keep it under 45 seconds.";

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
    if (!f.type.startsWith("video/")) return setError("Choose a video file (MP4 or MOV).");
    setError(null);
    setFile(f);
  };

  const start = async () => {
    if (!file) return;
    setError(null);
    setProgress(0);
    try {
      const name = file.name.replace(/\.[^.]+$/, "");
      const project = await api.create(brief, name);
      await uploadSource(project.id, file, setProgress);
      openProject(project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    }
  };

  return (
    <div className="home">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>▶</span> AI Editor
        </div>
      </header>
      <main className="home-main">
        <KeyBanner />
        <section className="create">
          <h1>Raw video in. Finished edit out.</h1>
          <div
            className={`drop ${dragging ? "drop-active" : ""} ${file ? "drop-filled" : ""}`}
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
            onClick={() => input.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
          >
            <input
              ref={input}
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => pick(e.target.files?.[0])}
            />
            {file ? (
              <>
                <strong>{file.name}</strong>
                <span>{(file.size / 1e6).toFixed(0)} MB · click to change</span>
              </>
            ) : (
              <>
                <strong>Drop your vertical talking-head video</strong>
                <span>or click to choose a file</span>
              </>
            )}
          </div>
          <label className="field">
            <span>How should it be edited?</span>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder={EXAMPLE}
              rows={4}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={!file || progress !== null} onClick={start}>
            {progress === null ? "Create edit" : `Uploading ${Math.round(progress * 100)}%`}
          </button>
        </section>

        {projects.length > 0 && (
          <section className="recent">
            <h2>Recent edits</h2>
            <ul>
              {projects.map((p) => (
                <li key={p.id}>
                  <button className="recent-item" onClick={() => openProject(p.id)}>
                    <span className="recent-name">{p.name}</span>
                    <span className="recent-meta">
                      {p.source?.durationSec ? formatDuration(p.source.durationSec) : "No video"} ·{" "}
                      {new Date(p.updatedAt).toLocaleDateString()}
                    </span>
                    <StatusPill project={p} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
