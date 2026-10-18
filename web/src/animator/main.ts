// The animator: compiles animation code written by the AI and renders it with Remotion, inside a sandboxed
// iframe (see animator.html). The editor talks to it only through postMessage.
import "./shim";
import React from "react";
import * as Remotion from "remotion";
import * as Shapes from "@remotion/shapes";
import * as Paths from "@remotion/paths";
import * as Noise from "@remotion/noise";
import { transform } from "sucrase";
import { renderMediaOnWeb, renderStillOnWeb } from "@remotion/web-renderer";
import { smoothTextOutlines } from "../../../src/remotion/canvas-text";
import { font, fontReady } from "../../../src/remotion/fonts";
import { FONT_IDS } from "../../../src/shared/project";
import type { AnimatorReply, AnimatorRequest } from "../lib/animator";

const MODULES: Record<string, unknown> = { react: React, remotion: Remotion, "@remotion/shapes": Shapes, "@remotion/paths": Paths, "@remotion/noise": Noise };

class CodeError extends Error {}

// The renderer's own warnings, sent back with failures so problems inside the sandbox are visible.
const logs: string[] = [];
for (const level of ["warn", "error"] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    logs.push(args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" ").slice(0, 300));
    if (logs.length > 20) logs.shift();
    orig(...args);
  };
}

function compile(code: string): React.ComponentType {
  let js: string;
  try {
    js = transform(code, { transforms: ["typescript", "jsx", "imports"], production: true }).code;
  } catch (e) {
    throw new CodeError(`Syntax error: ${e instanceof Error ? e.message : String(e)}`);
  }
  const module = { exports: {} as Record<string, unknown> };
  const require = (name: string) => {
    if (!(name in MODULES)) throw new CodeError(`"${name}" cannot be imported. Available: ${Object.keys(MODULES).join(", ")}.`);
    return MODULES[name];
  };
  try {
    new Function("require", "module", "exports", "React", js)(require, module, module.exports, React);
  } catch (e) {
    throw new CodeError(`Error while loading the module: ${e instanceof Error ? e.message : String(e)}`);
  }
  const C = module.exports.default ?? Object.values(module.exports).find((v) => typeof v === "function");
  if (typeof C !== "function") throw new CodeError("The code has no default export: it must `export default function Animation()`.");
  return C as React.ComponentType;
}

// Errors thrown while a frame renders come back with the frame number, so the AI can fix them.
function guarded(C: React.ComponentType): React.ComponentType {
  class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null };
    static getDerivedStateFromError(error: Error) {
      return { error };
    }
    render() {
      if (this.state.error) throw this.state.error;
      return this.props.children;
    }
  }
  return function Guarded() {
    return React.createElement(Boundary, null, React.createElement(C));
  };
}

async function loadFonts(code: string) {
  const used = FONT_IDS.filter((id) => code.includes(id));
  await Promise.all((used.length ? used : (["Inter"] as const)).map((id) => fontReady(id)));
  const specs = (used.length ? used : (["Inter"] as const)).flatMap((id) => {
    const family = font(id);
    return ["400", "700", "900"].map((w) => `${w} 100px "${family}"`);
  });
  await Promise.all(specs.map((s) => document.fonts.load(s).catch(() => undefined)));
}

function errorText(e: unknown, frame?: number) {
  const msg = e instanceof Error ? e.message : String(e);
  const where = frame === undefined ? "" : ` (at frame ${frame})`;
  return `${msg}${where}`.slice(0, 1500);
}

const reply = (msg: AnimatorReply, transfer: Transferable[] = []) => parent.postMessage(msg, "*", transfer);

// Stills are flattened onto a neutral backdrop like a video frame, so the reviewer sees what a viewer would.
async function stillJpeg(canvas: OffscreenCanvas): Promise<string> {
  const w = Math.min(640, canvas.width);
  const h = Math.round((canvas.height * w) / canvas.width);
  const out = new OffscreenCanvas(w, h);
  const ctx = out.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#4a5560");
  g.addColorStop(1, "#7b6f63");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(canvas, 0, 0, w, h);
  const blob = await out.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Chrome lays out a sandboxed frame only while its tab is showing; in a background tab every frame would come
// out blank. The editor then waits until the tab is visible again and asks once more.
const laidOut = () => innerWidth > 0 && document.visibilityState === "visible";

async function handle(req: AnimatorRequest) {
  if (!laidOut()) return reply({ id: req.id, type: "hidden" });
  smoothTextOutlines();
  const { width, height, fps, durationInFrames } = req;
  let C: React.ComponentType;
  try {
    C = guarded(compile(req.code));
  } catch (e) {
    return reply({ id: req.id, type: "error", error: errorText(e) });
  }
  await loadFonts(req.code);
  const composition = { component: C, durationInFrames, fps, width, height, id: "animation" };
  if (req.kind === "frames") {
    const frames: string[] = [];
    for (const frame of req.frames) {
      if (!laidOut()) return reply({ id: req.id, type: "hidden" });
      try {
        const still = await renderStillOnWeb({ composition, frame, inputProps: {}, licenseKey: "free-license", delayRenderTimeoutInMilliseconds: 15000 });
        frames.push(await stillJpeg(await still.canvas()));
      } catch (e) {
        return reply({ id: req.id, type: "error", error: errorText(e, frame) });
      }
    }
    return reply({ id: req.id, type: "frames", frames, logs: logs.splice(0) });
  }
  const abort = new AbortController();
  const watch = window.setInterval(() => !laidOut() && abort.abort(), 200);
  try {
    const res = await renderMediaOnWeb({
      signal: abort.signal,
      composition,
      inputProps: {},
      container: "webm",
      videoCodec: "vp9",
      transparent: req.transparent,
      muted: true,
      videoBitrate: "very-high",
      licenseKey: "free-license",
      delayRenderTimeoutInMilliseconds: 15000,
      onProgress: (p) => reply({ id: req.id, type: "progress", progress: p.progress }),
    });
    const blob = await res.getBlob();
    const buffer = await blob.arrayBuffer();
    reply({ id: req.id, type: "video", buffer, mime: blob.type || "video/webm" }, [buffer]);
  } catch (e) {
    reply(abort.signal.aborted ? { id: req.id, type: "hidden" } : { id: req.id, type: "error", error: errorText(e) });
  } finally {
    window.clearInterval(watch);
  }
}

let queue = Promise.resolve();
window.addEventListener("message", (e: MessageEvent<AnimatorRequest>) => {
  if (e.source !== parent || !e.data || typeof e.data.id !== "string") return;
  const req = e.data;
  queue = queue.then(() => handle(req)).catch((err) => reply({ id: req.id, type: "error", error: errorText(err) }));
});
reply({ id: "", type: "ready" });
