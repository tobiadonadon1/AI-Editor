import { useEffect, useState } from "react";
import { CAPTION_PRESET_IDS, DEFAULT_SETUP, STYLE_IDS, mainAsset, type CaptionPresetId, type MediaAsset, type SetupOptions } from "../../../src/shared/project";
import { CAPTION_PRESETS, STYLES, captionPreset } from "../../../src/shared/presets";
import { api, type Health } from "../lib/api";
import { kindOf } from "../lib/media";
import { get, importFiles, patchProject, resume, useEditor } from "../lib/store";
import { Icon } from "./Icons";
import { SetupHeader, SetupSteps } from "./NewProject";
import { shortTc } from "./controls";

// Imports keep running while the creator moves between steps; Start waits for them.
const inFlight = new Set<Promise<unknown>>();
function track<T>(p: Promise<T>) {
  inFlight.add(p);
  void p.finally(() => inFlight.delete(p));
  return p;
}

const setupOf = () => get().project?.setup ?? DEFAULT_SETUP;
const updateSetup = (patch: Partial<SetupOptions>) => patchProject({ setup: { ...setupOf(), ...patch } });

// Steps 2-4 of a new project: the video, the options, the instructions. Then the first cut runs.
export function Setup({ saveState }: { saveState: React.ReactNode }) {
  const project = useEditor((s) => s.project)!;
  const [step, setStep] = useState(project.mainAssetId ? 2 : 1);
  const [mainPending, setMainPending] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => void api.health().then(setHealth), []);

  return (
    <div className="app import-app">
      <SetupHeader name={project.name} right={saveState} />
      <main className="setup-page">
        <SetupSteps current={step} />
        {step === 1 && <VideoStep mainPending={mainPending} setMainPending={setMainPending} onNext={() => setStep(2)} />}
        {step === 2 && <OptionsStep health={health} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
        {step === 3 && <InstructionsStep health={health} onBack={() => setStep(2)} onMissingVideo={() => setStep(1)} />}
      </main>
    </div>
  );
}

