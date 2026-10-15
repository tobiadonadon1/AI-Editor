import type { Item, Project, Word } from "./project.js";

// A piece of the main source video placed on the output timeline.
export interface Clip {
  index: number;
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
  fps: number;
}

interface Range {
  start: number;
  end: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Group kept words into continuous phrases. A phrase ends at a cut word or at a long pause.
function speechRanges(p: Project, durationSec: number): Range[] {
  const spoken = p.words.filter((w) => w.kind === "word");
  const { maxPauseSec, padBeforeSec, padAfterSec } = p.settings;
  const runs: Word[][] = [];
  let current: Word[] | null = null;

  spoken.forEach((w, i) => {
    if (p.cuts[w.id]) {
      current = null;
      return;
    }
    const prev = spoken[i - 1];
    const continues = current !== null && prev && !p.cuts[prev.id] && w.start - prev.end <= maxPauseSec;
    if (continues) current!.push(w);
    else {
      current = [w];
      runs.push(current);
    }
  });

  const index = new Map(spoken.map((w, i) => [w.id, i]));
  return runs.map((run) => {
    const first = run[0];
    const last = run[run.length - 1];
    const fi = index.get(first.id)!;
    const li = index.get(last.id)!;
    // Pad for breathing room, but never reach into a neighbouring word's audio.
    const prevEnd = fi > 0 ? spoken[fi - 1].end : 0;
    const nextStart = li < spoken.length - 1 ? spoken[li + 1].start : durationSec;
    const start = clamp(first.start - padBeforeSec, Math.min(prevEnd, first.start), first.start);
    const end = clamp(last.end + padAfterSec, last.end, Math.max(nextStart, last.end));
    return { start: clamp(start, 0, durationSec), end: clamp(end, 0, durationSec) };
  });
}

// Remove hand-made range cuts from the kept ranges.
function subtract(ranges: Range[], cuts: Range[]): Range[] {
  let out = ranges;
  for (const c of cuts) {
    const next: Range[] = [];
    for (const r of out) {
      if (c.end <= r.start || c.start >= r.end) next.push(r);
      else {
        if (c.start > r.start) next.push({ start: r.start, end: c.start });
        if (c.end < r.end) next.push({ start: c.end, end: r.end });
      }
    }
    out = next;
  }
  return out;
}

function splitAt(ranges: Range[], splits: number[]): Range[] {
  if (!splits.length) return ranges;
  const sorted = [...splits].sort((a, b) => a - b);
  const out: Range[] = [];
  for (const r of ranges) {
    let s = r.start;
    for (const t of sorted) {
      if (t > s + 0.05 && t < r.end - 0.05) {
        out.push({ start: s, end: t });
        s = t;
      }
    }
    out.push({ start: s, end: r.end });
  }
  return out;
}

export function buildTimeline(p: Project, durationSec: number, fps: number): Timeline {
  const hasSpeech = p.words.some((w) => w.kind === "word");
  // Footage without speech is kept whole, minus anything cut by hand.
  let ranges = hasSpeech ? speechRanges(p, durationSec) : durationSec > 0 ? [{ start: 0, end: durationSec }] : [];
  ranges = splitAt(subtract(ranges, p.rangeCuts), p.splits);

  const emphasis = new Set(p.emphasis);
  const spoken = p.words.filter((w) => w.kind === "word" && !p.cuts[w.id]);
  const clips: Clip[] = [];
  const timed: TimedWord[] = [];
  let cursor = 0;
  let lastSrcEnd = 0;
  let wi = 0;

  for (const r of ranges) {
    const srcStartFrame = Math.max(Math.round(r.start * fps), lastSrcEnd);
    const srcEndFrame = Math.round(r.end * fps);
    const durationInFrames = srcEndFrame - srcStartFrame;
    if (durationInFrames < 2) continue;

    const index = clips.length;
    clips.push({ index, srcStartFrame, srcEndFrame, fromFrame: cursor, durationInFrames });

    const srcStart = srcStartFrame / fps;
    const srcEnd = srcEndFrame / fps;
    const offsetSec = (cursor - srcStartFrame) / fps; // source time -> output time
    const clipEndMs = ((cursor + durationInFrames) / fps) * 1000;
    while (wi < spoken.length && spoken[wi].end <= srcStart + 0.001) wi++;
    for (let k = wi; k < spoken.length && spoken[k].start < srcEnd; k++) {
      const w = spoken[k];
      // A word belongs to the clip that holds most of it.
      const mid = (w.start + w.end) / 2;
      if (mid < srcStart || mid >= srcEnd) continue;
      timed.push({
        id: w.id,
        text: w.text,
        startMs: Math.max(cursor / fps, w.start + offsetSec) * 1000,
        endMs: Math.min(clipEndMs, (w.end + offsetSec) * 1000),
        emphasis: emphasis.has(w.id),
        clipIndex: index,
      });
    }
    cursor += durationInFrames;
    lastSrcEnd = srcEndFrame;
  }

  const durationInFrames = Math.max(cursor, 1);
  const pages = buildPages(timed, p.captions.maxWordsPerPage, (durationInFrames / fps) * 1000);
  return { clips, words: timed, pages, durationInFrames, fps };
}

const ENDS_PHRASE = /[.!?,;:]$/;

// Split words into short caption pages, breaking at punctuation, pauses and cuts.
export function buildPages(words: TimedWord[], maxWords: number, totalMs: number): CaptionPage[] {
  const groups: TimedWord[][] = [];
  let group: TimedWord[] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    const breakBefore = group.length >= maxWords || (prev && (w.clipIndex !== prev.clipIndex || w.startMs - prev.endMs > 400));
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

export const durationSec = (t: Timeline) => t.durationInFrames / t.fps;

// Where a source word ends up on the output timeline, in seconds (null if it was cut).
export function wordOutputTime(t: Timeline, wordId: string): number | null {
  const w = t.words.find((x) => x.id === wordId);
  return w ? w.startMs / 1000 : null;
}

export function sourceToOutput(t: Timeline, srcSec: number): number | null {
  const f = srcSec * t.fps;
  for (const c of t.clips) {
    if (f >= c.srcStartFrame && f < c.srcEndFrame) return (c.fromFrame + (f - c.srcStartFrame)) / t.fps;
  }
  return null;
}

export function outputToSource(t: Timeline, outSec: number): number | null {
  const f = outSec * t.fps;
  for (const c of t.clips) {
    if (f >= c.fromFrame && f < c.fromFrame + c.durationInFrames) return (c.srcStartFrame + (f - c.fromFrame)) / t.fps;
  }
  const last = t.clips[t.clips.length - 1];
  return last ? last.srcEndFrame / t.fps : null;
}

export function clipAt(t: Timeline, outSec: number): Clip | null {
  const f = outSec * t.fps;
  return t.clips.find((c) => f >= c.fromFrame && f < c.fromFrame + c.durationInFrames) ?? null;
}

// Output-time boundaries between clips: the cut points.
export const cutPoints = (t: Timeline) => t.clips.slice(1).map((c) => c.fromFrame / t.fps);

// An item's actual start: anchored items follow their word through later cuts.
export function itemStart(item: Item, t: Timeline): number {
  if (item.anchorWord) {
    const at = wordOutputTime(t, item.anchorWord);
    if (at !== null) return Math.max(0, at + (item.anchorOffset ?? 0));
  }
  return item.start;
}

export interface PlacedItem {
  item: Item;
  start: number;
  end: number;
}

export function placeItems(items: Item[], t: Timeline): PlacedItem[] {
  const total = durationSec(t);
  return items
    .map((item) => {
      const start = Math.min(itemStart(item, t), Math.max(0, total - 0.1));
      // Music runs to the end unless trimmed shorter.
      const end = Math.min(total, start + Math.max(0.1, item.duration));
      return { item, start, end };
    })
    .filter((p) => p.end > p.start);
}
