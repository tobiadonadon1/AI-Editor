import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CAPTION_ANIMS, CAPTION_PRESET_IDS, FONT_IDS, FPS, type CaptionStyle, type CutReason, type FontId, type Word } from "../../../src/shared/project";
import { CAPTION_PRESETS, captionPreset } from "../../../src/shared/presets";
import { wordOutputTime } from "../../../src/shared/timeline";
import { commit, get, resume, seek, set, useEditor } from "../lib/store";
import { Icon } from "./Icons";
import { Check, HotNumber, Row, Section, Select, SliderRow, Swatch, tc } from "./controls";

export const REASON: Record<CutReason, string> = {
  retake: "retake",
  false_start: "false start",
  filler: "filler",
  stumble: "stumble",
  off_brief: "off brief",
  pause: "pause",
  manual: "you",
};

export function TextPanel() {
  const [tab, setTab] = useState<"transcript" | "captions">("transcript");
  return (
    <div className="textpanel">
      <div className="seg-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "transcript"} className={tab === "transcript" ? "on" : ""} onClick={() => setTab("transcript")}>
          Transcript
        </button>
        <button type="button" role="tab" aria-selected={tab === "captions"} className={tab === "captions" ? "on" : ""} onClick={() => setTab("captions")}>
          Captions
        </button>
      </div>
      {tab === "transcript" ? <Transcript /> : <CaptionControls />}
    </div>
  );
}

export const selRange = (s: { anchor: number; focus: number } | null): [number, number] | null => (s ? [Math.min(s.anchor, s.focus), Math.max(s.anchor, s.focus)] : null);

export function cutSelection() {
  const { project, wordSel } = get();
  const r = selRange(wordSel);
  if (!project || !r) return;
  commit((d) => {
    for (let i = r[0]; i <= r[1]; i++) d.cuts[d.words[i].id] ??= "manual";
    d.emphasis = d.emphasis.filter((id) => !d.cuts[id]);
  });
  set({ wordSel: null });
}
export function restoreSelection() {
  const { wordSel } = get();
  const r = selRange(wordSel);
  if (!r) return;
  commit((d) => {
    for (let i = r[0]; i <= r[1]; i++) delete d.cuts[d.words[i].id];
  });
  set({ wordSel: null });
}
export function toggleKey() {
  const { project, wordSel } = get();
  const r = selRange(wordSel);
  if (!project || !r) return;
  const ids = project.words.slice(r[0], r[1] + 1).filter((w) => !project.cuts[w.id]).map((w) => w.id);
  const all = ids.every((id) => project.emphasis.includes(id));
  commit((d) => void (d.emphasis = all ? d.emphasis.filter((id) => !ids.includes(id)) : [...new Set([...d.emphasis, ...ids])]));
}

// Paragraphs break at long silences and every few sentences, like Premiere's transcript.
function paragraphs(words: Word[]) {
  const out: { start: number; end: number }[] = [];
  let start = 0;
  let sentences = 0;
  words.forEach((w, i) => {
    const next = words[i + 1];
    if (/[.!?]$/.test(w.text)) sentences++;
    if (!next || next.start - w.end > 1.4 || (sentences >= 3 && /[.!?]$/.test(w.text))) {
      out.push({ start, end: i });
      start = i + 1;
      sentences = 0;
    }
  });
  return out;
}

