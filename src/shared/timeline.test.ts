import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimeline } from "./timeline";
import { emptyEdit, type Word } from "./project";

const w = (id: string, text: string, start: number, end: number): Word => ({
  id,
  text,
  start,
  end,
  kind: "word",
});

// "So today... so today I want to show you this." with a retake and a long pause.
const words = [
  w("w0", "So", 1.0, 1.2),
  w("w1", "today", 1.25, 1.6),
  w("w2", "so", 2.5, 2.7),
  w("w3", "today", 2.75, 3.1),
  w("w4", "I", 3.15, 3.25),
  w("w5", "want", 3.3, 3.5),
  w("w6", "to", 5.0, 5.1), // 1.5s pause before this word
  w("w7", "show", 5.15, 5.4),
  w("w8", "you.", 5.45, 5.8),
];

test("removes leading silence, cut words and long pauses", () => {
  const edit = emptyEdit();
  edit.cuts = { w0: "retake", w1: "retake" };
  const t = buildTimeline(words, edit, 8, 30);

  assert.equal(t.clips.length, 2); // "so today I want" + "to show you."
  assert.equal(t.clips[0].fromFrame, 0);
  assert.equal(t.clips[1].fromFrame, t.clips[0].durationInFrames);
  // Source starts just before "so" at 2.5s, with padding.
  assert.equal(t.clips[0].srcStartFrame, Math.round((2.5 - 0.08) * 30));
  // Output is much shorter than the 8s source.
  assert.ok(t.durationInFrames / 30 < 4, `duration ${t.durationInFrames / 30}`);
  assert.deepEqual(
    t.words.map((x) => x.id),
    ["w2", "w3", "w4", "w5", "w6", "w7", "w8"],
  );
});

test("retimes words onto the output timeline", () => {
  const edit = emptyEdit();
  edit.cuts = { w0: "retake", w1: "retake" };
  const t = buildTimeline(words, edit, 8, 30);
  const so = t.words.find((x) => x.id === "w2")!;
  assert.ok(Math.abs(so.startMs - 80) < 40, `starts at ${so.startMs}`);
  const to = t.words.find((x) => x.id === "w6")!;
  const clip1StartMs = (t.clips[1].fromFrame / 30) * 1000;
  assert.ok(Math.abs(to.startMs - (clip1StartMs + 80)) < 40, `to at ${to.startMs}`);
  // Words keep their order and never overlap.
  for (let i = 1; i < t.words.length; i++) {
    assert.ok(t.words[i].startMs >= t.words[i - 1].endMs - 1);
  }
});

test("caption pages break at punctuation, cuts and size", () => {
  const edit = emptyEdit();
  const t = buildTimeline(words, edit, 8, 30);
  for (const p of t.pages) assert.ok(p.words.length <= edit.captionStyle.maxWordsPerPage);
  assert.equal(t.pages.at(-1)!.words.at(-1)!.text, "you.");
  for (let i = 1; i < t.pages.length; i++) {
    assert.ok(t.pages[i].startMs >= t.pages[i - 1].endMs - 1, "pages overlap");
  }
});

test("footage without speech stays whole", () => {
  const t = buildTimeline([], emptyEdit(), 5, 30);
  assert.equal(t.clips.length, 1);
  assert.equal(t.durationInFrames, 150);
});
