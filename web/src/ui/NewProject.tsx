import { useState } from "react";
import { FORMATS, FORMAT_IDS, type FormatId } from "../../../src/shared/project";
import { kindOf } from "../lib/media";
import { createProject } from "../lib/store";
import { Icon, Mark } from "./Icons";

// Files chosen on the Import screen, handed to the editor once the project opens.
export const pending: { files: File[]; firstCut: boolean } = { files: [], firstCut: true };

const STYLES: { label: string; text: string }[] = [
  { label: "UGC ad", text: "Direct-response UGC ad: strong hook in the first second, fast pacing, bold captions with key words, punch-in zooms, product benefits as callouts, and a clear call to action at the end." },
  { label: "Educational", text: "Educational explainer: clear and calm pacing, clean captions, a title for each point, numbered steps as big numbers, subtle zooms." },
  { label: "Podcast clip", text: "Podcast clip: keep the best 30–60 seconds, cut filler, karaoke captions, a hook title naming the topic, light warm grade." },
  { label: "Product demo", text: "Product demo: tight cuts, callouts for features, clean bright look, lower third with the product name, CTA at the end." },
  { label: "Hormozi style", text: "Hormozi style: very fast, no pauses, 2-word captions in big bold caps with green and yellow key words, constant punch-ins, pops on keywords." },
  { label: "Cinematic vlog", text: "Cinematic vlog: relaxed pacing, teal and orange look with grain, minimal captions, elegant serif title at the start." },
];

export function NewProject() {
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [format, setFormat] = useState<FormatId>("9:16");
  const [brief, setBrief] = useState("");
  const [firstCut, setFirstCut] = useState(true);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = (list: FileList | File[]) => {
    const ok = [...list].filter((f) => kindOf(f));
    if (ok.length < [...list].length) setError("Some files were skipped: only video, image and audio files can be imported.");
    setFiles((cur) => [...cur, ...ok]);
    if (!name && ok[0]) setName(ok[0].name.replace(/\.[^.]+$/, ""));
  };

  const main = files.find((f) => kindOf(f) === "video");

  const create = async () => {
    if (!main) return setError("Add at least one video. The first video is the main clip that gets transcribed and cut.");
    setBusy(true);
    try {
      const p = await createProject({ name: name || main.name.replace(/\.[^.]+$/, ""), brief, format, files });
      pending.files = [main, ...files.filter((f) => f !== main)];
      pending.firstCut = firstCut;
      location.hash = `#/p/${p.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="app import-app">
      <header className="header">
        <a className="header-home" href="#/" title="Home">
          <Mark size={20} />
        </a>
        <nav className="modes" aria-label="Mode">
          <span className="mode on">Import</span>
          <span className="mode disabled">Edit</span>
          <span className="mode disabled">Export</span>
        </nav>
        <span className="project-name">New project</span>
      </header>
      <main className="import">
        <section
          className={`import-media panel${over ? " over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            add(e.dataTransfer.files);
          }}
        >
          <header className="panel-tabs">
            <span className="panel-tab active">Media</span>
          </header>
          <div className="panel-body">
            <label className="drop">
              <input type="file" multiple accept="video/*,image/*,audio/*" onChange={(e) => e.target.files && add(e.target.files)} />
              <Icon name="upload" size={28} />
              <b>Drop footage, images and music here</b>
              <span>or click to browse. The first video is the main clip; others become B-roll and music you or the AI can place.</span>
            </label>
            {files.length > 0 && (
              <ul className="import-list">
                {files.map((f, i) => (
                  <li key={`${f.name}${i}`}>
                    <Icon name={kindOf(f) === "video" ? "film" : kindOf(f) === "image" ? "image" : "music"} size={14} />
                    <span className="import-name">{f.name}</span>
                    {f === main && <span className="tag">Main</span>}
                    <span className="import-size">{Math.max(1, Math.round(f.size / 1e6))} MB</span>
                    <button type="button" className="icon-btn sm" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))}>
                      <Icon name="close" size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="import-settings panel">
          <header className="panel-tabs">
            <span className="panel-tab active">Import settings</span>
          </header>
          <div className="panel-body">
            <label className="field">
              <span>Project name</span>
              <input className="text-in" value={name} placeholder="Untitled" onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="field">
              <span>Sequence format</span>
              <div className="formats">
                {FORMAT_IDS.map((id) => (
                  <button key={id} type="button" className={`format${format === id ? " on" : ""}`} onClick={() => setFormat(id)}>
                    <span className={`dest-shape r${id.replace(":", "x")}`} />
                    <b>{id}</b>
                    <small>{FORMATS[id].use}</small>
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Describe the edit</span>
              <textarea
                className="text-in"
                rows={6}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="Be as specific as you like: who it is for, the platform, the length, pacing, the look and lighting, caption style, titles and where they go, animations, the call to action…"
              />
            </label>
            <div className="chips">
              {STYLES.map((s) => (
                <button key={s.label} type="button" className="chip" onClick={() => setBrief((b) => (b.trim() ? `${b.trim()}\n${s.text}` : s.text))}>
                  + {s.label}
                </button>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={firstCut} onChange={(e) => setFirstCut(e.target.checked)} />
              <span className="check-box" aria-hidden="true">
                {firstCut && <Icon name="check" size={10} />}
              </span>
              <span>Transcribe and let the AI make the first cut</span>
            </label>
            {error && <p className="status-error">{error}</p>}
            <div className="import-actions">
              <a className="btn btn-quiet" href="#/">
                Cancel
              </a>
              <button type="button" className="btn btn-blue btn-big" disabled={busy || !main} onClick={() => void create()}>
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
