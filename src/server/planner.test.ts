import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPlan } from "./planner";
import { emptyEdit, type Word } from "../shared/project";

const words: Word[] = ["So", "um", "today", "today", "we", "ship"].map((text, i) => ({
  id: `w${i}`,
  text,
  start: i,
  end: i + 0.5,
  kind: "word",
}));

test("applies ranges, keeps manual cuts and drops emphasis on cut words", () => {
  const edit = emptyEdit();
  edit.cuts = { w5: "manual", w4: "filler" };
  const next = applyPlan(edit, words, {
    summary: "Cut the filler and the first take.",
    removals: [
      { fromWord: "w1", toWord: "w1", reason: "filler" },
      { fromWord: "w3", toWord: "w2", reason: "retake" }, // reversed range still works
      { fromWord: "w99", toWord: "w100", reason: "retake" }, // unknown ids are ignored
    ],
    emphasis: ["w2", "w0"],
  });
  assert.deepEqual(next.cuts, { w5: "manual", w1: "filler", w2: "retake", w3: "retake" });
  assert.deepEqual(next.emphasis, ["w0"]);
  assert.equal(next.summary, "Cut the filler and the first take.");
});
