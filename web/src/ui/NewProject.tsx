import { useState } from "react";
import { FORMATS, FORMAT_IDS, type FormatId } from "../../../src/shared/project";
import { createProject } from "../lib/store";
import { Mark } from "./Icons";

export const SETUP_STEPS = ["Project", "Video", "Options", "Instructions"];

export function SetupSteps({ current }: { current: number }) {
  return (
    <ol className="setup-steps" aria-label="Setup steps">
      {SETUP_STEPS.map((label, i) => (
        <li key={label} className={i < current ? "done" : i === current ? "on" : ""} aria-current={i === current ? "step" : undefined}>
          <span className="setup-step-n">{i < current ? "✓" : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

export function SetupHeader({ name, right }: { name: string; right?: React.ReactNode }) {
  return (
    <header className="header">
      <a className="header-home" href="#/" title="Home">
        <Mark size={20} />
      </a>
      <nav className="modes" aria-label="Mode">
        <span className="mode on">Set up</span>
        <span className="mode disabled">Edit</span>
        <span className="mode disabled">Export</span>
      </nav>
      <span className="project-name">{name}</span>
      {right}
    </header>
  );
}

// Step 1: the project itself. The video and the options come next, inside the project.
export function NewProject() {
  const [name, setName] = useState("");
  const [format, setFormat] = useState<FormatId>("9:16");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const p = await createProject({ name: name.trim() || "Untitled", format });
      location.hash = `#/p/${p.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="app import-app">
      <SetupHeader name="New project" />
      <main className="setup-page">
        <SetupSteps current={0} />
        <form
          className="setup-card panel"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <h1>Create a project</h1>
          <p className="setup-lead">Name it and pick the format it will be published in. You add the video and choose the style next.</p>
          <label className="field">
            <span>Project name</span>
            <input className="text-in" value={name} placeholder="Untitled" autoFocus onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="field">
            <span>Format</span>
            <div className="formats">
              {FORMAT_IDS.map((id) => (
                <button key={id} type="button" className={`format${format === id ? " on" : ""}`} aria-pressed={format === id} onClick={() => setFormat(id)}>
                  <span className={`dest-shape r${id.replace(":", "x")}`} />
                  <b>{id}</b>
                  <small>{FORMATS[id].use}</small>
                </button>
              ))}
            </div>
          </div>
          {error && <p className="status-error">{error}</p>}
          <div className="import-actions">
            <a className="btn btn-quiet" href="#/">
              Cancel
            </a>
            <button type="submit" className="btn btn-blue btn-big" disabled={busy}>
              {busy ? "Creating…" : "Create project"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
