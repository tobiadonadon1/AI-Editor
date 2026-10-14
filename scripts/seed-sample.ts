// Creates a ready-to-edit sample project from samples/ without calling any API.
// Usage: npx tsx scripts/seed-sample.ts
import { readFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { createProject, projectFile, update, ROOT } from "../src/server/storage";
import { extractAudio, makeProxy, probe } from "../src/server/ffmpeg";
import { applyPlan, type Plan } from "../src/server/planner";
import type { Word } from "../src/shared/project";

const video = path.join(ROOT, "samples/test-talking.mp4");
const fixture = JSON.parse(await readFile(path.join(ROOT, "samples/test-talking.words.json"), "utf8")) as {
  text: string;
  start: number;
  end: number;
}[];

const project = await createProject(
  "Tight, energetic edit for Reels. Remove mistakes and repeated takes.",
  "Sample: three ways to edit faster",
);
await copyFile(video, projectFile(project.id, "original.mp4"));
const info = await probe(video);
await makeProxy(video, projectFile(project.id, "proxy.mp4"), info.hasAudio);
await extractAudio(projectFile(project.id, "proxy.mp4"), projectFile(project.id, "audio.mp3"));
const out = await probe(projectFile(project.id, "proxy.mp4"));

const words: Word[] = fixture.map((w, i) => ({ id: `w${i}`, ...w, kind: "word" }));
const find = (text: string, from = 0) => words.findIndex((w, i) => i >= from && w.text.toLowerCase().startsWith(text));

// A hand-written plan in the same shape the AI returns.
const secondSo = find("so", 1);
const uh = find("uh");
const thirdOne = find("third");
const plan: Plan = {
  summary: "Sample plan: removed the false start, two filler words and the repeated phrase.",
  removals: [
    { fromWord: "w0", toWord: words[secondSo - 1].id, reason: "retake" },
    { fromWord: words[uh].id, toWord: words[uh].id, reason: "filler" },
    { fromWord: words[thirdOne - 1].id, toWord: words[thirdOne + 1].id, reason: "retake" },
  ],
  emphasis: [find("three"), find("faster"), find("pause"), find("ai"), find("twice")]
    .filter((i) => i >= 0)
    .map((i) => words[i].id),
};

await update(project.id, (p) => {
  p.source = { originalName: "test-talking.mp4", width: out.width, height: out.height, durationSec: out.durationSec };
  p.words = words;
  p.edit = applyPlan(p.edit, words, plan);
  p.status = "ready";
});
console.log(`Sample project ${project.id} is ready.`);
