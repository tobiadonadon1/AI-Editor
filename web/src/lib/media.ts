// Everything about media files happens here, in the browser, with WebCodecs (via Mediabunny).
import {
  ALL_FORMATS,
  AudioBufferSink,
  BlobSource,
  BufferTarget,
  CanvasSink,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
} from "mediabunny";
import type { AssetKind, MediaAsset } from "../../../src/shared/project";

export interface Probe extends Omit<MediaAsset, "id" | "name"> {
  fps: number;
  codec: string | null;
}

export const kindOf = (file: File): AssetKind | null =>
  file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv)$/i.test(file.name)
    ? "video"
    : file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)
        ? "audio"
        : null;

export async function probe(file: Blob, kind: AssetKind): Promise<Probe> {
  if (kind === "image") {
    const bmp = await createImageBitmap(file);
    const out = { kind, durationSec: 0, width: bmp.width, height: bmp.height, hasAudio: false, size: file.size, fps: 0, codec: null };
    bmp.close();
    return out;
  }
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const video = kind === "video" ? await input.getPrimaryVideoTrack() : null;
    const audio = await input.getPrimaryAudioTrack();
    if (kind === "video" && !video) throw new Error("This file has no video track.");
    if (kind === "audio" && !audio) throw new Error("This file has no audio track.");
    if (video && !(await video.canDecode())) throw new Error(`This browser cannot decode ${video.codec ?? "this"} video. Try Chrome, or export the clip as H.264 MP4.`);
    const durationSec = await input.computeDuration();
    const stats = video ? await video.computePacketStats(60) : null;
    return {
      kind,
      durationSec,
      width: video?.displayWidth ?? 0,
      height: video?.displayHeight ?? 0,
      hasAudio: Boolean(audio),
      size: file.size,
      fps: stats?.averagePacketRate ?? 0,
      codec: video?.codec ?? null,
    };
  } finally {
    input.dispose();
  }
}

// A lighter editing copy, like Premiere's proxies: 30 fps, at most 1080 on the short side,
// frequent keyframes so jumping between cuts is instant. Only made when the source needs it.
export function needsProxy(p: Probe) {
  const short = Math.min(p.width, p.height);
  return short > 1100 || p.fps > 32 || (p.codec !== null && p.codec !== "avc");
}

export async function makeProxy(file: Blob, p: Probe, onProgress: (v: number) => void): Promise<Blob> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const portrait = p.height >= p.width;
  const conversion = await Conversion.init({
    input,
    output,
    video: { ...(portrait ? { width: Math.min(1080, p.width) } : { height: Math.min(1080, p.height) }), frameRate: 30, codec: "avc", quality: QUALITY_HIGH, keyFrameInterval: 0.5, forceTranscode: true },
    audio: { codec: "aac", bitrate: 192_000 },
  });
  if (!conversion.isValid) throw new Error("Could not make an editing copy of this file.");
  conversion.onProgress = (v) => onProgress(v);
  await conversion.execute();
  input.dispose();
  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error("Editing copy is empty.");
  return new Blob([buffer], { type: "video/mp4" });
}

// Decoded audio, mixed to mono and resampled to 16 kHz for speech recognition and waveforms.
export async function monoAudio(file: Blob, rate = 16000): Promise<Float32Array | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const sink = new AudioBufferSink(track);
    const parts: Float32Array[] = [];
    let srcRate = track.sampleRate;
    let total = 0;
    for await (const { buffer } of sink.buffers()) {
      srcRate = buffer.sampleRate;
      const mono = new Float32Array(buffer.length);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const ch = buffer.getChannelData(c);
        for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / buffer.numberOfChannels;
      }
      parts.push(mono);
      total += mono.length;
    }
    if (!total) return null;
    const joined = new Float32Array(total);
    let o = 0;
    for (const p of parts) {
      joined.set(p, o);
      o += p.length;
    }
    if (srcRate === rate) return joined;
    // Resample with the browser's own high-quality resampler.
    const outLen = Math.ceil((total * rate) / srcRate);
    const ctx = new OfflineAudioContext(1, outLen, rate);
    const buf = ctx.createBuffer(1, total, srcRate);
    buf.copyToChannel(joined, 0);
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(ctx.destination);
    node.start();
    return (await ctx.startRendering()).getChannelData(0);
  } finally {
    input.dispose();
  }
}

function wav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

// WAV chunks that fit a serverless request, split at the quietest moment near each boundary
// so no word is cut in half.
export function wavChunks(samples: Float32Array, rate = 16000, maxSec = 110): { blob: Blob; offsetSec: number }[] {
  const max = maxSec * rate;
  const out: { blob: Blob; offsetSec: number }[] = [];
  let start = 0;
  while (start < samples.length) {
    let end = Math.min(samples.length, start + max);
    if (end < samples.length) {
      const win = Math.floor(0.05 * rate);
      let best = end;
      let bestE = Infinity;
      for (let s = end - 4 * rate; s < end - win; s += win) {
        let e = 0;
        for (let i = s; i < s + win; i++) e += samples[i] * samples[i];
        if (e < bestE) {
          bestE = e;
          best = s + Math.floor(win / 2);
        }
      }
      end = best;
    }
    out.push({ blob: wav(samples.subarray(start, end), rate), offsetSec: start / rate });
    start = end;
  }
  return out;
}

// Peak amplitude per bucket, for timeline waveforms.
export function peaks(samples: Float32Array, rate = 16000, perSec = 60): number[] {
  const size = Math.max(1, Math.floor(rate / perSec));
  const out: number[] = [];
  for (let i = 0; i < samples.length; i += size) {
    let m = 0;
    for (let k = i; k < Math.min(samples.length, i + size); k++) m = Math.max(m, Math.abs(samples[k]));
    out.push(Math.round(Math.min(1, m) * 255) / 255);
  }
  return out;
}

// Small frames along a clip for the timeline filmstrip and the AI's eyes.
export async function frames(file: Blob, times: number[], height: number, quality = 0.7): Promise<string[]> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return [];
    const width = Math.round((height * track.displayWidth) / Math.max(1, track.displayHeight));
    const sink = new CanvasSink(track, { width, height, fit: "fill" });
    const out: string[] = [];
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      if (!wrapped) {
        out.push("");
        continue;
      }
      ctx.drawImage(wrapped.canvas as CanvasImageSource, 0, 0, width, height);
      out.push(canvas.toDataURL("image/jpeg", quality));
    }
    return out;
  } finally {
    input.dispose();
  }
}

export async function imageThumb(file: Blob, height: number): Promise<string> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.height = height;
  canvas.width = Math.round((height * bmp.width) / bmp.height);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas.toDataURL("image/jpeg", 0.75);
}
