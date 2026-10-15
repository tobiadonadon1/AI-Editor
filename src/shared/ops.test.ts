import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, describeForAI } from "./ops.js";
import { FPS, newProject, type Project, type TextItem } from "./project.js";
import { buildTimeline, durationSec, itemStart, placeItems, wordOutputTime } from "./timeline.js";

// Ten words, one per second, half a second each, in a 10 s clip.
function sample(): Project {
  const p = newProject("t", "Test", "", "9:16");
  p.assets = [{ id: "m1", name: "clip", kind: "video", durationSec: 10, width: 1080, height: 1920, hasAudio: true, size: 1 }];
  p.mainAssetId = "m1";
  p.words = ["So", "um", "today", "today", "we", "ship", "the", "new", "editor", "now."].map((text, i) => ({ id: `w${i}`, text, start: i, end: i + 0.5, kind: "word" as const }));
  p.status = "ready";
  return p;
}
const ctx = { playhead: 0 };
const tl = (p: Project) => buildTimeline(p, 10, FPS);

test("cutting words shortens the edit and keeps the rest in order", () => {
  const before = durationSec(tl(sample()));
  const { project, notes, errors } = applyOps(sample(), [{ name: "cut_words", input: { from_word: "w1", to_word: "w2", reason: "retake" } }], ctx);
  assert.deepEqual(errors, []);
  assert.equal(notes.length, 1);
  assert.equal(project.cuts.w1, "retake");
  assert.equal(project.cuts.w2, "retake");
  const t = tl(project);
  assert.ok(durationSec(t) < before);
  assert.equal(wordOutputTime(t, "w1"), null);
  assert.ok(wordOutputTime(t, "w3")! > wordOutputTime(t, "w0")!);
});

test("a text layer anchored to a word follows it when an earlier cut moves it", () => {
  let { project } = applyOps(sample(), [{ name: "add_text", input: { text: "Ship *it*", preset: "callout", start_word: "w5", duration_sec: 1, sfx: "pop" } }], ctx);
  const text = project.items.find((i) => i.type === "text") as TextItem;
  assert.equal(text.anchorWord, "w5");
  assert.ok(project.items.some((i) => i.type === "sfx"), "entrance sound added");
  const at1 = itemStart(text, tl(project));
  ({ project } = applyOps(project, [{ name: "cut_words", input: { from_word: "w0", to_word: "w3", reason: "retake" } }], ctx));
  const at2 = itemStart(project.items.find((i) => i.id === text.id)!, tl(project));
  assert.ok(at2 < at1 - 2, `moved earlier: ${at1} -> ${at2}`);
  assert.equal(at2, wordOutputTime(tl(project), "w5"));
});

test("bad operations are skipped and the good ones still apply", () => {
  const { project, errors } = applyOps(
    sample(),
    [
      { name: "cut_words", input: { from_word: "w99", to_word: "w100", reason: "retake" } },
      { name: "no_such_tool", input: {} },
      { name: "set_color", input: { temperature: 20, look: "warm-film" } },
    ],
    ctx,
  );
  assert.equal(errors.length, 2);
  assert.equal(project.grade.temperature, 20);
  assert.equal(project.grade.look, "warm-film");
});

test("cut_time removes a stretch of the output and every_cut transitions land on cut points", () => {
  let { project } = applyOps(sample(), [{ name: "cut_time", input: { start_sec: 0, end_sec: 1 } }], ctx);
  assert.equal(project.rangeCuts.length, 1);
  ({ project } = applyOps(project, [{ name: "cut_words", input: { from_word: "w4", to_word: "w4", reason: "filler" } }, { name: "add_transition", input: { kind: "flash", every_cut: true } }], ctx));
  const t = tl(project);
  const transitions = project.items.filter((i) => i.type === "transition");
  assert.equal(transitions.length, t.clips.length - 1);
});

test("captions presets, format and update/remove work", () => {
  let { project } = applyOps(
    sample(),
    [
      { name: "set_captions", input: { preset: "hormozi", y: 60 } },
      { name: "set_format", input: { format: "4:5" } },
      { name: "add_text", input: { text: "Hello", start_sec: 1 } },
    ],
    ctx,
  );
  assert.equal(project.captions.preset, "hormozi");
  assert.equal(project.captions.maxWordsPerPage, 2);
  assert.equal(project.captions.y, 60);
  assert.equal(project.format, "4:5");
  const id = project.items[0].id;
  ({ project } = applyOps(project, [{ name: "update_item", input: { id, text: "Hi there", style: { color: "#ff0000", size: 120 }, position: "top" } }], ctx));
  const t = project.items[0] as TextItem;
  assert.equal(t.text, "Hi there");
  assert.equal(t.style.color, "#ff0000");
  assert.equal(t.style.size, 120);
  assert.equal(t.y, 12);
  ({ project } = applyOps(project, [{ name: "remove_items", input: { type: "text" } }], ctx));
  assert.equal(project.items.length, 0);
});

test("the AI sees ids, times and cut state", () => {
  const { project } = applyOps(sample(), [{ name: "cut_words", input: { from_word: "w1", to_word: "w1", reason: "filler" } }, { name: "add_zoom", input: { start_word: "w4", duration_sec: 1 } }], ctx);
  const text = describeForAI(project, ctx);
  assert.match(text, /w1 1\.00 CUT:filler um/);
  assert.match(text, /w4 4\.00 @\d/);
  assert.match(text, /adjust .* zoom 1\.18 punch/);
  assert.equal(placeItems(project.items, tl(project)).length, 1);
});
