import { del, list } from "@vercel/blob";
import { createClient } from "@supabase/supabase-js";
import { authorize, hasDatabase, hasStorage, json, readJson, userPrefix } from "./_lib/server.js";

// Projects live in Supabase (table public.projects, see supabase/migrations); their media in Vercel Blob
// under u/<user>/media/<project>/. Only this server touches the table, always filtered to the signed-in user.

interface Summary {
  id: string;
  name: string;
  format: string;
  updatedAt: string;
  durationSec: number;
}

const validId = (id: string | null): id is string => !!id && /^[a-z0-9_-]{1,64}$/i.test(id);
const db = () => createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

async function session(req: Request) {
  if (!hasDatabase()) return json({ error: "The project database is not set up on this server (SUPABASE_URL, SUPABASE_SECRET_KEY).", code: "storage" }, 503);
  const user = await authorize(req);
  if (user instanceof Response) return user;
  return { userId: user.userId, id: new URL(req.url).searchParams.get("id") };
}

const failed = (what: string, e: { message: string }) => {
  console.error(what, e.message);
  return json({ error: `Could not ${what}. Try again in a moment.` }, 502);
};

export async function GET(req: Request) {
  const s = await session(req);
  if (s instanceof Response) return s;
  if (s.id) {
    if (!validId(s.id)) return json({ error: "Bad project id" }, 400);
    const { data, error } = await db().from("projects").select("data").eq("user_id", s.userId).eq("id", s.id).maybeSingle();
    if (error) return failed("load the project", error);
    return data ? json(data.data) : json({ error: "Project not found" }, 404);
  }
  const { data, error } = await db().from("projects").select("id, name, format, duration_sec, updated_at").eq("user_id", s.userId).order("updated_at", { ascending: false }).limit(500);
  if (error) return failed("list projects", error);
  return json(data.map((r): Summary => ({ id: r.id, name: r.name, format: r.format, durationSec: r.duration_sec, updatedAt: new Date(r.updated_at).toISOString() })));
}

export async function PUT(req: Request) {
  const s = await session(req);
  if (s instanceof Response) return s;
  if (!validId(s.id)) return json({ error: "Bad project id" }, 400);
  const body = await readJson<{ project?: { id?: string }; summary?: Summary }>(req);
  if (!body?.project || body.project.id !== s.id || !body.summary) return json({ error: "Expected { project, summary }" }, 400);
  const { name, format, durationSec, updatedAt } = body.summary;
  if (typeof updatedAt !== "string" || Number.isNaN(Date.parse(updatedAt))) return json({ error: "Bad updatedAt" }, 400);
  // Never replace a newer copy (saved from another device) with an older one.
  const current = await db().from("projects").select("updated_at").eq("user_id", s.userId).eq("id", s.id).maybeSingle();
  if (current.error) return failed("save the project", current.error);
  if (current.data && Date.parse(current.data.updated_at) > Date.parse(updatedAt))
    return json({ error: "A newer version of this project was saved from another device.", code: "conflict" }, 409);
  const { error } = await db()
    .from("projects")
    .upsert({ user_id: s.userId, id: s.id, name, format, duration_sec: durationSec, updated_at: updatedAt, data: body.project }, { onConflict: "user_id,id" });
  return error ? failed("save the project", error) : json({ ok: true });
}

export async function DELETE(req: Request) {
  const s = await session(req);
  if (s instanceof Response) return s;
  if (!validId(s.id)) return json({ error: "Bad project id" }, 400);
  if (hasStorage()) {
    const paths: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: `${userPrefix(s.userId)}media/${s.id}/`, cursor });
      paths.push(...page.blobs.map((b) => b.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    if (paths.length) await del(paths);
  }
  const { error } = await db().from("projects").delete().eq("user_id", s.userId).eq("id", s.id);
  return error ? failed("delete the project", error) : json({ ok: true });
}
