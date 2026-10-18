import { useSyncExternalStore } from "react";
import type { PlayerRef } from "@remotion/player";
import { DEFAULT_SETUP, FORMATS, FPS, mainAsset, newProject, uid, type AnimationItem, type CaptionStyle, type ChatMessage, type FormatId, type Item, type MediaAsset, type Project, type SetupOptions, type SfxId, type TextItem, type Word } from "../../../src/shared/project";
import { captionPreset, fullBrief } from "../../../src/shared/presets";
import { applyOps, describeForAI, type Op } from "../../../src/shared/ops";
import { buildTimeline, durationSec, itemStart, placeItems, type Timeline } from "../../../src/shared/timeline";
import { store as db } from "./db";
import { frames, imageThumb, kindOf, makeProxy, monoAudio, needsProxy, peaks, probe, wavChunks } from "./media";
import { api, ApiError } from "./api";
import * as cloudApi from "./cloud";
import { cloud } from "./cloud";
import { sfxLibrary } from "./sfx";
import { AnimationCodeError, renderAnimationFrames, renderAnimationVideo, type AnimationSpec } from "./animator";

export type Tool = "select" | "razor" | "type" | "hand";
export type Workspace = "editing" | "color" | "graphics" | "captions" | "audio";

export interface Task {
  id: string;
  label: string;
  progress: number | null; // null = indeterminate
}

export interface EditorState {
  project: Project | null;
  timeline: Timeline | null;
  past: Project[];
  future: Project[];
  media: Record<string, string>; // asset id -> object URL (proxy if there is one)
  originals: Record<string, Blob>;
  thumbs: Record<string, { every: number; frames: string[] }>;
  waves: Record<string, number[]>; // 60 peaks per second
  sfx: Record<string, string>;
  frame: number;
  playing: boolean;
  selectedItem: string | null;
  selectedClip: number | null;
  wordSel: { anchor: number; focus: number } | null;
  tool: Tool;
  workspace: Workspace;
  pxPerSec: number;
  tasks: Task[];
  assistantBusy: boolean;
  notice: string | null;
  saving: boolean;
  synced: "off" | "pending" | "saved" | "error";
}

const initial: EditorState = {
  project: null,
  timeline: null,
  past: [],
  future: [],
  media: {},
  originals: {},
  thumbs: {},
  waves: {},
  sfx: {},
  frame: 0,
  playing: false,
  selectedItem: null,
  selectedClip: null,
  wordSel: null,
  tool: "select",
  workspace: "editing",
  pxPerSec: 60,
  tasks: [],
  assistantBusy: false,
  notice: null,
  saving: false,
  synced: "off",
};

let state: EditorState = initial;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function set(patch: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  emit();
}
export const get = () => state;

export function useEditor<T>(select: (s: EditorState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(state),
  );
}

export const player: { current: PlayerRef | null } = { current: null };

const timelineOf = (p: Project) => buildTimeline(p, mainAsset(p)?.durationSec ?? 0, FPS);

// ---------- saving ----------

// The browser copy is written right away; the cloud copy a few seconds after the last change
// (one database write per pause in editing), and immediately when leaving the project.
let saveTimer: number | undefined;
let cloudTimer: number | undefined;
function scheduleSave() {
  window.clearTimeout(saveTimer);
  set({ saving: true });
  saveTimer = window.setTimeout(async () => {
    const p = state.project;
    if (p) await db.putProject(p).catch(() => set({ notice: "Could not save to this browser's storage." }));
    set({ saving: false });
  }, 400);
  if (cloud.on) {
    window.clearTimeout(cloudTimer);
    set({ synced: "pending" });
    cloudTimer = window.setTimeout(() => void flushCloud(), 2500);
  }
}

// One save at a time, and each save sends the newest version: a save that starts while another is
// in flight waits, then sends whatever is current, so an older copy never lands last.
let syncing: Promise<void> | null = null;
export async function flushCloud(target: Project | null = state.project): Promise<void> {
  window.clearTimeout(cloudTimer);
  if (syncing) {
    await syncing;
    // Leaving the editor passes the project explicitly, since the store may already be on the next one.
    if (state.synced === "pending" || (target && target !== state.project)) return flushCloud(target === state.project ? state.project : target);
    return;
  }
  const p = target;
  if (!cloud.on || !p || (p === state.project && state.synced !== "pending")) return;
  syncing = cloudApi
    .saveProject(p)
    .then(() => {
      if (state.project === p) set({ synced: "saved" });
    })
    .catch((e) => {
      set({ synced: "error" });
      if (e instanceof ApiError && e.code === "conflict")
        set({ notice: "This project was changed on another device after you opened it here. Reopen it to load the newer version; your changes here are kept in this browser." });
    })
    .finally(() => (syncing = null));
  await syncing;
  if (state.project && state.project !== p && state.synced === "pending") return flushCloud();
}

