import { Fragment, useEffect, useMemo, useRef } from "react";
import type { CutReason, Edit, Word } from "../../src/shared/project";
import { timecode } from "./ui";

export const REASON_NOTE: Record<CutReason, string> = {
  retake: "retake",
  false_start: "false start",
  filler: "filler",
  stumble: "stumble",
  off_brief: "off brief",
  manual: "you",
};

export interface Selection {
  anchor: number;
  focus: number;
}

export const selectionRange = (s: Selection | null): [number, number] | null =>
  s ? [Math.min(s.anchor, s.focus), Math.max(s.anchor, s.focus)] : null;

// Three hand-drawn pencil strokes, picked per word so a run of cuts looks drawn, not ruled.
const STROKES = [
  "M0 5.5 C 18 4, 38 6.6, 60 5 S 88 4.6, 100 5.8",
  "M0 5 C 25 6.4, 52 3.8, 76 5.4 S 94 5.6, 100 4.8",
  "M0 6 C 22 4.6, 46 5.8, 70 4.4 S 92 6, 100 5.2",
];

interface Line {
  start: number; // index of first word
  end: number; // index of last word (inclusive)
}

// Break the transcript into script lines: at sentence ends and long silences.
function toLines(words: Word[]): Line[] {
  const lines: Line[] = [];
  let start = 0;
  words.forEach((w, i) => {
    const next = words[i + 1];
    const gap = next ? next.start - w.end : 0;
    const sentenceEnd = /[.!?]$/.test(w.text);
    if (!next || (sentenceEnd && (gap > 0.25 || i - start > 14)) || gap > 1.2 || i - start > 28) {
      lines.push({ start, end: i });
      start = i + 1;
    }
  });
  return lines;
}

interface Props {
  words: Word[];
  edit: Edit;
  currentWordId: string | null;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  onWordClick: (index: number) => void;
}

export function Script({ words, edit, currentWordId, selection, onSelect, onWordClick }: Props) {
  const range = selectionRange(selection);
  const page = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => toLines(words), [words]);
  const emphasis = useMemo(() => new Set(edit.emphasis), [edit.emphasis]);
  const dragging = useRef(false);

  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  // Keep the spoken word in view while the preview plays.
  useEffect(() => {
    if (!currentWordId) return;
    const el = page.current?.querySelector<HTMLElement>(`[data-id="${currentWordId}"]`);
    if (!el) return;
    const box = el.getBoundingClientRect();
    if (box.top < 120 || box.bottom > window.innerHeight - 80) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [currentWordId]);

  return (
    <div className="script" ref={page} onPointerLeave={() => (dragging.current = false)}>
      {lines.map((line) => {
        const lineWords = words.slice(line.start, line.end + 1);
        const allCut = lineWords.every((w) => edit.cuts[w.id]);
        let runPos = 0; // position inside a run of cut words, for the left-to-right pencil stroke
        return (
          <div className={`line${allCut ? " line-cut" : ""}`} key={line.start}>
            <span className="tc">{timecode(lineWords[0].start)}</span>
            <p className="line-text">
              {lineWords.map((w, k) => {
                const i = line.start + k;
                const prev = words[i - 1];
                const gap = prev && k > 0 ? w.start - prev.end : 0;
                const reason = edit.cuts[w.id];
                runPos = reason ? runPos + 1 : 0;
                const selected = range !== null && i >= range[0] && i <= range[1];
                // A run of cut words is struck as one line, through the spaces between them.
                const joinsNext = Boolean(reason && k < lineWords.length - 1 && edit.cuts[words[i + 1].id]);
                // The margin note sits on the line where a struck run ends.
                const runEnds = Boolean(reason && !joinsNext);
                const runReason = reason && edit.cuts[words[i - runPos + 1].id];
                const cls = [
                  "w",
                  w.kind === "audio_event" && "w-event",
                  reason && "w-cut",
                  joinsNext && "w-join",
                  emphasis.has(w.id) && !reason && "w-hl",
                  selected && "w-sel",
                  w.id === currentWordId && "w-now",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <Fragment key={w.id}>
                    {gap > edit.settings.maxPauseSec && (
                      <span className="pause" title={`${gap.toFixed(1)} s of silence, trimmed`}>
                        ({gap.toFixed(1)} s){" "}
                      </span>
                    )}
                    <span
                      data-id={w.id}
                      className={cls}
                      style={{ ["--d" as string]: `${Math.min(runPos, 12) * 22}ms` }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        dragging.current = true;
                        if (e.shiftKey && selection) onSelect({ anchor: selection.anchor, focus: i });
                        else {
                          onSelect({ anchor: i, focus: i });
                          onWordClick(i);
                        }
                      }}
                      onPointerEnter={() => {
                        if (dragging.current && selection) onSelect({ anchor: selection.anchor, focus: i });
                      }}
                    >
                      {w.kind === "audio_event" ? `(${w.text})` : w.text}
                      <svg className="stroke" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
                        <path d={STROKES[i % STROKES.length]} pathLength={1} />
                      </svg>
                      {reason && <span className="visually-hidden"> (cut: {REASON_NOTE[reason]})</span>}
                    </span>
                    {runEnds && runReason && (
                      <span className="note" aria-hidden="true">
                        {REASON_NOTE[runReason]}
                      </span>
                    )}{" "}
                  </Fragment>
                );
              })}
            </p>
          </div>
        );
      })}
    </div>
  );
}
