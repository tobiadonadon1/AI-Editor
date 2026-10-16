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

test("later titles take the hook's look, and a new title in the same spot ends the previous one", () => {
  const { project, errors } = applyOps(
    sample(),
    [
      { name: "add_text", input: { text: "Stop *now*", preset: "hook", start_sec: 0, duration_sec: 3, y: 20, style: { font: "Anton" } } },
      { name: "add_text", input: { text: "Point *one*", preset: "title", start_sec: 2, duration_sec: 2, y: 22 } },
      { name: "add_text", input: { text: "*1*\nBought a board", preset: "number", start_sec: 5, duration_sec: 2, x: 80 } },
      { name: "add_text", input: { text: "Different", preset: "title", start_sec: 8, duration_sec: 1, style: { font: "Lora" } } },
    ],
    ctx,
  );
  assert.deepEqual(errors, []);
  const [hook, title, number, custom] = project.items.filter((i): i is TextItem => i.type === "text");
  assert.equal(title.style.font, "Anton");
  assert.equal(title.style.uppercase, hook.style.uppercase);
  assert.equal(title.style.strokeWidth, hook.style.strokeWidth);
  assert.equal(number.style.font, "Anton");
  assert.equal(custom.style.font, "Lora", "an explicit style still wins");
  assert.ok(Math.abs(hook.duration - 2) < 0.01, `hook ends when the title appears: ${hook.duration}`);
});

test("times the AI gives refer to the edit it saw, even after a cut earlier in the same turn", () => {
  // Cutting w0-w3 first moves w5 "ship" earlier; the AI still gave the time it saw before the turn.
  const before = wordOutputTime(tl(sample()), "w5")!;
  const { project, errors } = applyOps(
    sample(),
    [
      { name: "cut_words", input: { from_word: "w0", to_word: "w3", reason: "retake" } },
      { name: "add_text", input: { text: "Ship", preset: "callout", start_sec: before, duration_sec: 1 } },
    ],
    ctx,
  );
  assert.deepEqual(errors, []);
  const t = tl(project);
  const text = project.items.find((i) => i.type === "text")!;
  const ship = wordOutputTime(t, "w5")!;
  assert.ok(Math.abs(itemStart(text, t) - ship) < 0.1, `text at ${itemStart(text, t)}, word at ${ship}`);
});

test("bad input is rejected without side effects", () => {
  let { project } = applyOps(sample(), [{ name: "add_text", input: { text: "A", preset: "title", start_sec: 1, duration_sec: 1 } }], ctx);
  const r1 = applyOps(project, [{ name: "add_text", input: { text: "B", start_word: "w999" } }], ctx);
  assert.equal(r1.errors.length, 1, "unknown word is an error");
  assert.equal(r1.project.items.length, 1);
  project.assets.push({ id: "a1", name: "song", kind: "audio", durationSec: 30, width: 0, height: 0, hasAudio: true, size: 1 });
  ({ project } = applyOps(project, [{ name: "set_music", input: { asset_id: "a1" } }], ctx));
  const r2 = applyOps(project, [{ name: "set_music", input: { asset_id: "nope" } }], ctx);
  assert.equal(r2.errors.length, 1);
  assert.ok(r2.project.items.some((i) => i.type === "music"), "existing music kept");
});

test("a new title at the same time and place replaces the old one", () => {
  const { project } = applyOps(
    sample(),
    [
      { name: "add_text", input: { text: "One", preset: "title", start_sec: 1, duration_sec: 3 } },
      { name: "add_text", input: { text: "Two", preset: "title", start_sec: 1.2, duration_sec: 3 } },
    ],
    ctx,
  );
  const texts = project.items.filter((i): i is TextItem => i.type === "text");
  assert.deepEqual(texts.map((t) => t.text), ["Two"]);
});
