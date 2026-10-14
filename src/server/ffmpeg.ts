import { spawn } from "node:child_process";

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} failed (${code}): ${err.slice(-800)}`)),
    );
  });
}

export async function probe(file: string) {
  const json = JSON.parse(
    await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]),
  );
  const video = json.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  const hasAudio = json.streams.some((s: { codec_type: string }) => s.codec_type === "audio");
  if (!video) throw new Error("This file has no video track.");
  return {
    width: Number(video.width),
    height: Number(video.height),
    durationSec: Number(json.format.duration),
    hasAudio,
  };
}

// Editing copy: constant 30fps H.264 with frequent keyframes so the browser can
// jump between cuts quickly, scaled to fill a 1080x1920 frame. Rotation is applied.
export async function makeProxy(input: string, output: string, hasAudio: boolean) {
  await run("ffmpeg", [
    "-y", "-i", input,
    ...(hasAudio ? [] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]),
    "-vf", "scale=1080:1920:force_original_aspect_ratio=increase:force_divisible_by=2,fps=30,format=yuv420p",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-g", "15",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    ...(hasAudio ? [] : ["-shortest"]),
    "-movflags", "+faststart",
    output,
  ]);
}

// Small mono audio file for transcription.
export async function extractAudio(input: string, output: string) {
  await run("ffmpeg", ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", output]);
}
