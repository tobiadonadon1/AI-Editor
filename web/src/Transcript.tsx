import { Fragment, useEffect, useRef } from "react";
import type { CutReason, Edit, Word } from "../../src/shared/project";

const REASON_LABEL: Record<CutReason, string> = {
  retake: "Retake",
  false_start: "False start",
  filler: "Filler",
  stumble: "Stumble",
  off_brief: "Off brief",
  manual: "Cut by you",
};

export interface Selection {
  anchor: number;
  focus: number;
}

export const selectionRange = (s: Selection | null): [number, number] | null =>
  s ? [Math.min(s.anchor, s.focus), Math.max(s.anchor, s.focus)] : null;

interface Props {
  words: Word[];
  edit: Edit;
  currentWordId: string | null;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  onWordClick: (index: number) => void;
}

// The transcript is the main editing surface: cut words are struck through,
// key words are marked, and long pauses show where silence will be trimmed.
export function Transcript({ words, edit, currentWordId, selection, onSelect, onWordClick }: Props) {
  const range = selectionRange(selection);
  const container = useRef<HTMLDivElement>(null);
  const emphasis = new Set(edit.emphasis);

  useEffect(() => {
    if (!currentWordId) return;
    const el = container.current?.querySelector<HTMLElement>(`[data-id="${currentWordId}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentWordId]);

  if (!words.length) return <p className="muted">No transcript yet.</p>;

  return (
    <div className="transcript" ref={container}>
      {words.map((w, i) => {
        const prev = words[i - 1];
        const gap = prev ? w.start - prev.end : 0;
        const reason = edit.cuts[w.id];
        const selected = range !== null && i >= range[0] && i <= range[1];
        const cls = [
          "word",
          w.kind === "audio_event" && "word-event",
          reason && `word-cut word-cut-${reason}`,
          emphasis.has(w.id) && !reason && "word-key",
          selected && "word-selected",
          w.id === currentWordId && "word-current",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <Fragment key={w.id}>
            {gap > 1.2 && <br />}
            {gap > edit.settings.maxPauseSec && (
              <span className="pause" title={`${gap.toFixed(1)}s pause, trimmed automatically`}>
                {gap.toFixed(1)}s
              </span>
            )}
            <span
              data-id={w.id}
              className={cls}
              title={reason ? REASON_LABEL[reason] : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                if (e.shiftKey && selection) onSelect({ anchor: selection.anchor, focus: i });
                else onSelect({ anchor: i, focus: i });
                if (!e.shiftKey) onWordClick(i);
              }}
              onMouseEnter={(e) => {
                if (e.buttons === 1 && selection) onSelect({ anchor: selection.anchor, focus: i });
              }}
            >
              {w.kind === "audio_event" ? `(${w.text})` : w.text}
            </span>{" "}
          </Fragment>
        );
      })}
    </div>
  );
}

export function CutLegend({ edit }: { edit: Edit }) {
  const counts = new Map<CutReason, number>();
  for (const r of Object.values(edit.cuts)) counts.set(r, (counts.get(r) ?? 0) + 1);
  if (!counts.size) return null;
  return (
    <div className="legend">
      {[...counts].map(([reason, n]) => (
        <span key={reason} className={`legend-item word-cut-${reason}`}>
          {REASON_LABEL[reason]} · {n}
        </span>
      ))}
    </div>
  );
}