function Transcript() {
  const project = useEditor((s) => s.project)!;
  const timeline = useEditor((s) => s.timeline)!;
  const frame = useEditor((s) => s.frame);
  const sel = useEditor((s) => s.wordSel);
  const [query, setQuery] = useState("");
  const dragging = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const range = selRange(sel);
  const paras = useMemo(() => paragraphs(project.words), [project.words]);
  const emphasis = useMemo(() => new Set(project.emphasis), [project.emphasis]);
  const kept = useMemo(() => new Set(timeline.words.map((w) => w.id)), [timeline]);
  const nowMs = (frame / FPS) * 1000;
  const current = useMemo(() => {
    let id: string | null = null;
    for (const w of timeline.words) {
      if (w.startMs <= nowMs + 1) id = w.id;
      else break;
    }
    return id;
  }, [timeline, nowMs]);
  const q = query.trim().toLowerCase();

  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);
  useEffect(() => {
    if (!current || !get().playing) return;
    const el = box.current?.querySelector<HTMLElement>(`[data-w="${current}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [current]);

  if (!project.words.length) {
    const busy = project.status === "transcribing" || project.status === "planning";
    return (
      <div className="empty-note">
        {busy ? "Transcribing…" : project.mainAssetId ? "No transcript yet." : "Import a video to get a transcript."}
        {!busy && project.mainAssetId && (
          <button type="button" className="mini" onClick={() => void resume()}>
            Transcribe and make the first cut
          </button>
        )}
      </div>
    );
  }

  const count = q ? project.words.filter((w) => w.text.toLowerCase().includes(q)).length : 0;
  const n = range ? range[1] - range[0] + 1 : 0;

  return (
    <div className="transcript">
      <div className="transcript-tools">
        <span className="search">
          <Icon name="search" size={12} />
          <input value={query} placeholder="Search transcript" aria-label="Search transcript" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          {q && <span className="search-count">{count}</span>}
        </span>
        <button type="button" className="mini" disabled={!n} onClick={cutSelection} title="Cut the selected words (Delete)">
          Cut
        </button>
        <button type="button" className="mini" disabled={!n} onClick={restoreSelection} title="Restore (R)">
          Restore
        </button>
        <button type="button" className="mini" disabled={!n} onClick={toggleKey} title="Key word in captions (K)">
          Key word
        </button>
      </div>
      <p className="fine pad">{n ? `${n} word${n > 1 ? "s" : ""} selected` : "Click a word to jump to it. Drag or shift-click to select, then Delete to cut."}</p>
      <div className="transcript-body" ref={box} onPointerLeave={() => (dragging.current = false)}>
        {paras.map((p) => (
          <div key={p.start} className="para">
            <span className="para-tc">{tc(wordOutputTime(timeline, project.words.slice(p.start, p.end + 1).find((w) => kept.has(w.id))?.id ?? "") ?? project.words[p.start].start)}</span>
            <p>
              {project.words.slice(p.start, p.end + 1).map((w, k) => {
                const i = p.start + k;
                const prev = project.words[i - 1];
                const gap = prev && k > 0 ? w.start - prev.end : 0;
                const reason = project.cuts[w.id];
                const removed = !reason && !kept.has(w.id) && w.kind === "word";
                const cls = [
                  "tw",
                  reason && "cut",
                  removed && "cut range",
                  emphasis.has(w.id) && !reason && "key",
                  range && i >= range[0] && i <= range[1] && "sel",
                  w.id === current && "now",
                  q && w.text.toLowerCase().includes(q) && "found",
                  w.kind === "audio_event" && "event",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <Fragment key={w.id}>
                    {gap > 0.6 && <span className="pause-mark" title={`${gap.toFixed(1)} s pause`}>…</span>}
                    <span
                      data-w={w.id}
                      className={cls}
                      title={reason ? `Cut: ${REASON[reason]}` : undefined}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        dragging.current = true;
                        if (e.shiftKey && sel) set({ wordSel: { anchor: sel.anchor, focus: i } });
                        else {
                          set({ wordSel: { anchor: i, focus: i } });
                          const target = project.words.slice(i).find((x) => kept.has(x.id));
                          const at = target && wordOutputTime(timeline, target.id);
                          if (at !== null && at !== undefined) seek(at);
                        }
                      }}
                      onPointerEnter={() => dragging.current && sel && set({ wordSel: { anchor: sel.anchor, focus: i } })}
                    >
                      {w.kind === "audio_event" ? `(${w.text})` : w.text}
                    </span>{" "}
                  </Fragment>
                );
              })}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CaptionControls() {
  const c = useEditor((s) => s.project!.captions);
  const setC = (patch: Partial<CaptionStyle>, key: string) => commit((d) => void Object.assign(d.captions, patch), `cap:${key}`);
  return (
    <div className="ec">
      <div className="ec-head">
        <Check label="Show captions" checked={c.enabled} onChange={(v) => setC({ enabled: v }, "on")} />
      </div>
      <Section title="Style">
        <div className="cap-presets">
          {CAPTION_PRESET_IDS.map((id) => {
            const p = CAPTION_PRESETS[id].style;
            return (
              <button key={id} type="button" className={`cap-preset${c.preset === id ? " on" : ""}`} onClick={() => commit((d) => void (d.captions = captionPreset(id, d.captions)))}>
                <span className="cap-sample" style={{ fontFamily: `"${p.font}", sans-serif`, textTransform: p.uppercase ? "uppercase" : "none", background: p.background ?? undefined, color: p.color }}>
                  <span style={{ WebkitTextStroke: p.strokeWidth ? `2px ${p.strokeColor}` : undefined, paintOrder: "stroke fill" }}>so </span>
                  <span style={{ color: p.activeColor, background: p.activeBox ?? undefined, borderRadius: 3, padding: p.activeBox ? "0 2px" : 0, WebkitTextStroke: p.strokeWidth ? `2px ${p.strokeColor}` : undefined, paintOrder: "stroke fill" }}>this</span>
                  <span style={{ color: p.emphasisColor, WebkitTextStroke: p.strokeWidth ? `2px ${p.strokeColor}` : undefined, paintOrder: "stroke fill" }}> works</span>
                </span>
                <span className="template-label">{CAPTION_PRESETS[id].label}</span>
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Text">
        <Row label="Font">
          <Select<FontId> label="Caption font" value={c.font} options={FONT_IDS.map((f) => ({ value: f, label: f }))} onChange={(font) => setC({ font }, "font")} />
        </Row>
        <SliderRow label="Size" value={c.size} min={30} max={160} digits={0} neutral={84} onChange={(v) => setC({ size: v }, "size")} />
        <SliderRow label="Vertical position" value={c.y} min={5} max={95} digits={0} neutral={72} unit="%" onChange={(v) => setC({ y: v }, "y")} />
        <SliderRow label="Words on screen" value={c.maxWordsPerPage} min={1} max={8} digits={0} neutral={3} onChange={(v) => setC({ maxWordsPerPage: v }, "words")} />
        <Row label="Animation">
          <Select label="Caption animation" value={c.animation} options={CAPTION_ANIMS.map((a) => ({ value: a, label: a[0].toUpperCase() + a.slice(1) }))} onChange={(animation) => setC({ animation }, "anim")} />
        </Row>
        <div className="checks">
          <Check label="All caps" checked={c.uppercase} onChange={(v) => setC({ uppercase: v }, "uc")} />
          <Check label="Shadow" checked={c.shadow} onChange={(v) => setC({ shadow: v }, "sh")} />
        </div>
      </Section>
      <Section title="Colour">
        <Row label="Text">
          <Swatch label="Text colour" value={c.color} onChange={(v) => setC({ color: v ?? "#ffffff" }, "color")} />
        </Row>
        <Row label="Spoken word">
          <Swatch label="Spoken word colour" value={c.activeColor} onChange={(v) => setC({ activeColor: v ?? "#ffe14d" }, "active")} />
        </Row>
        <Row label="Key words">
          <Swatch label="Key word colour" value={c.emphasisColor} onChange={(v) => setC({ emphasisColor: v ?? "#3fe07a" }, "emph")} />
        </Row>
        <Row label="Stroke">
          <Swatch label="Stroke colour" value={c.strokeColor} onChange={(v) => setC({ strokeColor: v ?? "#000000" }, "sc")} />
          <HotNumber value={c.strokeWidth} digits={0} min={0} max={30} label="Stroke width" onChange={(v) => setC({ strokeWidth: v }, "sw")} />
        </Row>
        <Row label="Line box">
          <Swatch label="Line background" value={c.background} allowNone onChange={(v) => setC({ background: v }, "bg")} />
        </Row>
        <Row label="Word box">
          <Swatch label="Spoken word box" value={c.activeBox} allowNone onChange={(v) => setC({ activeBox: v }, "box")} />
        </Row>
      </Section>
    </div>
  );
}