// Status and chat updates: saved, but not part of undo.
export function setProject(next: Project) {
  next.updatedAt = new Date().toISOString();
  set({ project: next, timeline: timelineOf(next) });
  scheduleSave();
}

// Every edit goes through here: a new snapshot, undo history and a save.
// Changes with the same mergeKey in quick succession (a slider drag) are one undo step.
let lastMerge: { key: string; at: number } | null = null;
export function commit(change: (draft: Project) => void, mergeKey?: string) {
  const cur = state.project;
  if (!cur) return;
  const draft = structuredClone(cur);
  change(draft);
  const now = performance.now();
  const merge = mergeKey && lastMerge && lastMerge.key === mergeKey && now - lastMerge.at < 900;
  lastMerge = mergeKey ? { key: mergeKey, at: now } : null;
  if (!merge) set({ past: [...state.past.slice(-149), cur], future: [] });
  setProject(draft);
}

// Drags update live and land in undo history as one step.
export function beginGesture() {
  const before = state.project;
  return {
    update: (change: (draft: Project) => void) => {
      const cur = state.project;
      if (!cur) return;
      const draft = structuredClone(cur);
      change(draft);
      setProject(draft);
    },
    end: () => {
      if (before && state.project !== before) set({ past: [...state.past.slice(-149), before], future: [] });
    },
  };
}

const keepLive =(snapshot: Project, live: Project): Project => ({ ...snapshot, chat: live.chat, status: live.status, statusDetail: live.statusDetail, error: live.error, assets: live.assets });

export function undo() {
  const { past, project } = state;
  if (!past.length || !project) return;
  const prev = keepLive(past[past.length - 1], project);
  set({ past: past.slice(0, -1), future: [project, ...state.future] });
  setProject(prev);
}

export function redo() {
  const { future, project } = state;
  if (!future.length || !project) return;
  const next = keepLive(future[0], project);
  set({ future: future.slice(1), past: [...state.past, project] });
  setProject(next);
}

// ---------- playback ----------

export const playheadSec = () => state.frame / FPS;

export function seek(sec: number) {
  const t = state.timeline;
  if (!t) return;
  const f = Math.max(0, Math.min(t.durationInFrames - 1, Math.round(sec * FPS)));
  player.current?.seekTo(f);
  set({ frame: f });
}

// ---------- loading ----------

const editCopy = async (asset: MediaAsset) => (asset.proxy && (await db.getMedia(`${asset.id}:proxy`))) || (await db.getMedia(asset.id));

async function urlFor(asset: MediaAsset): Promise<string | null> {
  const blob = await editCopy(asset);
  return blob ? URL.createObjectURL(blob) : null;
}

