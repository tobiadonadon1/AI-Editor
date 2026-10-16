import { useEffect, useState } from "react";
import { UserButton } from "@clerk/react";
import { FORMATS, FPS, mainAsset, type FormatId, type Project } from "../../../src/shared/project";
import { buildTimeline } from "../../../src/shared/timeline";
import { store } from "../lib/db";
import { api, auth, type Health } from "../lib/api";
import { cloud, deleteProject as deleteFromCloud, listProjects as listCloud, type Summary } from "../lib/cloud";
import { Icon, Mark } from "./Icons";
import { tc } from "./controls";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

interface Row extends Summary {
  local?: Project;
  inCloud: boolean;
}

const summaryOf = (p: Project): Summary => {
  const a = mainAsset(p);
  return { id: p.id, name: p.name, format: p.format, updatedAt: p.updatedAt, durationSec: a ? buildTimeline(p, a.durationSec, FPS).durationInFrames / FPS : 0 };
};

// The account's projects plus anything in this browser that has not synced yet, newest first.
async function loadRows(): Promise<{ rows: Row[]; cloudError?: string }> {
  const local = await store.listProjects().catch(() => [] as Project[]);
  let remote: Summary[] = [];
  let cloudError: string | undefined;
  if (cloud.on) remote = await listCloud().catch((e) => ((cloudError = e instanceof Error ? e.message : String(e)), []));
  const rows = new Map<string, Row>();
  for (const r of remote) rows.set(r.id, { ...r, inCloud: true });
  for (const p of local) {
    const r = rows.get(p.id);
    if (!r) rows.set(p.id, { ...summaryOf(p), local: p, inCloud: false });
    else rows.set(p.id, { ...(p.updatedAt > r.updatedAt ? summaryOf(p) : r), local: p, inCloud: true });
  }
  return { rows: [...rows.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), cloudError };
}

export function Home() {
  const [projects, setProjects] = useState<Row[] | null>(null);
  const [cloudError, setCloudError] = useState<string | undefined>();
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const reload = () =>
    void loadRows().then(({ rows, cloudError }) => {
      setProjects(rows);
      setCloudError(cloudError);
    });
  useEffect(() => {
    reload();
    void api.health().then(setHealth);
  }, []);

  const sample = async () => {
    setBusy(true);
    try {
      const { createSample } = await import("../lib/store");
      const p = await createSample();
      location.hash = `#/p/${p.id}`;
    } catch (e) {
      setCloudError(undefined);
      setSampleError(e instanceof Error ? e.message : String(e));
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
        {auth.enabled && (
          <div className="home-user">
            <UserButton showName />
          </div>
        )}
        <div className="home-status">
          <span className={health?.anthropic ? "ok" : "off"}>● AI assistant {health ? (health.anthropic ? "on" : "off") : "…"}</span>
          <span className={health?.elevenlabs ? "ok" : "off"}>● Transcription {health ? (health.elevenlabs ? "on" : "off") : "…"}</span>
        </div>
      </aside>
      <main className="home-main">
        <header className="home-head">
          <h1>Recent</h1>
          <p>
            {cloud.on
              ? "Projects and their media are saved to your account, so they open on any computer you sign in on. The AI receives a text description of the edit, a few stills and, for transcription, the audio."
              : "Projects are saved in this browser. Only audio for transcription and a text description of the edit are sent to the AI."}
          </p>
        </header>
        {health && (!health.anthropic || !health.elevenlabs) && (
          <p className="banner">
            {!health.anthropic && !health.elevenlabs ? "The AI assistant and transcription are" : !health.anthropic ? "The AI assistant is" : "Transcription is"} not configured on this deployment. Add {[!health.anthropic && "ANTHROPIC_API_KEY", !health.elevenlabs && "ELEVENLABS_API_KEY"].filter(Boolean).join(" and ")} to the server environment. Manual editing, colour, titles and export work without them.
          </p>
        )}
        {cloudError && <p className="banner">Could not load the projects saved in your account: {cloudError}</p>}
        {sampleError && <p className="banner">Could not open the sample: {sampleError}</p>}
        {projects === null ? (
          <div className="home-empty">
            <span className="spinner" aria-hidden />
            <p className="fine">Loading your projects…</p>
          </div>
        ) : projects.length === 0 ? (
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
                {cloud.on && <th>Saved</th>}
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const dur = p.durationSec;
                return (
                  <tr key={p.id} onClick={() => (location.hash = `#/p/${p.id}`)}>
                    <td>
                      <span className="recent-name">
                        <Icon name="film" size={14} />
                        {p.name}
                      </span>
                    </td>
                    <td>{FORMATS[p.format as FormatId]?.label ?? p.format}</td>
                    <td className="mono">{dur ? tc(dur) : "–"}</td>
                    <td>{when(p.updatedAt)}</td>
                    {cloud.on && <td className="fine">{p.inCloud ? "Account" : "This browser"}</td>}
                    <td onClick={(e) => e.stopPropagation()}>
                      {confirm === p.id ? (
                        <button
                          type="button"
                          className="mini danger"
                          onClick={async () => {
                            if (p.inCloud) await deleteFromCloud(p.id).catch(() => {});
                            if (p.local) await store.deleteProject(p.local);
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
