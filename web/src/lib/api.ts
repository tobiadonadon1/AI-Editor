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

// Every call gives up after `timeoutMs` (the AI gets longer), so nothing waits forever on a stuck request.
export async function call<T>(path: string, init: RequestInit & { timeoutMs?: number; anonymous?: boolean } = {}): Promise<T> {
  const { timeoutMs = 30000, anonymous, ...rest } = init;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = rest.signal ? AbortSignal.any([rest.signal, timeout]) : timeout;
  const headers = { ...(rest.headers ?? {}), ...(anonymous ? {} : await authHeaders()) };
  const res = await fetch(path, { ...rest, headers, signal }).catch((e) => {
    if (rest.signal?.aborted) throw e;
    if (timeout.aborted) throw new ApiError("The server took too long to answer. Try again.", "timeout");
    throw new ApiError("Could not reach the server. Check the connection and try again.", "offline");
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, body.code ?? String(res.status));
  return body as T;
}

export interface Health {
  anthropic: boolean;
  elevenlabs: boolean;
  auth: boolean;
  storage: boolean;
  unreachable?: boolean; // the health check itself failed
}

let health: Promise<Health> | null = null;
export const api = {
  health: (fresh = false) => {
    if (fresh || !health)
      health = call<Health>("/api/health", { anonymous: true, timeoutMs: 8000 }).catch(() => ({ anthropic: false, elevenlabs: false, auth: false, storage: false, unreachable: true }));
    return health;
  },
  transcribeChunk: (blob: Blob, language?: string) =>
    call<{ language: string; words: Omit<Word, "id">[] }>(`/api/transcribe${language ? `?language=${encodeURIComponent(language)}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: blob,
      timeoutMs: 125000,
    }),
  assistant: (body: { mode: "first_cut" | "edit"; prompt: string; state: string; frames?: string[]; history?: { role: "user" | "assistant"; text: string }[] }, signal?: AbortSignal) =>
    call<{ message: string; ops: Op[]; truncated?: boolean }>("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal, timeoutMs: 305000 }),
};