// Each open gets a number; work from an earlier open that finishes late is dropped.
let openSeq = 0;
export async function openProject(id: string) {
  const seq = ++openSeq;
  const stale = () => seq !== openSeq;
  Object.values(state.media).forEach((u) => URL.revokeObjectURL(u));
  set({ media: {} });
  let project = await db.getProject(id);
  // The account's copy wins when it is newer (edited on another device) or this browser has none.
  let remote: Project | null = null;
  let remoteKnown = true;
  if (cloud.on) {
    try {
      remote = await cloudApi.getProject(id);
    } catch (e) {
      // Offline or a server error: open what this browser has, and do not push it over the account's copy.
      remoteKnown = false;
      if (!project) throw new Error(`Could not load this project from your account: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (stale()) return;
    if (remote && (!project || remote.updatedAt > project.updatedAt)) {
      project = remote;
      await db.putProject(remote);
    }
  }
  if (stale()) return;
  if (!project) throw new Error(cloud.on ? "This project is not in your account." : "This project is not in this browser. Projects are stored on the device where they were made.");
  // A project the account does not have yet (made before signing in, or its first save failed) is sent now.
  const unsynced = cloud.on && remoteKnown && (!remote || remote.updatedAt < project.updatedAt);
  state = { ...initial, workspace: state.workspace, pxPerSec: state.pxPerSec, synced: !cloud.on ? "off" : !remoteKnown ? "error" : unsynced ? "pending" : "saved" };
  set({ project, timeline: timelineOf(project) });
  if (!remoteKnown) set({ notice: "Could not reach your account, so this is the copy saved in this browser. Changes sync when the connection is back (use Retry in the header)." });
  if (unsynced) void flushCloud();
  void sfxLibrary().then((sfx) => !stale() && set({ sfx }));
  // Each file appears as soon as it is ready, instead of after the slowest download.
  for (const a of project.assets) {
    if (!(await editCopy(a)) && a.cloud) await fetchFromCloud(a);
    if (stale()) return;
    const url = await urlFor(a);
    if (stale()) {
      if (url) URL.revokeObjectURL(url);
      return;
    }
    if (url) set((s) => ({ media: { ...s.media, [a.id]: url } }));
  }
  for (const a of project.assets) void loadVisuals(a);
  // Media imported before signing in, or an upload cut off by closing the tab.
  for (const a of project.assets) if (!a.cloud && cloud.on) void backUp(project.id, a);
  // A tab closed mid-import leaves the project half-done: resume where it stopped.
  if (project.status === "transcribing" || project.status === "planning" || project.status === "importing") void resume();
  // Animations that were still being made when the tab closed.
  // Code animations are made in this tab, so one cut off by closing it starts again.
  for (const it of project.items)
    if (it.type === "animation" && it.status === "generating" && it.job) void (it.job.provider === "code" ? generateAnimation(it.id, project.id) : pollAnimation(project.id, it.id));
}

// Leaving the editor sends unsaved changes and frees the media held in memory.
export function closeProject(id: string) {
  const p = state.project;
  if (p?.id !== id) return;
  if (state.synced === "pending") void flushCloud(p);
  openSeq++;
  Object.values(state.media).forEach((u) => URL.revokeObjectURL(u));
  state = { ...initial, workspace: state.workspace, pxPerSec: state.pxPerSec };
  emit();
}

// Applies a change to a project whether or not it is still the one open (work that finishes after
// the user moved on lands in the right project).
async function updateProject(id: string, change: (p: Project) => Project) {
  if (state.project?.id === id) return setProject(change(state.project));
  const stored = await db.getProject(id);
  if (!stored) return;
  const next = { ...change(stored), updatedAt: new Date().toISOString() };
  await db.putProject(next);
  if (cloud.on) await cloudApi.saveProject(next).catch(() => undefined);
}

async function loadVisuals(a: MediaAsset) {
  const cached = await db.getMedia(`${a.id}:visuals`);
  if (cached) {
    const v = JSON.parse(await cached.text()) as { thumbs?: EditorState["thumbs"][string]; wave?: number[] };
    set((s) => ({ thumbs: v.thumbs ? { ...s.thumbs, [a.id]: v.thumbs } : s.thumbs, waves: v.wave ? { ...s.waves, [a.id]: v.wave } : s.waves }));
    return;
  }
  const blob = (await db.getMedia(a.id)) ?? null;
  if (!blob) return;
  const out: { thumbs?: EditorState["thumbs"][string]; wave?: number[] } = {};
  try {
    if (a.kind === "video") {
      const every = Math.max(0.5, a.durationSec / 120);
      const times = Array.from({ length: Math.max(1, Math.ceil(a.durationSec / every)) }, (_, i) => i * every);
      out.thumbs = { every, frames: await frames((await db.getMedia(`${a.id}:proxy`)) ?? blob, times, 64, 0.6) };
    } else if (a.kind === "image") out.thumbs = { every: 1e9, frames: [await imageThumb(blob, 64)] };
    if (a.kind !== "image" && a.hasAudio) {
      const mono = await monoAudio(blob, 8000);
      if (mono) out.wave = peaks(mono, 8000, 60);
    }
  } catch (e) {
    console.warn("visuals", e);
  }
  set((s) => ({ thumbs: out.thumbs ? { ...s.thumbs, [a.id]: out.thumbs } : s.thumbs, waves: out.wave ? { ...s.waves, [a.id]: out.wave } : s.waves }));
  await db.putMedia(`${a.id}:visuals`, new Blob([JSON.stringify(out)], { type: "application/json" }));
}

// ---------- tasks ----------

function task(label: string) {
  const t: Task = { id: uid("task"), label, progress: null };
  set((s) => ({ tasks: [...s.tasks, t] }));
  return {
    progress: (p: number | null, l?: string) => set((s) => ({ tasks: s.tasks.map((x) => (x.id === t.id ? { ...x, progress: p, label: l ?? x.label } : x)) })),
    done: () => set((s) => ({ tasks: s.tasks.filter((x) => x.id !== t.id) })),
  };
}

const status = (patch: Partial<Project>) => {
  if (state.project) setProject({ ...state.project, ...patch });
};
export const patchProject = status;

// ---------- cloud media ----------

// This device gets the account's edit copy (the proxy when one was made) and treats it as its original.
async function fetchFromCloud(a: MediaAsset) {
  const t = task(`Downloading ${a.name}`);
  try {
    const blob = await cloudApi.downloadMedia(a.cloud!, (v) => t.progress(v));
    await db.putMedia(a.id, blob);
  } catch (e) {
    set({ notice: `Could not download ${a.name}: ${e instanceof Error ? e.message : String(e)}` });
  } finally {
    t.done();
  }
}

// Upload the edit copy so the project opens anywhere; the project records where it went.
async function backUp(projectId: string, a: MediaAsset) {
  const blob = await editCopy(a);
  if (!blob || !cloud.on) return;
  const ext = a.proxy ? "mp4" : (blob instanceof File ? blob.name.split(".").pop() : "") || { video: "mp4", audio: "m4a", image: "jpg" }[a.kind];
  const path = cloudApi.mediaPath(projectId, a, ext!.toLowerCase());
  const t = task(`Uploading ${a.name} to your account`);
  try {
    await cloudApi.uploadMedia(path, blob, (v) => t.progress(v));
    await updateProject(projectId, (p) => ({ ...p, assets: p.assets.map((x) => (x.id === a.id ? { ...x, cloud: path } : x)) }));
  } catch (e) {
    set({ notice: `${a.name} is saved in this browser but did not upload to your account: ${e instanceof Error ? e.message : String(e)}. It will retry next time you open the project.` });
  } finally {
    t.done();
  }
}

// ---------- importing ----------

export async function importFiles(files: File[], opts: { asMain?: boolean; role?: "animation" } = {}): Promise<MediaAsset[]> {
  const added: MediaAsset[] = [];
  const projectId = state.project?.id;
  if (!projectId) return added;
  for (const file of files) {
    const kind = kindOf(file);
    if (!kind) {
      set({ notice: `${file.name} is not a video, image or audio file.` });
      continue;
    }
    const t = task(`Importing ${file.name}`);
    try {
      const info = await probe(file, kind);
      const asset: MediaAsset = { id: uid("m"), name: file.name.replace(/\.[^.]+$/, ""), kind, durationSec: info.durationSec, width: info.width, height: info.height, hasAudio: info.hasAudio, size: file.size, ...(opts.role ? { role: opts.role } : {}) };
      if (opts.role === "animation" && kind === "audio") throw new Error(`${file.name} is audio; animations are video or image files.`);
      await db.putMedia(asset.id, file);
      let url = URL.createObjectURL(file);
      // Animations are used as they are: a proxy would flatten a transparent background.
      if (kind === "video" && needsProxy(info) && opts.role !== "animation") {
        t.progress(0, `Creating proxy for ${file.name}`);
        try {
          const proxy = await makeProxy(file, info, (v) => t.progress(v));
          await db.putMedia(`${asset.id}:proxy`, proxy);
          URL.revokeObjectURL(url);
          url = URL.createObjectURL(proxy);
          asset.proxy = true;
          const p2 = await probe(proxy, "video");
          asset.width = p2.width;
          asset.height = p2.height;
        } catch (e) {
          console.warn("proxy failed, editing the original", e);
        }
      }
      const here = state.project?.id === projectId;
      if (here) set((s) => ({ media: { ...s.media, [asset.id]: url } }));
      else URL.revokeObjectURL(url);
      await updateProject(projectId, (cur) => {
        const isMain = (opts.asMain || !cur.mainAssetId) && kind === "video" && opts.role !== "animation";
        return { ...cur, assets: [...cur.assets, asset], mainAssetId: isMain ? asset.id : cur.mainAssetId };
      });
      if (here) void loadVisuals(asset);
      if (cloud.on) void backUp(projectId, asset);
      added.push(asset);
    } catch (e) {
      set({ notice: e instanceof Error ? e.message : String(e) });
    } finally {
      t.done();
    }
  }
  return added;
}

// ---------- transcription + first cut ----------

export async function transcribeMain() {
  const p = state.project!;
  const asset = mainAsset(p);
  if (!asset) return;
  const health = await api.health();
  if (!health.elevenlabs) {
    status({ status: "ready", statusDetail: undefined, error: undefined });
    set({ notice: "Transcription is not set up on this server (ELEVENLABS_API_KEY), so the video was imported without a transcript. You can still edit, color, add text and export." });
    return false;
  }
  status({ status: "transcribing", statusDetail: "Transcribing speech", error: undefined });
  const t = task("Transcribing");
  try {
    const blob = (await db.getMedia(asset.id))!;
    const mono = await monoAudio(blob, 16000);
    if (!mono) {
      status({ words: [], status: "ready", statusDetail: undefined });
      return false;
    }
    const chunks = wavChunks(mono, 16000);
    const words: Word[] = [];
    let language: string | undefined;
    for (let i = 0; i < chunks.length; i++) {
      t.progress(i / chunks.length, `Transcribing ${chunks.length > 1 ? `part ${i + 1} of ${chunks.length}` : ""}`.trim());
      // Later parts keep the language of the first, and each part gets a second try.
      const res = await api.transcribeChunk(chunks[i].blob, language).catch((e) => {
        if (e instanceof ApiError && (e.code === "auth" || e.code === "key")) throw e;
        return api.transcribeChunk(chunks[i].blob, language);
      });
      language ??= res.language;
      for (const w of res.words) words.push({ ...w, id: `w${words.length}`, start: w.start + chunks[i].offsetSec, end: w.end + chunks[i].offsetSec });
    }
    status({ words, language });
    return true;
  } catch (e) {
    status({ status: "error", error: e instanceof Error ? e.message : String(e) });
    throw e;
  } finally {
    t.done();
  }
}

// Stills from the raw footage so the AI can see light, colour and framing.
async function aiFrames(): Promise<string[]> {
  const p = state.project;
  const asset = p && mainAsset(p);
  if (!asset) return [];
  const blob = (asset.proxy && (await db.getMedia(`${asset.id}:proxy`))) || (await db.getMedia(asset.id));
  if (!blob) return [];
  const d = asset.durationSec;
  const shots = await frames(blob, [d * 0.15, d * 0.5, d * 0.85], 448, 0.72).catch(() => []);
  return shots.filter(Boolean).map((s) => s.split(",")[1]);
}

const snapshots = new Map<string, Project>();

function pushChat(m: ChatMessage) {
  const p = state.project!;
  setProject({ ...p, chat: [...p.chat, m] });
}
function patchChat(id: string, patch: Partial<ChatMessage>) {
  const p = state.project!;
  setProject({ ...p, chat: p.chat.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
}

let aborter: AbortController | null = null;
export const cancelAssistant = () => aborter?.abort();

export async function ask(prompt: string, mode: "first_cut" | "edit" = "edit") {
  const p = state.project;
  if (!p || state.assistantBusy) return;
  const health = await api.health();
  if (!health.anthropic) {
    set({ notice: "The AI is not set up on this server yet: add ANTHROPIC_API_KEY in the Vercel project settings (or .env locally)." });
    return;
  }
  const history = p.chat.filter((m) => !m.pending && !m.error).slice(-10).map((m) => ({ role: m.role, text: m.text }));
  if (mode === "edit") pushChat({ id: uid("c"), role: "user", text: prompt, at: new Date().toISOString() });
  const reply: ChatMessage = { id: uid("c"), role: "assistant", text: mode === "first_cut" ? "Reading the transcript and making the first cut…" : "Working on it…", at: new Date().toISOString(), pending: true };
  pushChat(reply);
  set({ assistantBusy: true });
  aborter = new AbortController();
  // Numbered or bulleted text only when the creator asks for it in so many words.
  const asked = mode === "edit" ? prompt : (p.setup?.instructions ?? p.brief);
  const ctx = { playhead: playheadSec(), selectedItemId: state.selectedItem, allowLists: LIST_WORDS.test(asked) };
  try {
    const res = await api.assistant({ mode, prompt, state: describeForAI(state.project!, ctx), frames: await aiFrames(), history }, aborter.signal);
    const here = state.project?.id === p.id;
    const before = here ? state.project! : await db.getProject(p.id);
    if (!before) return;
    const { project: applied, notes, errors } = applyOps(before, res.ops as Op[], ctx);
    const next = mode === "first_cut" && applied.setup ? { ...applied, captions: chosenCaptions(applied.captions, applied.setup) } : applied;
    const fresh = next.items.filter((it): it is AnimationItem => it.type === "animation" && it.status === "placeholder" && !before.items.some((b) => b.id === it.id));
    if (errors.length) console.warn("AI operations skipped:", errors);
    const skipped = errors.length ? [{ op: "skipped", text: `${errors.length} change${errors.length === 1 ? "" : "s"} could not be applied` }] : [];
    const text = res.truncated ? `${res.message}\n\nThe edit was too long to finish in one go; ask me to continue for the rest.` : res.message;
    const done = (chat: ChatMessage[]) => chat.map((m) => (m.id === reply.id ? { ...m, text, pending: false, changes: [...notes, ...skipped], undoable: notes.length > 0 } : m));
    const finished = mode === "first_cut" ? { status: "ready" as const, statusDetail: undefined, summary: res.message } : {};
    if (here) {
      if (notes.length) {
        snapshots.set(reply.id, before);
        set({ past: [...state.past.slice(-149), before], future: [] });
      }
      setProject({ ...next, ...finished, chat: done(before.chat) });
    } else await updateProject(p.id, () => ({ ...next, ...finished, chat: done(before.chat) }));
    // Placeholders the AI just added go to the animation service straight away.
    for (const it of fresh) void generateAnimation(it.id, p.id);
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    const fail = { pending: false, error: !aborted, text: aborted ? "Stopped." : e instanceof Error ? e.message : String(e) };
    await updateProject(p.id, (cur) => ({ ...cur, ...(mode === "first_cut" ? { status: "ready" as const, statusDetail: undefined } : {}), chat: cur.chat.map((m) => (m.id === reply.id ? { ...m, ...fail } : m)) }));
    if (e instanceof ApiError && e.code === "auth") set({ notice: "Your session expired. Reload the page and sign in again." });
  } finally {
    set({ assistantBusy: false });
    aborter = null;
  }
}

export function revertMessage(id: string) {
  const snap = snapshots.get(id);
  if (!snap || !state.project) return;
  commit((d) => Object.assign(d, keepLive(snap, d)));
  patchChat(id, { undoable: false, text: `${state.project.chat.find((m) => m.id === id)?.text ?? ""}` });
  snapshots.delete(id);
}
export const canRevert = (id: string) => snapshots.has(id);

// Import -> transcribe -> AI first cut, resumable.
export async function resume() {
  const p = state.project;
  if (!p?.mainAssetId) return;
  try {
    if (!p.words.length) {
      const ok = await transcribeMain();
      if (!ok) return;
    }
    status({ status: "planning", statusDetail: "AI first cut" });
    await ask(fullBrief(state.project!), "first_cut");
  } catch {
    /* status already shows the error */
  }
}

const LIST_WORDS = /\b(numbers?|numbered|numera\w*|numeri|steps?|passi|list|lista|elenco|bullets?|punti|punto elenco|checklist)\b/i;

// The captions the creator picked during setup win over the first cut's choice.
function chosenCaptions(c: CaptionStyle, s: SetupOptions): CaptionStyle {
  if (!s.captions.enabled) return { ...c, enabled: false };
  if (s.captions.preset && c.preset !== s.captions.preset) return { ...captionPreset(s.captions.preset, c), enabled: true };
  return { ...c, enabled: true };
}

// ---------- animations ----------

const polling = new Set<string>();
export const isPolling = (itemId: string) => polling.has(itemId);
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

function patchAnimation(projectId: string, itemId: string, patch: Partial<AnimationItem>) {
  return updateProject(projectId, (p) => ({ ...p, items: p.items.map((it) => (it.id === itemId && it.type === "animation" ? { ...it, ...patch } : it)) }));
}

// Sends a placeholder to the animation API (or the built-in mock) and waits for the finished file.
export async function generateAnimation(itemId: string, projectId = state.project?.id) {
  const p = projectId === state.project?.id ? state.project : projectId ? await db.getProject(projectId) : null;
  const item = p?.items.find((it): it is AnimationItem => it.id === itemId && it.type === "animation");
  if (!p || !item || polling.has(itemId)) return;
  const f = FORMATS[p.format];
  const full = item.fit === "fullscreen";
  const width = full ? f.width : Math.round((f.width * item.width) / 100);
  const height = full ? f.height : Math.round(width / (item.aspect || 1));
  const t = timelineOf(p);
  const start = itemStart(item, t);
  const said = t.words.filter((w) => w.startMs / 1000 >= start - 0.5 && w.startMs / 1000 <= start + item.duration).map((w) => w.text).join(" ");
  const lead = p.items.find((it): it is TextItem => it.type === "text" && ["hook", "title"].includes(it.preset));
  polling.add(itemId); // counts as in progress from the first request, not just while polling
  await patchAnimation(p.id, itemId, { status: "generating", error: undefined });
  const brief = {
    prompt: item.prompt,
    durationSec: Math.round(item.duration * 100) / 100,
    width,
    height,
    fps: FPS,
    fit: item.fit,
    format: p.format,
    style: lead ? { font: lead.style.font, color: lead.style.color, accentColor: lead.style.accentColor } : undefined,
    context: said,
  };
  if ((await api.health()).animations === "code") return codeAnimation(p.id, itemId, brief);
  try {
    const res = await api.createAnimation({ ...brief, projectId: p.id, layerId: itemId });
    if (res.status === "failed") throw new Error(res.error ?? "The animation service could not make this animation.");
    await patchAnimation(p.id, itemId, { job: { ...res.job, startedAt: new Date().toISOString(), assetId: uid("m") } });
    polling.delete(itemId);
    await pollAnimation(p.id, itemId);
  } catch (e) {
    polling.delete(itemId);
    await patchAnimation(p.id, itemId, { status: "failed", error: e instanceof Error ? e.message : String(e) });
  }
}

type Brief = Omit<Parameters<typeof api.animationCode>[0], "action" | "code" | "error" | "frames">;

// Claude writes the animation as Remotion code; the sandboxed animator checks it runs, Claude looks at stills
// of it once and polishes it, then the animator renders it to a transparent WebM that fills the layer.
async function codeAnimation(projectId: string, itemId: string, brief: Brief) {
  const short = brief.prompt.length > 34 ? `${brief.prompt.slice(0, 32)}…` : brief.prompt;
  const t = task(`Animation: writing “${short}”`);
  const spec: AnimationSpec = { width: brief.width, height: brief.height, fps: brief.fps, durationInFrames: Math.max(1, Math.round(brief.durationSec * brief.fps)), transparent: brief.fit !== "fullscreen" };
  const at = (f: number) => Math.min(spec.durationInFrames - 1, Math.round(spec.durationInFrames * f));
  const stills = [at(0.15), at(0.45), at(0.8)];
  const write = async (action: "write" | "fix" | "review", extra: { code?: string; error?: string; frames?: string[] } = {}) => (await api.animationCode({ action, ...brief, ...extra })).code;
  // Runs the code; on an error, asks for a fix (twice at most). Returns the working code and its stills.
  const runnable = async (code: string): Promise<{ code: string; frames: string[] }> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return { code, frames: await renderAnimationFrames(code, spec, stills) };
      } catch (e) {
        if (!(e instanceof AnimationCodeError) || attempt >= 2) throw e;
        t.progress(null, `Animation: fixing “${short}”`);
        code = (await write("fix", { code, error: e.message })) ?? code;
      }
    }
  };
  try {
    await patchAnimation(projectId, itemId, { job: { id: "code", provider: "code", startedAt: new Date().toISOString(), assetId: uid("m") } });
    let best = await runnable((await write("write"))!);
    t.progress(null, `Animation: reviewing “${short}”`);
    const polished = await write("review", { code: best.code, frames: best.frames }).catch(() => null);
    if (polished) best = await runnable(polished).catch(() => best);
    t.progress(0, `Animation: rendering “${short}”`);
    const video = await renderAnimationVideo(best.code, spec, (x) => t.progress(x));
    const item = (state.project?.id === projectId ? state.project : await db.getProject(projectId))?.items.find((it): it is AnimationItem => it.id === itemId && it.type === "animation");
    if (!item || item.status !== "generating") return; // deleted, or replaced by a file meanwhile
    await attachAnimation(projectId, itemId, new File([video], "animation.webm", { type: "video/webm" }), { id: item.job?.assetId, name: `Animation · ${brief.prompt.slice(0, 40)}` });
    // The code has its own entrance and exit; the layer's pop and fade on top would double them.
    await patchAnimation(projectId, itemId, { code: best.code, animIn: "none", animOut: "none" });
  } catch (e) {
    await patchAnimation(projectId, itemId, { status: "failed", job: undefined, error: e instanceof Error ? e.message : String(e) });
  } finally {
    t.done();
    polling.delete(itemId);
  }
}

export async function pollAnimation(projectId: string, itemId: string) {
  if (polling.has(itemId)) return;
  polling.add(itemId);
  try {
    for (let tries = 0; ; tries++) {
      // Stop when the project is closed; opening it again picks the job up.
      if (state.project?.id !== projectId) return;
      const item = state.project.items.find((it): it is AnimationItem => it.id === itemId && it.type === "animation");
      if (!item?.job || item.status !== "generating") return;
      if (Date.now() - Date.parse(item.job.startedAt) > 15 * 60_000) throw new Error("The animation service did not finish within 15 minutes.");
      await sleep(tries === 0 ? 1500 : 2500);
      const res = await api.pollAnimation(item.job, projectId, item.job.assetId).catch((e) => {
        if (e instanceof ApiError && (e.code === "timeout" || e.code === "offline" || e.code === "502")) return { status: "processing" as const };
        throw e;
      });
      if (res.status === "failed") throw new Error(res.error ?? "The animation service could not make this animation.");
      if (res.status !== "ready") continue;
      const where = res.path ?? res.url;
      if (!where) throw new Error("The animation service sent no file.");
      const blob = await cloudApi.downloadMedia(where, () => {});
      await attachAnimation(projectId, itemId, blob, { id: item.job.assetId, name: `Animation · ${item.prompt.slice(0, 40)}`, cloud: res.path ?? (where.startsWith("/") ? where : undefined) });
      return;
    }
  } catch (e) {
    await patchAnimation(projectId, itemId, { status: "failed", error: e instanceof Error ? e.message : String(e) });
  } finally {
    polling.delete(itemId);
  }
}

// A finished animation (from the service, or a file the creator drops on the placeholder) fills the layer.
export async function attachAnimation(projectId: string, itemId: string, blob: Blob, meta: { id?: string; name: string; cloud?: string }) {
  const kind = blob.type.startsWith("image/") ? "image" : "video";
  const info = await probe(blob, kind);
  const asset: MediaAsset = { id: meta.id ?? uid("m"), name: meta.name, kind, durationSec: info.durationSec, width: info.width, height: info.height, hasAudio: info.hasAudio, size: blob.size, role: "animation", ...(meta.cloud ? { cloud: meta.cloud } : {}) };
  await db.putMedia(asset.id, blob);
  if (state.project?.id === projectId) set((s) => ({ media: { ...s.media, [asset.id]: URL.createObjectURL(blob) } }));
  await updateProject(projectId, (p) => ({
    ...p,
    assets: [...p.assets.filter((a) => a.id !== asset.id), asset],
    items: p.items.map((it) =>
      it.id === itemId && it.type === "animation"
        ? { ...it, assetId: asset.id, status: "ready" as const, job: undefined, error: undefined, aspect: asset.width && asset.height ? asset.width / asset.height : it.aspect, duration: asset.kind === "video" && asset.durationSec ? Math.min(it.duration, asset.durationSec) : it.duration }
        : it,
    ),
  }));
  if (cloud.on && !asset.cloud) void backUp(projectId, asset);
}

// ---------- creating ----------

// A project starts in setup: the creator adds the video and picks the options, then the first cut runs.
export async function createProject(opts: { name: string; format: FormatId }) {
  const p = newProject(uid("p"), opts.name, "", opts.format);
  p.status = "setup";
  p.setup = structuredClone(DEFAULT_SETUP);
  await db.putProject(p);
  if (cloud.on) void cloudApi.saveProject(p).catch(() => {});
  return p;
}

// A ready-made sample so a tester can try everything without uploading.
export async function createSample(format: FormatId = "9:16") {
  const p = newProject(uid("p"), "Sample: three ways to edit faster", "Punchy edit for Reels. Cut the mistakes and repeats, add a hook title, bold captions with key words, a couple of punch-in zooms and a warm, clean look.", format);
  const [video, words] = await Promise.all([fetch("/sample/talking.mp4").then((r) => r.blob()), fetch("/sample/talking.words.json").then((r) => r.json() as Promise<{ text: string; start: number; end: number }[]>)]);
  const file = new File([video], "talking.mp4", { type: "video/mp4" });
  const info = await probe(file, "video");
  const asset: MediaAsset = { id: uid("m"), name: "talking", kind: "video", durationSec: info.durationSec, width: info.width, height: info.height, hasAudio: info.hasAudio, size: file.size, cloud: "/sample/talking.mp4" };
  await db.putMedia(asset.id, file);
  p.assets = [asset];
  p.mainAssetId = asset.id;
  p.words = words.map((w, i) => ({ id: `w${i}`, ...w, kind: "word" as const }));
  p.status = "ready";
  // A pre-made edit built with the same operations the AI calls, so the sample works without API keys.
  const ops: Op[] = [
    { name: "cut_words", input: { from_word: "w0", to_word: "w5", reason: "retake" } },
    { name: "cut_words", input: { from_word: "w23", to_word: "w23", reason: "filler" } },
    { name: "cut_words", input: { from_word: "w44", to_word: "w46", reason: "retake" } },
    { name: "set_pacing", input: { max_pause_sec: 0.25 } },
    { name: "set_key_words", input: { add: ["w13", "w18", "w27", "w35", "w57"] } },
    { name: "set_captions", input: { preset: "bold-pop", y: 74 } },
    { name: "set_color", input: { temperature: 12, contrast: 14, vibrance: 18, look: "warm-film", look_intensity: 45, vignette: 18 } },
    { name: "add_text", input: { text: "3 ways to edit *faster*", preset: "hook", start_word: "w6", duration_sec: 2.3, anim_in: "pop", sfx: "whoosh" } },
    { name: "add_zoom", input: { start_word: "w6", duration_sec: 2.3, scale: 1.12, style: "push", focus_y: 40 } },
    { name: "add_zoom", input: { start_word: "w25", end_word: "w28", scale: 1.2, style: "punch" } },
    { name: "add_text", input: { text: "AI picks the *key words*", preset: "callout", start_word: "w36", duration_sec: 1.6, y: 30 } },
    { name: "add_zoom", input: { start_word: "w52", end_word: "w57", scale: 1.25, style: "smooth" } },
    { name: "add_transition", input: { kind: "whip", at_word: "w43", duration_sec: 0.3 } },
    { name: "add_sfx", input: { sound: "whoosh", on: "transitions", volume_db: -8 } },
    { name: "add_graphic", input: { shape: "progress", color: "#FFE14D", color2: "#FFFFFF" } },
  ];
  const { project: edited, notes } = applyOps(p, ops, { playhead: 0 });
  edited.chat = [
    {
      id: uid("c"),
      role: "assistant",
      at: new Date().toISOString(),
      text: "This sample was edited with the same operations the AI uses: the false start and the repeated take are cut, pauses are tightened, and it has a hook, a callout, punch-in zooms, captions with key words and a warm grade. Ask for any change below, or edit it by hand.",
      changes: notes,
    },
  ];
  await db.putProject(edited);
  if (cloud.on) await cloudApi.saveProject(edited).catch(() => {});
  return edited;
}

// ---------- small helpers used by panels ----------

export const selectedItem = (s: EditorState): Item | null => s.project?.items.find((i) => i.id === s.selectedItem) ?? null;

export function placedNow(s: EditorState) {
  if (!s.project || !s.timeline) return [];
  return placeItems(s.project.items, s.timeline);
}

export const totalSec = (s: EditorState) => (s.timeline ? durationSec(s.timeline) : 0);
export const sfxIds = (): SfxId[] => Object.keys(state.sfx) as SfxId[];
