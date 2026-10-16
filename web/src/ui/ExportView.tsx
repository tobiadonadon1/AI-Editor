import { useEffect, useMemo, useRef, useState } from "react";
import { Player } from "@remotion/player";
import { canRenderMediaOnWeb } from "@remotion/web-renderer";
import { EditVideo } from "../../../src/remotion/EditVideo";
import { FORMATS, FPS, type EditVideoProps, type FormatId } from "../../../src/shared/project";
import { commit, useEditor } from "../lib/store";
import { exportMp4, type ExportQuality, type ExportResult } from "../lib/export";
import { Icon } from "./Icons";
import { HotNumber, Row, Section, Select, tc } from "./controls";

const DESTINATIONS: { format: FormatId; label: string; sub: string }[] = [
  { format: "9:16", label: "TikTok, Reels, Shorts", sub: "1080×1920 vertical" },
  { format: "4:5", label: "Instagram and Facebook feed", sub: "1080×1350 portrait" },
  { format: "1:1", label: "Square feed, LinkedIn", sub: "1080×1080" },
  { format: "16:9", label: "YouTube, web", sub: "1920×1080 landscape" },
];

const PRESETS: { value: ExportQuality; label: string; mbps: number }[] = [
  { value: "high", label: "Match Sequence, High Bitrate", mbps: 16 },
  { value: "medium", label: "Social, Fast upload", mbps: 8 },
  { value: "very-high", label: "Maximum quality", mbps: 30 },
];

