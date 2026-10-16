// End-to-end check of accounts + cloud storage against the real services, with a temporary Clerk test user.
// Run with the dev server up and .env.local loaded:  set -a; source .env.local; set +a; npx tsx scripts/cloud-e2e.mts
import { upload } from "@vercel/blob/client";
const CK = process.env.CLERK_SECRET_KEY!;
const B = process.env.BASE_URL ?? "http://localhost:5173";
const clerk = async (path: string, body?: unknown, method = "POST") => {
  const r = await fetch(`https://api.clerk.com/v1${path}`, { method, headers: { Authorization: `Bearer ${CK}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (!r.ok) throw new Error(path + " " + JSON.stringify(j)); return j;
};
const user = await clerk("/users", { email_address: [`e2e+clerk_test@example.com`], skip_password_requirement: true });
console.log("user", user.id);
try {
  const session = await clerk("/sessions", { user_id: user.id });
  const { jwt } = await clerk(`/sessions/${session.id}/tokens`, {});
  const H = { Authorization: `Bearer ${jwt}` };
  console.log("no token:", (await fetch(`${B}/api/projects`)).status);
  console.log("list:", (await fetch(`${B}/api/projects`, { headers: H })).status);
  const path = `u/${user.id}/media/p-e2e/m1.mp4`;
  const bad = await fetch(`${B}/api/media`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ paths: ["u/someoneelse/x.mp4"] }) });
  console.log("other user's media:", bad.status);
  const bytes = new Uint8Array(3_000_000).map((_, i) => i % 251);
  const res = await upload(path, new Blob([bytes], { type: "video/mp4" }), { access: "private", handleUploadUrl: `${B}/api/upload`, headers: H, contentType: "video/mp4" });
  console.log("uploaded", res.pathname);
  const { urls } = await (await fetch(`${B}/api/media`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ paths: [path] }) })).json();
  const dl = new Uint8Array(await (await fetch(urls[path])).arrayBuffer());
  console.log("download matches:", dl.length === bytes.length && dl.every((v, i) => v === bytes[i]));
  const project = { id: "p-e2e", name: "E2E", format: "9:16", updatedAt: new Date().toISOString(), assets: [] };
  const put = await fetch(`${B}/api/projects?id=p-e2e`, { method: "PUT", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ project, summary: { id: "p-e2e", name: "E2E", format: "9:16", updatedAt: project.updatedAt, durationSec: 12.5 } }) });
  console.log("save:", put.status, (await put.text()).slice(0, 160));
  // An older copy (a device that was offline) must not overwrite the newer one.
  const stale = { ...project, updatedAt: new Date(Date.now() - 60_000).toISOString() };
  const old = await fetch(`${B}/api/projects?id=p-e2e`, { method: "PUT", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ project: stale, summary: { id: "p-e2e", name: "E2E", format: "9:16", updatedAt: stale.updatedAt, durationSec: 12.5 } }) });
  console.log("stale save refused:", old.status === 409, old.status);
  const outside = await fetch(`${B}/api/upload`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ type: "blob.generate-client-token", payload: { pathname: path.replace("/media/", "/other/"), callbackUrl: "", clientPayload: null, multipart: false } }) });
  console.log("upload outside media/ refused:", outside.status === 400, outside.status);
  const list = await fetch(`${B}/api/projects`, { headers: H });
  console.log("list:", list.status, (await list.text()).slice(0, 200));
  const one = await fetch(`${B}/api/projects?id=p-e2e`, { headers: H });
  console.log("get:", one.status, (await one.text()).slice(0, 120));
  const delr = await fetch(`${B}/api/projects?id=p-e2e`, { method: "DELETE", headers: H });
  console.log("delete:", delr.status, (await delr.text()).slice(0, 120));
  const after = await fetch(urls[path] + "&cache=0");
  console.log("media after delete:", after.status);
} finally {
  await clerk(`/users/${user.id}`, undefined, "DELETE");
  console.log("test user deleted");
}
