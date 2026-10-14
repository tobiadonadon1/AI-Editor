import type { Edit, Word } from "./project";

// A piece of the source video placed on the output timeline.
export interface Clip {
  srcStartFrame: number;
  srcEndFrame: number; // exclusive
  fromFrame: number; // position on the output timeline
  durationInFrames: number;
}

// A kept word with its time on the output timeline.
export interface TimedWord {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  emphasis: boolean;
  clipIndex: number;
}

export interface CaptionPage {
  startMs: number;
  endMs: number;
  words: TimedWord[];
}

export interface Timeline {
  clips: Clip[];
  words: TimedWord[];
  pages: CaptionPage[];
  durationInFrames: number;
}

interface Range {
  start: number;
  end: number;
  words: Word[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Group kept words into continuous phrases. A phrase ends at a cut word or at a long pause.
function keptRanges(words: Word[], edit: Edit, durationSec: number): Range[] {
  const spoken = words.filter((w) => w.kind === "word");
  const { maxPauseSec, padBeforeSec, padAfterSec } = edit.settings;
  const runs: Word[][] = [];
  let current: Word[] | null = null;

  spoken.forEach((w, i) => {
    if (edit.cuts[w.id]) {
      current = null;
      return;
    }
    const prev = spoken[i - 1];
    const continues =
      current !== null && prev && !edit.cuts[prev.id] && w.start - prev.end <= maxPauseSec;
    if (continues) {
      current!.push(w);
    } else {
      current = [w];
      runs.push(current);
    }
  });

  return runs.map((run) => {
    const first = run[0];
    const last = run[run.length - 1];
    const firstIdx = spoken.indexOf(first);
    const lastIdx = spoken.indexOf(last);
    // Pad for breathing room, but never reach into a neighbouring word's audio.
    const prevEnd = firstIdx > 0 ? spoken[firstIdx - 1].end : 0;
    const nextStart = lastIdx < spoken.length - 1 ? spoken[lastIdx + 1].start : durationSec;
    const start = clamp(first.start - padBeforeSec, Math.min(prevEnd, first.start), first.start);
    const end = clamp(last.end + padAfterSec, last.end, Math.max(nextStart, last.end));
    return { start: clamp(start, 0, durationSec), end: clamp(end, 0, durationSec), words: run };
  });
}

export function buildTimeline(
  words: Word[],
  edit: Edit,
  durationSec: number,
  fps: number,
): Timeline {
  const hasSpeech = words.some((w) => w.kind === "word");
  // Footage without speech is kept whole.
  const ranges: Range[] = hasSpeech
    ? keptRanges(words, edit, durationSec)
    : [{ start: 0, end: durationSec, words: [] }];

  const emphasis = new Set(edit.emphasis);
  const clips: Clip[] = [];
  const timed: TimedWord[] = [];
  let cursor = 0;
  let lastSrcEnd = 0;

  for (const r of ranges) {
    const srcStartFrame = Math.max(Math.round(r.start * fps), lastSrcEnd);
    const srcEndFrame = Math.round(r.end * fps);
    const durationInFrames = srcEndFrame - srcStartFrame;
    if (durationInFrames < 2) continue;

    const clipIndex = clips.length;
    clips.push({ srcStartFrame, srcEndFrame, fromFrame: cursor, durationInFrames });

    const offsetSec = (cursor - srcStartFrame) / fps; // source time -> output time
    const clipEndMs = ((cursor + durationInFrames) / fps) * 1000;
    for (const w of r.words) {
      timed.push({
        id: w.id,
        text: w.text,
        startMs: Math.max(0, (w.start + offsetSec) * 1000),
        endMs: Math.min(clipEndMs, (w.end + offsetSec) * 1000),
        emphasis: emphasis.has(w.id),
        clipIndex,
      });
    }
    cursor += durationInFrames;
    lastSrcEnd = srcEndFrame;
  }

  const durationInFrames = Math.max(cursor, 1);
  const pages = buildPages(timed, edit.captionStyle.maxWordsPerPage, (durationInFrames / fps) * 1000);
  return { clips, words: timed, pages, durationInFrames };
}

const ENDS_PHRASE = /[.!?,;:]$/;

// Split words into short caption pages, breaking at punctuation, pauses and cuts.
export function buildPages(words: TimedWord[], maxWords: number, totalMs: number): CaptionPage[] {
  const groups: TimedWord[][] = [];
  let group: TimedWord[] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    const breakBefore =
      group.length >= maxWords ||
      (prev && (w.clipIndex !== prev.clipIndex || w.startMs - prev.endMs > 400));
    if (breakBefore && group.length) {
      groups.push(group);
      group = [];
    }
    group.push(w);
    if (ENDS_PHRASE.test(w.text)) {
      groups.push(group);
      group = [];
    }
  });
  if (group.length) groups.push(group);

  return groups.map((g, i) => {
    const next = groups[i + 1];
    const lingerEnd = g[g.length - 1].endMs + 500;
    const endMs = Math.min(next ? next[0].startMs : totalMs, lingerEnd, totalMs);
    return { startMs: g[0].startMs, endMs: Math.max(endMs, g[g.length - 1].endMs), words: g };
  });
}

// Where a source word ends up on the output timeline, in seconds (null if it was cut).
export function outputTimeOf(timeline: Timeline, wordId: string): number | null {
  const w = timeline.words.find((t) => t.id === wordId);
  return w ? w.startMs / 1000 : null;
}
