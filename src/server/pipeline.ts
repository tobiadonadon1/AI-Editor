import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Project, ProjectStatus } from "../shared/project";
import { extractAudio, makeProxy, probe } from "./ffmpeg";
import { transcribe } from "./transcribe";
import { applyPlan, planEdit } from "./planner";
import { renderProject } from "./render";
import { load, projectFile, update } from "./storage";

const running = new Set<string>();

const setStatus = (id: string, status: ProjectStatus, statusDetail?: string) =>
  update(id, (p) => {
    p.status = status;
    p.statusDetail = statusDetail;
    p.error = undefined;
  });

async function guarded(id: string, job: () => Promise<void>) {
  if (running.has(id)) return;
  running.add(id);
  try {
    await job();
  } catch (e) {
    console.error(`[${id}]`, e);
    await update(id, (p) => {
      p.status = "error";
      p.error = e instanceof Error ? e.message : String(e);
    });
  } finally {
    running.delete(id);
  }
}

// Upload -> editing copy -> transcript -> AI edit plan.
export function analyze(id: string, originalFile: string) {
  return guarded(id, async () => {
    const proxy = projectFile(id, "proxy.mp4");
    const audio = projectFile(id, "audio.mp3");
    if (!existsSync(proxy)) {
      await setStatus(id, "preparing", "Preparing the footage");
      const info = await probe(originalFile);
      await makeProxy(originalFile, proxy, info.hasAudio);
      await extractAudio(proxy, audio);
      const out = await probe(proxy);
      await update(id, (p) => {
        p.source = {
          originalName: p.source?.originalName ?? "video",
          width: out.width,
          height: out.height,
          durationSec: out.durationSec,
        };
      });
    }

    await setStatus(id, "transcribing", "Transcribing speech");
    const { words, language, raw } = await transcribe(audio);
    await writeFile(projectFile(id, "transcript.raw.json"), JSON.stringify(raw, null, 2));
    await update(id, (p) => {
      p.words = words;
      p.language = language;
    });

    await runPlanner(id);
  });
}

async function runPlanner(id: string) {
  const project = (await load(id)) as Project;
  if (!project.words.some((w) => w.kind === "word")) {
    await update(id, (p) => {
      p.status = "ready";
      p.statusDetail = undefined;
      p.edit.summary = "No speech found, so the footage was kept whole.";
    });
    return;
  }
  await setStatus(id, "planning", "Planning the edit");
  const plan = await planEdit(project.words, project.brief, project.source?.durationSec ?? 0);
  await writeFile(projectFile(id, "plan.json"), JSON.stringify(plan, null, 2));
  await update(id, (p) => {
    p.edit = applyPlan(p.edit, p.words, plan);
    p.status = "ready";
    p.statusDetail = undefined;
  });
}

// Re-run only the AI planning step, e.g. after the brief changed.
export function replan(id: string) {
  return guarded(id, () => runPlanner(id));
}

export function render(id: string, mediaOrigin: string) {
  return guarded(`${id}:render`, async () => {
    const project = (await load(id)) as Project;
    await update(id, (p) => {
      p.render = { status: "rendering", progress: 0 };
    });
    let last = 0;
    try {
      await renderProject(project, `${mediaOrigin}/media/${id}/proxy.mp4`, projectFile(id, "export.mp4"), (progress) => {
        if (progress - last < 0.02) return;
        last = progress;
        void update(id, (p) => {
          if (p.render.status === "rendering") p.render.progress = progress;
        });
      });
      await update(id, (p) => {
        p.render = { status: "done", progress: 1, finishedAt: new Date().toISOString() };
      });
    } catch (e) {
      await update(id, (p) => {
        p.render = { status: "error", progress: 0, error: e instanceof Error ? e.message : String(e) };
      });
      console.error(`[${id}] render failed`, e);
    }
  });
}

export const isBusy = (id: string) => running.has(id);
