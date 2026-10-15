// The signed-in user's projects and media in Vercel Blob. IndexedDB stays the fast working copy;
// the cloud is what makes a project survive a cleared browser and open on another device.
import { upload } from "@vercel/blob/client";
import { FPS, mainAsset, type MediaAsset, type Project } from "../../../src/shared/project";
import { buildTimeline } from "../../../src/shared/timeline";
import { authHeaders, call } from "./api";

export interface Summary {
  id: string;
  name: string;
  format: string;
  updatedAt: string;
  durationSec: number;
}

let user: string | null = null;
let available = false;
export const cloud = {
  // Set by the app once Clerk knows who is signed in and the server says storage exists.
  configure: (userId: string | null, storage: boolean) => {
    user = userId;
    available = Boolean(userId && storage);
  },
  get on() {
    return available;
  },
  userId: () => user,
};

const summaryOf = (p: Project): Summary => {
  const a = mainAsset(p);
  return { id: p.id, name: p.name, format: p.format, updatedAt: p.updatedAt, durationSec: a ? buildTimeline(p, a.durationSec, FPS).durationInFrames / FPS : 0 };
};

export const listProjects = () => call<Summary[]>("/api/projects");
export const getProject = (id: string) => call<Project>(`/api/projects?id=${encodeURIComponent(id)}`).catch(() => null);
export const saveProject = (p: Project) =>
  call(`/api/projects?id=${encodeURIComponent(p.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: p, summary: summaryOf(p) }) });
export const deleteProject = (id: string) => call(`/api/projects?id=${encodeURIComponent(id)}`, { method: "DELETE" });

export const mediaPath = (projectId: string, asset: MediaAsset, ext: string) => `u/${user}/media/${projectId}/${asset.id}.${ext}`;

export async function uploadMedia(path: string, blob: Blob, onProgress: (p: number) => void) {
  await upload(path, blob, {
    access: "private",
    handleUploadUrl: "/api/upload",
    headers: await authHeaders(),
    contentType: blob.type || "application/octet-stream",
    multipart: blob.size > 200 * 1024 ** 2,
    onUploadProgress: (e) => onProgress(e.percentage / 100),
  });
}

// The sample's media ships with the site; everything else comes through a short-lived signed link.
export async function downloadMedia(path: string, onProgress: (p: number) => void): Promise<Blob> {
  let url = path;
  if (!path.startsWith("/")) {
    const { urls } = await call<{ urls: Record<string, string> }>("/api/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths: [path] }) });
    url = urls[path];
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Could not download media (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.byteLength;
    if (total) onProgress(got / total);
  }
  return new Blob(parts as BlobPart[], { type: res.headers.get("content-type") ?? "" });
}
