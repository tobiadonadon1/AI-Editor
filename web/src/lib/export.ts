import { renderMediaOnWeb } from "@remotion/web-renderer";
import { EditVideo } from "../../../src/remotion/EditVideo";
import { FORMATS, FPS, type EditVideoProps, type Project } from "../../../src/shared/project";
import { buildTimeline } from "../../../src/shared/timeline";
import { mainAsset } from "../../../src/shared/project";

export type ExportQuality = "high" | "medium" | "very-high";

export interface ExportResult {
  blob: Blob;
  url: string;
  seconds: number;
}

// Renders the exact composition the Program monitor shows, in this tab, to an H.264 MP4.
export async function exportMp4(
  project: Project,
  media: Record<string, string>,
  sfx: Record<string, string>,
  opts: { quality: ExportQuality; scale: number; range?: [number, number] | null },
  onProgress: (p: number) => void,
  signal: AbortSignal,
): Promise<ExportResult> {
  const f = FORMATS[project.format];
  const t = buildTimeline(project, mainAsset(project)?.durationSec ?? 0, FPS);
  const t0 = performance.now();
  const inputProps: EditVideoProps = { project, media, sfx };
  const res = await renderMediaOnWeb({
    composition: { component: EditVideo, durationInFrames: t.durationInFrames, fps: FPS, width: f.width, height: f.height, id: "edit", defaultProps: inputProps },
    inputProps,
    videoCodec: "h264",
    audioCodec: "aac",
    container: "mp4",
    videoBitrate: opts.quality,
    scale: opts.scale,
    frameRange: opts.range ? [Math.round(opts.range[0] * FPS), Math.max(Math.round(opts.range[0] * FPS), Math.round(opts.range[1] * FPS) - 1)] : null,
    licenseKey: "free-license",
    signal,
    onProgress: (p) => onProgress(p.progress),
  });
  const blob = await res.getBlob();
  return { blob, url: URL.createObjectURL(blob), seconds: (performance.now() - t0) / 1000 };
}
