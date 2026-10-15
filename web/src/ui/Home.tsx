import { useEffect, useState } from "react";
import { FORMATS, FPS, mainAsset, type Project } from "../../../src/shared/project";
import { buildTimeline } from "../../../src/shared/timeline";
import { store } from "../lib/db";
import { createSample } from "../lib/store";
import { api, type Health } from "../lib/api";
import { Icon, Mark } from "./Icons";
import { tc } from "./controls";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  const reload = () => void store.listProjects().then(setProjects).catch(() => setProjects([]));
  useEffect(() => {
    reload();
    void api.health().then(setHealth);
  }, []);

  const sample = async () => {
    setBusy(true);
    try {
      const p = await createSample();
      location.hash = `#/p/${p.id}`;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home">
      <aside className="home-side">
        <div className="home-brand">
          <Mark size={28} />
          <span>
            <b>AI Editor</b>
            <small>Pro</small>
          </span>
        </div>
        <a className="btn btn-blue btn-wide" href="#/new">
          <Icon name="plus" size={14} /> New project
        </a>
        <button type="button" className="btn btn-quiet btn-wide" onClick={() => void sample()} disabled={busy}>
          <Icon name="film" size={14} /> {busy ? "Opening…" : "Open sample project"}
        </button>
        <nav className="home-nav">
          <span className="home-nav-item on">
            <Icon name="home" size={14} /> Home
          </span>
        </nav>
        <div className="home-status">
          <span className={health?.anthropic ? "ok" : "off"}>● AI assistant {health ? (health.anthropic ? "on" : "off") : "…"}</span>
          <span className={health?.elevenlabs ? "ok" : "off"}>● Transcription {health ? (health.elevenlabs ? "on" : "off") : "…"}</span>
        </div>
      </aside>
      <main className="home-main">
        <header className="home-head">
          <h1>Recent</h1>
          <p>Projects are saved in this browser. Media never leaves your computer; only audio for transcription and a text description of the edit are sent to the AI.</p>
        </header>
        {health && (!health.anthropic || !health.elevenlabs) && (
          <p className="banner">
            {!health.anthropic && !health.elevenlabs ? "The AI assistant and transcription are" : !health.anthropic ? "The AI assistant is" : "Transcription is"} not configured on this deployment. Add {[!health.anthropic && "ANTHROPIC_API_KEY", !health.elevenlabs && "ELEVENLABS_API_KEY"].filter(Boolean).join(" and ")} to the server environment. Manual editing, colour, titles and export work without them.
          </p>
        )}
        {projects === null ? null : projects.length === 0 ? (
          <div className="home-empty">
            <p>No projects yet.</p>
            <p className="fine">Start a new project from your own footage, or open the sample to see a finished AI edit you can change.</p>
          </div>
        ) : (
          <table className="recent">
            <thead>
              <tr>
                <th>Name</th>
                <th>Format</th>
                <th>Duration</th>
                <th>Modified</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const a = mainAsset(p);
                const dur = a ? buildTimeline(p, a.durationSec, FPS).durationInFrames / FPS : 0;
                return (
                  <tr key={p.id} onClick={() => (location.hash = `#/p/${p.id}`)}>
                    <td>
                      <span className="recent-name">
                        <Icon name="film" size={14} />
                        {p.name}
                      </span>
                    </td>
                    <td>{FORMATS[p.format].label}</td>
                    <td className="mono">{a ? tc(dur) : "–"}</td>
                    <td>{when(p.updatedAt)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {confirm === p.id ? (
                        <button
                          type="button"
                          className="mini danger"
                          onClick={async () => {
                            await store.deleteProject(p);
                            setConfirm(null);
                            reload();
                          }}
                        >
                          Delete for good
                        </button>
                      ) : (
                        <button type="button" className="icon-btn sm" title="Delete project" onClick={() => setConfirm(p.id)}>
                          <Icon name="trash" size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
