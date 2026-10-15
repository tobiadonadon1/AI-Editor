import type { Op } from "../../../src/shared/ops";
import type { Word } from "../../../src/shared/project";

const CODE_KEY = "ai-editor:access-code";
export const accessCode = {
  get: () => {
    try {
      return localStorage.getItem(CODE_KEY) ?? "";
    } catch {
      return "";
    }
  },
  set: (v: string) => {
    try {
      localStorage.setItem(CODE_KEY, v);
    } catch {
      /* private mode */
    }
  },
};

export class ApiError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(init.headers ?? {}), "x-access-code": accessCode.get() } }).catch(() => {
    throw new ApiError("Could not reach the server. Check the connection and try again.");
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, body.code);
  return body as T;
}

export interface Health {
  anthropic: boolean;
  elevenlabs: boolean;
  accessCode: boolean;
}

let health: Promise<Health> | null = null;
export const api = {
  health: (fresh = false) => {
    if (fresh || !health) health = call<Health>("/api/health").catch(() => ({ anthropic: false, elevenlabs: false, accessCode: false }));
    return health;
  },
  transcribeChunk: (blob: Blob) =>
    call<{ language: string; words: Omit<Word, "id">[] }>("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: blob }),
  assistant: (body: { mode: "first_cut" | "edit"; prompt: string; state: string; frames?: string[]; history?: { role: "user" | "assistant"; text: string }[] }, signal?: AbortSignal) =>
    call<{ message: string; ops: Op[]; truncated?: boolean }>("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal }),
};
