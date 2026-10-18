// Talks to the animator: a sandboxed iframe (web/animator.html) that compiles animation code written by the AI
// and renders it with Remotion. The code never runs in the editor's own page, so it cannot reach the account,
// the projects or the network.

export interface AnimationSpec {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  transparent: boolean;
}

export type AnimatorRequest =
  | ({ id: string; kind: "frames"; code: string; frames: number[] } & AnimationSpec)
  | ({ id: string; kind: "render"; code: string } & AnimationSpec);

export type AnimatorReply =
  | { id: string; type: "ready" }
  | { id: string; type: "progress"; progress: number }
  | { id: string; type: "frames"; frames: string[]; logs?: string[] }
  | { id: string; type: "video"; buffer: ArrayBuffer; mime: string }
  | { id: string; type: "error"; error: string }
  | { id: string; type: "hidden" }; // the tab is in the background, so the frame cannot be drawn yet

// A problem in the code itself (the AI can fix it), as opposed to the animator failing to load.
export class AnimationCodeError extends Error {}

let frame: HTMLIFrameElement | null = null;
let ready: Promise<HTMLIFrameElement> | null = null;
const waiting = new Map<string, { resolve: (r: AnimatorReply) => void; onProgress?: (p: number) => void }>();
let seq = 0;

function animator(): Promise<HTMLIFrameElement> {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    const el = document.createElement("iframe");
    el.src = "/animator.html";
    el.setAttribute("sandbox", "allow-scripts");
    el.title = "Animation renderer";
    el.setAttribute("aria-hidden", "true");
    el.tabIndex = -1;
    // Kept on screen (but invisible and out of the way): Chrome pauses iframes it considers hidden.
    Object.assign(el.style, { position: "fixed", right: "0", bottom: "0", width: "4px", height: "4px", border: "0", opacity: "0.01", pointerEvents: "none", zIndex: "-1" });
    const timer = window.setTimeout(() => {
      ready = null;
      el.remove();
      reject(new Error("The animation renderer did not load. Reload the page and try again."));
    }, 30_000);
    const onMessage = (e: MessageEvent<AnimatorReply>) => {
      if (e.source !== el.contentWindow || !e.data) return;
      if (e.data.type === "ready") {
        window.clearTimeout(timer);
        frame = el;
        resolve(el);
        return;
      }
      const w = waiting.get(e.data.id);
      if (!w) return;
      if (e.data.type === "progress") w.onProgress?.(e.data.progress);
      else {
        waiting.delete(e.data.id);
        w.resolve(e.data);
      }
    };
    window.addEventListener("message", onMessage);
    document.body.appendChild(el);
  });
  return ready;
}

const visible = () =>
  new Promise<void>((resolve) => {
    if (document.visibilityState === "visible") return resolve();
    const on = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", on);
      resolve();
    };
    document.addEventListener("visibilitychange", on);
  });

// Renders wait while the editor tab is in the background (Chrome does not draw the sandbox there).
async function ask(req: Parameters<typeof askOnce>[0], onProgress?: (p: number) => void, timeoutMs?: number): Promise<AnimatorReply> {
  for (;;) {
    await visible();
    const r = await askOnce(req, onProgress, timeoutMs);
    if (r.type !== "hidden") return r;
    await new Promise((res) => window.setTimeout(res, 300));
  }
}

async function askOnce(req: AnimatorRequest extends infer R ? (R extends AnimatorRequest ? Omit<R, "id"> : never) : never, onProgress?: (p: number) => void, timeoutMs = 240_000): Promise<AnimatorReply> {
  const el = await animator();
  const id = `a${++seq}`;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      waiting.delete(id);
      // A render stuck in an endless loop: start a fresh animator for the next one.
      if (frame === el) {
        el.remove();
        frame = null;
        ready = null;
      }
      reject(new AnimationCodeError("Rendering the animation took too long (the code may loop forever)."));
    }, timeoutMs);
    waiting.set(id, {
      onProgress,
      resolve: (r) => {
        window.clearTimeout(timer);
        resolve(r);
      },
    });
    el.contentWindow!.postMessage({ ...req, id }, "*");
  });
}

// A few stills (JPEG, base64) to check the code runs and to show the AI what it made.
export async function renderAnimationFrames(code: string, spec: AnimationSpec, frames: number[]): Promise<string[]> {
  const r = await ask({ kind: "frames", code, frames, ...spec }, undefined, 90_000);
  if (r.type === "error") throw new AnimationCodeError(r.error);
  if (r.type !== "frames") throw new Error("The animation renderer sent an unexpected answer.");
  return r.frames;
}

export async function renderAnimationVideo(code: string, spec: AnimationSpec, onProgress: (p: number) => void): Promise<Blob> {
  const r = await ask({ kind: "render", code, ...spec }, onProgress);
  if (r.type === "error") throw new AnimationCodeError(r.error);
  if (r.type !== "video") throw new Error("The animation renderer sent an unexpected answer.");
  return new Blob([r.buffer], { type: r.mime });
}