export function ExportView({ onBack }: { onBack: () => void }) {
  const project = useEditor((s) => s.project)!;
  const timeline = useEditor((s) => s.timeline)!;
  const media = useEditor((s) => s.media);
  const sfx = useEditor((s) => s.sfx);
  const [name, setName] = useState(project.name);
  const [quality, setQuality] = useState<ExportQuality>("high");
  const [scale, setScale] = useState(1);
  const [range, setRange] = useState<"all" | "custom">("all");
  const total = timeline.durationInFrames / FPS;
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(total);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const f = FORMATS[project.format];
  const outW = Math.round((f.width * scale) / 2) * 2;
  const outH = Math.round((f.height * scale) / 2) * 2;
  const len = range === "all" ? total : Math.max(0.1, to - from);
  const mbps = PRESETS.find((p) => p.value === quality)!.mbps * scale * scale;
  const inputProps = useMemo<EditVideoProps>(() => ({ project, media, sfx }), [project, media, sfx]);

  useEffect(() => {
    void canRenderMediaOnWeb({ container: "mp4", videoCodec: "h264", audioCodec: "aac", width: outW, height: outH }).then((r) => setIssues(r.issues.filter((i) => i.severity === "error").map((i) => i.message)));
  }, [outW, outH]);

  useEffect(() => () => abort.current?.abort(), []);
  // Each export holds a whole MP4 in memory; let go of it when it is replaced or the view closes.
  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result]);

  const start = async () => {
    setError(null);
    setResult(null);
    setProgress(0);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const r = await exportMp4(project, media, sfx, { quality, scale, range: range === "custom" ? [from, to] : null }, setProgress, controller.signal);
      setResult(r);
      const a = document.createElement("a");
      a.href = r.url;
      a.download = `${name || "edit"}.mp4`;
      a.click();
    } catch (e) {
      // The renderer rejects with a plain Error when cancelled, so the signal is what says it was the user.
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  const scaleBox = Math.min(360 / f.width, 420 / f.height);

  return (
    <main className="export-view">
      <aside className="export-dest panel">
        <header className="panel-tabs">
          <span className="panel-tab active">Destinations</span>
        </header>
        <div className="panel-body">
          <div className="dest on">
            <Icon name="film" />
            <span>
              <b>Media File</b>
              <small>H.264 MP4, saved to Downloads</small>
            </span>
          </div>
          <h4 className="sub pad">Format for</h4>
          {DESTINATIONS.map((d) => (
            <button key={d.format} type="button" className={`dest${project.format === d.format ? " on" : ""}`} onClick={() => commit((p) => void (p.format = d.format))}>
              <span className={`dest-shape r${d.format.replace(":", "x")}`} />
              <span>
                <b>{d.label}</b>
                <small>{d.sub}</small>
              </span>
            </button>
          ))}
          <p className="fine pad">Changing the format reframes the whole edit, captions and titles included. Check the preview before exporting.</p>
        </div>
      </aside>

      <section className="export-settings panel">
        <header className="panel-tabs">
          <span className="panel-tab active">Media File</span>
        </header>
        <div className="panel-body">
          <Section title="Settings">
            <Row label="File name">
              <input className="text-in" value={name} onChange={(e) => setName(e.target.value)} aria-label="File name" onKeyDown={(e) => e.stopPropagation()} />
            </Row>
            <Row label="Location">
              <span className="static">Downloads (this browser)</span>
            </Row>
            <Row label="Preset">
              <Select<ExportQuality> label="Preset" value={quality} options={PRESETS.map((p) => ({ value: p.value, label: p.label }))} onChange={setQuality} />
            </Row>
            <Row label="Format">
              <span className="static">H.264 (.mp4)</span>
            </Row>
          </Section>
          <Section title="Video">
            <Row label="Frame size">
              <span className="static">
                {outW} × {outH}
              </span>
            </Row>
            <Row label="Scale">
              <Select label="Scale" value={String(scale)} options={[{ value: "1", label: "100% (full)" }, { value: "0.6667", label: "66%" }, { value: "0.5", label: "50% (draft)" }]} onChange={(v) => setScale(Number(v))} />
            </Row>
            <Row label="Frame rate">
              <span className="static">30 fps</span>
            </Row>
            <Row label="Bitrate">
              <span className="static">≈ {mbps.toFixed(0)} Mbps</span>
            </Row>
          </Section>
          <Section title="Audio">
            <Row label="Codec">
              <span className="static">AAC, 48 kHz, stereo</span>
            </Row>
          </Section>
          <Section title="Range">
            <Row label="Source range">
              <Select label="Range" value={range} options={[{ value: "all", label: "Entire sequence" }, { value: "custom", label: "Custom" }]} onChange={(v) => setRange(v as "all" | "custom")} />
            </Row>
            {range === "custom" && (
              <Row label="In / Out">
                <HotNumber value={from} min={0} max={to - 0.1} digits={2} step={1 / FPS} unit=" s" label="In" onChange={setFrom} />
                <HotNumber value={to} min={from + 0.1} max={total} digits={2} step={1 / FPS} unit=" s" label="Out" onChange={setTo} />
              </Row>
            )}
          </Section>
          <Section title="Summary">
            <p className="summary">
              {outW}×{outH}, 30 fps, H.264 {mbps.toFixed(0)} Mbps, AAC stereo. Duration {tc(len)}. Estimated size {Math.max(1, Math.round((mbps * len) / 8 + (0.2 * len) / 8))} MB.
            </p>
          </Section>
        </div>
      </section>

      <section className="export-preview panel">
        <header className="panel-tabs">
          <span className="panel-tab active">Preview</span>
        </header>
        <div className="panel-body">
          <div className="export-player" style={{ width: f.width * scaleBox, height: f.height * scaleBox }}>
            <Player component={EditVideo} inputProps={inputProps} durationInFrames={Math.max(1, timeline.durationInFrames)} compositionWidth={f.width} compositionHeight={f.height} fps={FPS} style={{ width: "100%", height: "100%" }} controls acknowledgeRemotionLicense />
          </div>
          <p className="fine center">Duration {tc(len)}</p>
          {issues.length > 0 && <p className="status-error pad">{issues.join(" ")} Try the latest Chrome or Edge.</p>}
          {error && <p className="status-error pad">Export failed: {error}</p>}
          <div className="export-actions">
            <button type="button" className="btn btn-quiet" onClick={onBack}>
              Back to Edit
            </button>
            {progress !== null ? (
              <>
                <span className="export-progress">
                  <i style={{ width: `${progress * 100}%` }} />
                  <b>Exporting {Math.round(progress * 100)}%</b>
                </span>
                <button type="button" className="btn btn-quiet" onClick={() => abort.current?.abort()}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-blue btn-big" onClick={() => void start()} disabled={issues.length > 0 || timeline.durationInFrames < 2}>
                Export
              </button>
            )}
          </div>
          {result && (
            <p className="export-done">
              <Icon name="check" size={14} /> Exported in {result.seconds.toFixed(0)} s, {(result.blob.size / 1e6).toFixed(1)} MB.{" "}
              <a href={result.url} download={`${name || "edit"}.mp4`}>
                Download again
              </a>{" "}
              ·{" "}
              <a href={result.url} target="_blank" rel="noreferrer">
                Open
              </a>
            </p>
          )}
          <p className="fine pad">Rendering runs in this tab with the same engine as the preview. Keep the tab open until it finishes.</p>
        </div>
      </section>
    </main>
  );
}
