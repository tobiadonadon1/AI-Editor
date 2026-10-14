import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { emptyEdit, type Project } from "../shared/project";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const PROJECTS_DIR = path.join(ROOT, "storage", "projects");

export const projectDir = (id: string) => {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Invalid project id");
  return path.join(PROJECTS_DIR, id);
};
export const projectFile = (id: string, name: string) => path.join(projectDir(id), name);

// Writes are serialised per project so status updates from the pipeline and
// edits from the UI never interleave.
const queues = new Map<string, Promise<unknown>>();
function serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(id) ?? Promise.resolve()).then(fn, fn);
  queues.set(id, next.catch(() => undefined));
  return next;
}

export async function createProject(brief: string, name: string): Promise<Project> {
  const id = randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  const project: Project = {
    version: 1,
    id,
    name: name || "Untitled edit",
    createdAt: now,
    updatedAt: now,
    brief,
    status: "draft",
    words: [],
    edit: emptyEdit(),
    render: { status: "idle", progress: 0 },
  };
  await mkdir(projectDir(id), { recursive: true });
  await save(project);
  return project;
}

export async function load(id: string): Promise<Project | null> {
  const file = projectFile(id, "project.json");
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf8")) as Project;
}

async function save(project: Project) {
  const file = projectFile(project.id, "project.json");
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(project, null, 2));
  await rename(tmp, file);
}

export function update(id: string, change: (p: Project) => void | Project): Promise<Project> {
  return serial(id, async () => {
    const current = await load(id);
    if (!current) throw new Error(`Project ${id} not found`);
    const next = change(current) ?? current;
    next.updatedAt = new Date().toISOString();
    await save(next);
    return next;
  });
}

export async function list(): Promise<Project[]> {
  if (!existsSync(PROJECTS_DIR)) return [];
  const ids = await readdir(PROJECTS_DIR);
  const projects = await Promise.all(ids.map((id) => load(id).catch(() => null)));
  return projects
    .filter((p): p is Project => p !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