function Tasks() {
  const tasks = useEditor((s) => s.tasks);
  if (!tasks.length) return null;
  return (
    <ul className="setup-tasks">
      {tasks.map((t) => (
        <li key={t.id}>
          <span className="spinner sm" aria-hidden />
          <span>{t.label}</span>
          {t.progress !== null && (
            <span className="task-bar">
              <i style={{ width: `${t.progress * 100}%` }} />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Drop({ accept, multiple, title, hint, onFiles, compact }: { accept: string; multiple?: boolean; title: string; hint: string; onFiles: (f: File[]) => void; compact?: boolean }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={`drop${compact ? " compact" : ""}${over ? " over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles([...e.dataTransfer.files]);
      }}
    >
      <input
        type="file"
        multiple={multiple}
        accept={accept}
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <Icon name="upload" size={compact ? 18 : 28} />
      <b>{title}</b>
      <span>{hint}</span>
    </label>
  );
}

function AssetRow({ a, children }: { a: MediaAsset; children?: React.ReactNode }) {
  const thumb = useEditor((s) => s.thumbs[a.id]?.frames[0]);
  return (
    <li className="setup-asset">
      <span className={`bin-icon ${a.kind}`}>{thumb ? <img src={thumb} alt="" /> : <Icon name={a.kind === "video" ? "film" : a.kind === "image" ? "image" : "music"} size={12} />}</span>
      <span className="import-name">
        {a.name}
        <small>
          {a.kind === "image" ? "still" : shortTc(a.durationSec)}
          {a.kind !== "audio" ? ` · ${a.width}×${a.height}` : ""}
        </small>
      </span>
      {children}
    </li>
  );
}

const removeAsset = (id: string) => patchProject({ assets: get().project!.assets.filter((x) => x.id !== id) });

function VideoStep({ mainPending, setMainPending, onNext }: { mainPending: boolean; setMainPending: (v: boolean) => void; onNext: () => void }) {
  const project = useEditor((s) => s.project)!;
  const [error, setError] = useState<string | null>(null);
  const main = mainAsset(project);
  const extras = project.assets.filter((a) => a.id !== project.mainAssetId && a.role !== "animation");

  const addMain = (files: File[]) => {
    const file = files.find((f) => kindOf(f) === "video");
    if (!file) return setError("That is not a video file. Use MP4, MOV or WebM.");
    setError(null);
    const old = project.mainAssetId;
    setMainPending(true);
    void track(importFiles([file], { asMain: true }))
      .then((added) => {
        if (added.length && old) removeAsset(old);
      })
      .finally(() => setMainPending(false));
  };
  const addExtras = (files: File[]) => {
    const ok = files.filter((f) => kindOf(f));
    setError(ok.length < files.length ? "Some files were skipped: only video, image and audio files can be added." : null);
    if (ok.length) void track(importFiles(ok));
  };

  return (
    <section className="setup-card panel wide">
      <h1>Add your video</h1>
      <p className="setup-lead">The main video is transcribed and cut by the AI. Extra clips, images and music are optional: the AI can use them as B-roll and as a music bed.</p>
      {main ? (
        <ul className="import-list">
          <AssetRow a={main}>
            <span className="tag">Main video</span>
            <label className="mini file-btn">
              Replace
              <input type="file" accept="video/*" onChange={(e) => (addMain([...(e.target.files ?? [])]), (e.target.value = ""))} />
            </label>
          </AssetRow>
        </ul>
      ) : mainPending ? null : (
        <Drop accept="video/*" title="Drop your main video here" hint="or click to choose it. MP4, MOV or WebM, up to a few GB." onFiles={addMain} />
      )}
      <Tasks />
      <div className="field">
        <span>Extra footage, images and music (optional)</span>
        <Drop compact multiple accept="video/*,image/*,audio/*" title="Add B-roll or music" hint="Drop files or click to browse" onFiles={addExtras} />
        {extras.length > 0 && (
          <ul className="import-list">
            {extras.map((a) => (
              <AssetRow key={a.id} a={a}>
                <button type="button" className="icon-btn sm" aria-label={`Remove ${a.name}`} onClick={() => removeAsset(a.id)}>
                  <Icon name="close" size={11} />
                </button>
              </AssetRow>
            ))}
          </ul>
        )}
      </div>
      {error && <p className="status-error">{error}</p>}
      <div className="import-actions">
        <a className="btn btn-quiet" href="#/">
          Finish later
        </a>
        <button type="button" className="btn btn-blue btn-big" disabled={!main && !mainPending} onClick={onNext}>
          Next: options
        </button>
      </div>
    </section>
  );
}

function OptionsStep({ health, onBack, onNext }: { health: Health | null; onBack: () => void; onNext: () => void }) {
  const project = useEditor((s) => s.project)!;
  const s = project.setup ?? DEFAULT_SETUP;
  const own = project.assets.filter((a) => a.role === "animation");
  const [error, setError] = useState<string | null>(null);
  const setNote = (id: string, note: string) => patchProject({ assets: get().project!.assets.map((a) => (a.id === id ? { ...a, note: note.slice(0, 300) || undefined } : a)) });
  const addAnimations = (files: File[]) => {
    const ok = files.filter((f) => kindOf(f) === "video" || kindOf(f) === "image");
    setError(ok.length < files.length ? "Animations are video (MP4, MOV, WebM with transparency) or image files; the others were skipped." : null);
    if (ok.length) void track(importFiles(ok, { role: "animation" }));
  };

  return (
    <section className="setup-card panel wide">
      <h1>Choose the options</h1>
      <p className="setup-lead">The AI follows these for the first cut. You can change everything afterwards, by hand or by asking.</p>

      <div className="field">
        <span>Style</span>
        <div className="style-grid">
          {STYLE_IDS.map((id) => (
            <button key={id} type="button" className={`style-card${s.style === id ? " on" : ""}`} aria-pressed={s.style === id} onClick={() => updateSetup({ style: id })}>
              <b>{STYLES[id].label}</b>
              <small>{STYLES[id].hint}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Captions</span>
        <div className="seg-tabs inline" role="group" aria-label="Captions">
          <button type="button" className={s.captions.enabled ? "on" : ""} aria-pressed={s.captions.enabled} onClick={() => updateSetup({ captions: { ...s.captions, enabled: true } })}>
            On
          </button>
          <button type="button" className={!s.captions.enabled ? "on" : ""} aria-pressed={!s.captions.enabled} onClick={() => updateSetup({ captions: { ...s.captions, enabled: false } })}>
            Off
          </button>
        </div>
        {s.captions.enabled && (
          <div className="caption-picks">
            <button type="button" className={`caption-pick auto${s.captions.preset === null ? " on" : ""}`} aria-pressed={s.captions.preset === null} onClick={() => updateSetup({ captions: { enabled: true, preset: null } })}>
              <span className="caption-sample">Auto</span>
              <small>AI picks</small>
            </button>
            {CAPTION_PRESET_IDS.map((id) => (
              <CaptionPick key={id} id={id} on={s.captions.preset === id} onClick={() => updateSetup({ captions: { enabled: true, preset: id } })} />
            ))}
          </div>
        )}
      </div>

      <div className="field">
        <span>Animations</span>
        <label className="check">
          <input type="checkbox" checked={s.ownAnimations} onChange={(e) => updateSetup({ ownAnimations: e.target.checked })} />
          <span className="check-box" aria-hidden="true">
            {s.ownAnimations && <Icon name="check" size={10} />}
          </span>
          <span>I have animations I want in the video</span>
        </label>
        {s.ownAnimations && (
          <div className="setup-sub">
            <Drop compact multiple accept="video/*,image/*" title="Add your animations" hint="MP4, MOV, WebM (transparent backgrounds work) or PNG" onFiles={addAnimations} />
            {own.length > 0 && (
              <ul className="import-list">
                {own.map((a) => (
                  <AssetRow key={a.id} a={a}>
                    <input className="text-in note-in" defaultValue={a.note ?? ""} placeholder="Where should it go? e.g. when I mention the app" aria-label={`Where ${a.name} goes`} onBlur={(e) => setNote(a.id, e.target.value.trim())} />
                    <button type="button" className="icon-btn sm" aria-label={`Remove ${a.name}`} onClick={() => removeAsset(a.id)}>
                      <Icon name="close" size={11} />
                    </button>
                  </AssetRow>
                ))}
              </ul>
            )}
            <Tasks />
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={s.generateAnimations} onChange={(e) => updateSetup({ generateAnimations: e.target.checked })} />
          <span className="check-box" aria-hidden="true">
            {s.generateAnimations && <Icon name="check" size={10} />}
          </span>
          <span>Generate animations with the animation API</span>
        </label>
        {s.generateAnimations && (
          <p className="fine setup-sub">
            The AI marks 2-4 moments where an animation helps and describes each one. Those placeholders are sent to the animation service and filled in when it answers.{" "}
            {health?.animations === "api" ? "Connected to the animation service set on this server." : "No animation service is connected yet, so a built-in test service answers with a sample animation."}
          </p>
        )}
      </div>

      {error && <p className="status-error">{error}</p>}
      <div className="import-actions">
        <button type="button" className="btn btn-quiet" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn btn-blue btn-big" onClick={onNext}>
          Next: instructions
        </button>
      </div>
    </section>
  );
}

function CaptionPick({ id, on, onClick }: { id: CaptionPresetId; on: boolean; onClick: () => void }) {
  const c = captionPreset(id);
  return (
    <button type="button" className={`caption-pick${on ? " on" : ""}`} aria-pressed={on} onClick={onClick}>
      <span
        className="caption-sample"
        style={{
          fontFamily: `"${c.font}", var(--ui)`,
          color: c.color,
          textTransform: c.uppercase ? "uppercase" : "none",
          background: c.background ?? undefined,
          WebkitTextStroke: c.strokeWidth ? `${Math.min(3, c.strokeWidth / 5)}px ${c.strokeColor}` : undefined,
          paintOrder: "stroke fill",
        }}
      >
        Say <span style={{ color: c.activeColor, background: c.activeBox ?? undefined }}>this</span>
      </span>
      <small>{CAPTION_PRESETS[id].label}</small>
    </button>
  );
}

function InstructionsStep({ health, onBack, onMissingVideo }: { health: Health | null; onBack: () => void; onMissingVideo: () => void }) {
  const project = useEditor((s) => s.project)!;
  const s = project.setup ?? DEFAULT_SETUP;
  const [firstCut, setFirstCut] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const main = mainAsset(project);
  const own = project.assets.filter((a) => a.role === "animation").length;
  const ai = health ? health.anthropic && health.elevenlabs : true;

  const start = async () => {
    setBusy(true);
    setError(null);
    await Promise.allSettled([...inFlight]);
    const p = get().project!;
    if (!p.mainAssetId) {
      setBusy(false);
      setError("Add the main video first.");
      return onMissingVideo();
    }
    const o = p.setup ?? DEFAULT_SETUP;
    const captions = !o.captions.enabled ? { ...p.captions, enabled: false } : o.captions.preset ? captionPreset(o.captions.preset, { ...p.captions, enabled: true }) : { ...p.captions, enabled: true };
    const go = firstCut && ai;
    patchProject({ brief: o.instructions.trim(), captions, status: go ? "importing" : "ready", statusDetail: go ? "Starting the first cut" : undefined });
    if (go) void resume();
  };

  return (
    <section className="setup-card panel wide">
      <h1>Anything specific?</h1>
      <p className="setup-lead">Tell the AI what you want: who it is for, the length, what to cut or keep, the look, where titles go, the call to action. Leave it empty for a clean, tight edit.</p>
      <label className="field">
        <span>Instructions for the edit</span>
        <textarea
          className="text-in"
          rows={6}
          defaultValue={s.instructions}
          placeholder="e.g. Keep it under 45 seconds, cut the part about pricing, warm look, end with 'Link in bio'."
          onChange={(e) => updateSetup({ instructions: e.target.value.slice(0, 3000) })}
        />
      </label>
      <dl className="setup-summary">
        <div>
          <dt>Video</dt>
          <dd>{main ? `${main.name} · ${shortTc(main.durationSec)}` : "Still importing…"}</dd>
        </div>
        <div>
          <dt>Style</dt>
          <dd>{STYLES[s.style].label}</dd>
        </div>
        <div>
          <dt>Captions</dt>
          <dd>{s.captions.enabled ? (s.captions.preset ? CAPTION_PRESETS[s.captions.preset].label : "On, AI picks the look") : "Off"}</dd>
        </div>
        <div>
          <dt>Animations</dt>
          <dd>{[s.ownAnimations && own ? `${own} of yours` : null, s.generateAnimations ? "generated with the animation API" : null].filter(Boolean).join(", ") || "None"}</dd>
        </div>
      </dl>
      <label className="check">
        <input type="checkbox" checked={firstCut && ai} disabled={!ai} onChange={(e) => setFirstCut(e.target.checked)} />
        <span className="check-box" aria-hidden="true">
          {firstCut && ai && <Icon name="check" size={10} />}
        </span>
        <span>{ai ? "Transcribe and let the AI make the first cut" : "The AI first cut is not available on this server, so the video opens for manual editing"}</span>
      </label>
      {error && <p className="status-error">{error}</p>}
      <div className="import-actions">
        <button type="button" className="btn btn-quiet" onClick={onBack} disabled={busy}>
          Back
        </button>
        <button type="button" className="btn btn-blue btn-big" disabled={busy} onClick={() => void start()}>
          {busy ? (inFlight.size ? "Finishing the import…" : "Starting…") : firstCut && ai ? "Start the edit" : "Open the editor"}
        </button>
      </div>
    </section>
  );
}
