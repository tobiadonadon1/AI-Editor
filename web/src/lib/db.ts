// Projects and media live in this browser (IndexedDB). Nothing large leaves the machine:
// only 16 kHz audio goes to transcription and a text description of the edit goes to the AI.
import type { Project } from "../../../src/shared/project";

const DB = "ai-editor";
const VERSION = 1;

let opened: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("projects")) d.createObjectStore("projects", { keyPath: "id" });
      if (!d.objectStoreNames.contains("media")) d.createObjectStore("media");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opened;
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const store = {
  listProjects: () => tx<Project[]>("projects", "readonly", (s) => s.getAll() as IDBRequest<Project[]>).then((ps) => ps.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))),
  getProject: (id: string) => tx<Project | undefined>("projects", "readonly", (s) => s.get(id) as IDBRequest<Project | undefined>),
  putProject: (p: Project) => tx("projects", "readwrite", (s) => s.put(p)),
  deleteProject: async (p: Project) => {
    await tx("projects", "readwrite", (s) => s.delete(p.id));
    for (const a of p.assets) {
      await tx("media", "readwrite", (s) => s.delete(a.id));
      await tx("media", "readwrite", (s) => s.delete(`${a.id}:proxy`));
    }
  },
  putMedia: (key: string, blob: Blob) => tx("media", "readwrite", (s) => s.put(blob, key)),
  getMedia: (key: string) => tx<Blob | undefined>("media", "readonly", (s) => s.get(key) as IDBRequest<Blob | undefined>),
};

// Ask the browser not to evict our storage under pressure.
export const persist = () => navigator.storage?.persist?.().catch(() => false);
