import path from "node:path";
import { readdirSync, statSync } from "node:fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { EditVideoProps, Project } from "../shared/project";
import { ROOT } from "./storage";

let bundled: Promise<string> | null = null;
let bundledAt = 0;

// Latest change to the code the video is built from.
function sourceVersion() {
  let latest = 0;
  for (const dir of ["src/remotion", "src/shared"]) {
    for (const f of readdirSync(path.join(ROOT, dir))) {
      latest = Math.max(latest, statSync(path.join(ROOT, dir, f)).mtimeMs);
    }
  }
  return latest;
}

// Bundling takes a few seconds, so it is reused until the video code changes.
function getBundle() {
  const version = sourceVersion();
  if (!bundled || version > bundledAt) {
    bundledAt = version;
    bundled = bundle({ entryPoint: path.join(ROOT, "src/remotion/index.ts") }).catch((e) => {
      bundled = null;
      throw e;
    });
  }
  return bundled;
}

export async function renderProject(
  project: Project,
  videoSrc: string,
  outputLocation: string,
  onProgress: (progress: number) => void,
) {
  const serveUrl = await getBundle();
  const inputProps: EditVideoProps = { project, videoSrc };
  const composition = await selectComposition({ serveUrl, id: "Edit", inputProps });
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    crf: 18,
    outputLocation,
    inputProps,
    onProgress: ({ progress }) => onProgress(progress),
  });
}
