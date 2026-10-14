import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { pipeline as pipe } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import type { Edit } from "../shared/project";
import { createProject, list, load, projectFile, update } from "./storage";
import { analyze, isBusy, render, replan } from "./pipeline";

const PORT = Number(process.env.PORT ?? 8787);
const ORIGIN = `http://127.0.0.1:${PORT}`;

const app = new Hono();

app.get("/api/health", (c) =>
  c.json({
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
  }),
);

app.get("/api/projects", async (c) => c.json(await list()));

app.post("/api/projects", async (c) => {
  const body = await c.req.json<{ brief?: string; name?: string }>();
  return c.json(await createProject(body.brief ?? "", body.name ?? ""));
});

app.get("/api/projects/:id", async (c) => {
  const project = await load(c.req.param("id"));
  return project ? c.json(project) : c.json({ error: "Not found" }, 404);
});

// Manual changes from the editor: brief, name and edit decisions.
app.patch("/api/projects/:id", async (c) => {
  const body = await c.req.json<{ brief?: string; name?: string; edit?: Edit }>();
  const project = await update(c.req.param("id"), (p) => {
    if (typeof body.brief === "string") p.brief = body.brief;
    if (typeof body.name === "string") p.name = body.name;
    if (body.edit) {
      p.edit = body.edit;
      if (p.render.status === "done") p.render.stale = true;
    }
  });
  return c.json(project);
});

// The video is sent as the raw request body and streamed to disk.
app.put("/api/projects/:id/source", async (c) => {
  const id = c.req.param("id");
  if (!(await load(id))) return c.json({ error: "Not found" }, 404);
  const name = c.req.query("name") ?? "video";
  const ext = path.extname(name).toLowerCase() || ".mp4";
  const original = projectFile(id, `original${ext}`);
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "No file received" }, 400);
  await pipe(Readable.fromWeb(body as never), createWriteStream(original));
  const project = await update(id, (p) => {
    p.source = { originalName: name, width: 0, height: 0, durationSec: 0 };
    p.status = "preparing";
    p.statusDetail = "Preparing the footage";
    p.error = undefined;
  });
  void analyze(id, original);
  return c.json(project);
});

// Retry from the start (e.g. after adding an API key) or re-plan with a new brief.
app.post("/api/projects/:id/analyze", async (c) => {
  const id = c.req.param("id");
  const project = await load(id);
  if (!project?.source) return c.json({ error: "Upload a video first" }, 400);
  if (isBusy(id)) return c.json({ error: "Already working on this project" }, 409);
  const original = path.join(
    path.dirname(projectFile(id, "x")),
    `original${path.extname(project.source.originalName).toLowerCase() || ".mp4"}`,
  );
  void analyze(id, original);
  return c.json({ ok: true });
});

app.post("/api/projects/:id/replan", async (c) => {
  const id = c.req.param("id");
  if (isBusy(id)) return c.json({ error: "Already working on this project" }, 409);
  void replan(id);
  return c.json({ ok: true });
});

app.post("/api/projects/:id/render", async (c) => {
  const id = c.req.param("id");
  const project = await load(id);
  if (!project || project.status !== "ready") return c.json({ error: "Project is not ready" }, 400);
  void render(id, ORIGIN);
  return c.json({ ok: true });
});

// Media with byte ranges and CORS, so the browser player and the renderer can seek.
app.use("/media/*", cors());
app.get("/media/:id/:file", (c) => {
  const file = c.req.param("file");
  if (!["proxy.mp4", "export.mp4"].includes(file)) return c.notFound();
  const full = projectFile(c.req.param("id"), file);
  if (!existsSync(full)) return c.notFound();
  const size = statSync(full).size;
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  };
  if (c.req.query("download") !== undefined) {
    headers["Content-Disposition"] = `attachment; filename="edit-${c.req.param("id")}.mp4"`;
  }
  const range = c.req.header("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return c.body(null, 416, { "Content-Range": `bytes */${size}` });
    }
    const stream = Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream;
    return c.body(stream, 206, {
      ...headers,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
    });
  }
  const stream = Readable.toWeb(createReadStream(full)) as ReadableStream;
  return c.body(stream, 200, { ...headers, "Content-Length": String(size) });
});

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, () => {
  console.log(`AI Editor server on ${ORIGIN}`);
});
