import { put } from "@vercel/blob";
import { animationProvider, authorize, hasStorage, json, rateLimited, readJson, userPrefix } from "./_lib/server.js";

// Animation placeholders become real animations here. With ANIMATION_API_URL set, requests go to that service
// (contract in docs/animation-api.md); without it a built-in mock answers like one would, so the whole flow can
// be tested: it "renders" for a few seconds, then returns a sample transparent animation.

interface Job {
  id: string;
  status: "queued" | "processing" | "ready" | "failed";
  url?: string;
  error?: string;
}

interface CreateBody {
  prompt?: unknown;
  durationSec?: unknown;
  width?: unknown;
  height?: unknown;
  fps?: unknown;
  fit?: unknown;
  format?: unknown;
  style?: unknown;
  context?: unknown;
  projectId?: unknown;
  layerId?: unknown;
}

const MOCK_RENDER_MS = 4000;
const MOCK_FILE = "/sample/animation.webm";
const STATUSES = ["queued", "processing", "ready", "failed"];
const safeId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9_-]{1,64}$/i.test(v);
const int = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : null);

async function service(path: string, init: RequestInit = {}): Promise<Job> {
  const base = process.env.ANIMATION_API_URL!.replace(/\/+$/, "");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(process.env.ANIMATION_API_KEY ? { Authorization: `Bearer ${process.env.ANIMATION_API_KEY}` } : {}) },
    signal: AbortSignal.timeout(25_000),
  });
  const body = (await res.json().catch(() => null)) as Partial<Job> | null;
  if (!res.ok) throw new Error(body?.error ? `the animation service said: ${String(body.error).slice(0, 200)}` : `the animation service answered ${res.status}`);
  if (!body || typeof body.id !== "string" || !STATUSES.includes(body.status as string)) throw new Error("the animation service sent an answer in an unexpected shape");
  return body as Job;
}

const EXT: Record<string, string> = { "video/webm": "webm", "video/mp4": "mp4", "video/quicktime": "mov", "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg", "image/gif": "gif" };

// The finished file goes into the user's own media folder, so the browser never needs the service's link
// (which may expire or not allow cross-origin downloads) and the project opens on any device.
async function store(url: string, userId: string, projectId: string, assetId: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) throw new Error(`could not download the animation (${res.status})`);
  if (Number(res.headers.get("content-length")) > 500 * 1024 ** 2) throw new Error("the animation file is over 500 MB");
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = EXT[type] ?? new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() ?? "mp4";
  const pathname = `${userPrefix(userId)}media/${projectId}/${assetId}.${ext}`;
  await put(pathname, res.body, { access: "private", contentType: type || "application/octet-stream", allowOverwrite: true, addRandomSuffix: false });
  return pathname;
}

export async function POST(req: Request) {
  const user = await authorize(req);
  if (user instanceof Response) return user;
  const limited = rateLimited(user.userId, "animations", 60, 3600_000);
  if (limited) return limited;
  const b = await readJson<CreateBody>(req);
  const prompt = typeof b?.prompt === "string" ? b.prompt.trim().slice(0, 600) : "";
  const width = int(b?.width, 16, 4096);
  const height = int(b?.height, 16, 4096);
  const fps = int(b?.fps, 1, 60);
  const durationSec = typeof b?.durationSec === "number" && Number.isFinite(b.durationSec) ? Math.min(30, Math.max(0.5, b.durationSec)) : null;
  if (!prompt || !width || !height || !fps || !durationSec) return json({ error: "Expected { prompt, durationSec, width, height, fps }" }, 400);
  if (animationProvider() === "mock") return json({ job: { id: `mock-${Date.now()}`, provider: "mock" }, status: "processing" });
  try {
    const job = await service("", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        durationSec,
        width,
        height,
        fps,
        background: b?.fit === "fullscreen" ? "opaque" : "transparent",
        format: typeof b?.format === "string" ? b.format : undefined,
        style: b?.style && typeof b.style === "object" ? b.style : undefined,
        context: typeof b?.context === "string" ? b.context.slice(0, 1000) : undefined,
        projectId: safeId(b?.projectId) ? b.projectId : undefined,
        layerId: safeId(b?.layerId) ? b.layerId : undefined,
      }),
    });
    return json({ job: { id: job.id, provider: "api" }, status: job.status, error: job.error });
  } catch (e) {
    console.error("animations create", e);
    return json({ error: `Could not start the animation: ${e instanceof Error ? e.message : "unknown error"}.` }, 502);
  }
}

// Polled by the editor until the animation is ready. `project` and `asset` say where to keep the file.
export async function GET(req: Request) {
  const user = await authorize(req);
  if (user instanceof Response) return user;
  const q = new URL(req.url).searchParams;
  const id = q.get("id") ?? "";
  const provider = q.get("provider");
  const projectId = q.get("project");
  const assetId = q.get("asset");
  if (provider === "mock") {
    const started = Number(id.match(/^mock-(\d{10,16})$/)?.[1]);
    if (!started) return json({ error: "Unknown job" }, 404);
    return json(Date.now() - started < MOCK_RENDER_MS ? { status: "processing" } : { status: "ready", url: MOCK_FILE });
  }
  if (provider !== "api" || !/^[\w.:-]{1,128}$/.test(id)) return json({ error: "Unknown job" }, 404);
  if (animationProvider() !== "api") return json({ error: "No animation service is configured on this server (ANIMATION_API_URL)." }, 503);
  try {
    const job = await service(`/${encodeURIComponent(id)}`);
    if (job.status === "failed") return json({ status: "failed", error: job.error ? String(job.error).slice(0, 300) : "The animation service could not make this animation." });
    if (job.status !== "ready") return json({ status: job.status });
    if (typeof job.url !== "string" || !/^https?:\/\//.test(job.url)) return json({ status: "failed", error: "The animation service said it was ready but sent no file link." });
    if (hasStorage() && safeId(projectId) && safeId(assetId)) return json({ status: "ready", path: await store(job.url, user.userId, projectId, assetId) });
    return json({ status: "ready", url: job.url });
  } catch (e) {
    console.error("animations poll", e);
    return json({ error: `Could not check the animation: ${e instanceof Error ? e.message : "unknown error"}.` }, 502);
  }
}
