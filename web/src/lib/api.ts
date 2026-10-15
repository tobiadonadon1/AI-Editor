import type { Op } from "../../../src/shared/ops";
import type { Word } from "../../../src/shared/project";

import { getToken } from "@clerk/react";

// Set once at startup: with Clerk configured every call carries the session token.
export const auth = { enabled: false };

export async function authHeaders(): Promise<Record<string, string>> {
  if (!auth.enabled) return {};
  const token = await getToken().catch(() => null);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class ApiError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(init.headers ?? {}), ...(await authHeaders()) } }).catch((e) => {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("Could not reach the server. Check the connection and try again.");
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, body.code);
  return body as T;
}

export interface Health {
  anthropic: boolean;
  elevenlabs: boolean;
  auth: boolean;
  storage: boolean;
}

let health: Promise<Health> | null = null;
export const api = {
  health: (fresh = false) => {
    if (fresh || !health) health = call<Health>("/api/health").catch(() => ({ anthropic: false, elevenlabs: false, auth: false, storage: false }));
    return health;
  },
  transcribeChunk: (blob: Blob) =>
    call<{ language: string; words: Omit<Word, "id">[] }>("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: blob }),
  assistant: (body: { mode: "first_cut" | "edit"; prompt: string; state: string; frames?: string[]; history?: { role: "user" | "assistant"; text: string }[] }, signal?: AbortSignal) =>
    call<{ message: string; ops: Op[]; truncated?: boolean }>("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal }),
};
