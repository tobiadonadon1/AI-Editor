import type { Edit, Project } from "../../src/shared/project";

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  health: () => fetch("/api/health").then((r) => json<{ anthropic: boolean; elevenlabs: boolean }>(r)),
  list: () => fetch("/api/projects").then((r) => json<Project[]>(r)),
  get: (id: string) => fetch(`/api/projects/${id}`).then((r) => json<Project>(r)),
  create: (brief: string, name: string) =>
    fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief, name }),
    }).then((r) => json<Project>(r)),
  patch: (id: string, change: { brief?: string; name?: string; edit?: Edit }) =>
    fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
    }).then((r) => json<Project>(r)),
  analyze: (id: string) => fetch(`/api/projects/${id}/analyze`, { method: "POST" }).then((r) => json(r)),
  replan: (id: string) => fetch(`/api/projects/${id}/replan`, { method: "POST" }).then((r) => json(r)),
  render: (id: string) => fetch(`/api/projects/${id}/render`, { method: "POST" }).then((r) => json(r)),
};

// Streams the file to the server with upload progress.
export function uploadSource(id: string, file: File, onProgress: (p: number) => void): Promise<Project> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/projects/${id}/source?name=${encodeURIComponent(file.name)}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status < 300 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Upload failed. Is the server running?"));
    xhr.send(file);
  });
}
