import { issueSignedToken, presignUrl } from "@vercel/blob";
import { authorize, hasStorage, json, ownPath } from "./_lib/server.js";

// Short-lived download links for the user's own private media, so the browser can fetch large files directly.
export async function POST(req: Request) {
  if (!hasStorage()) return json({ error: "Cloud storage is not set up on this server.", code: "storage" }, 503);
  const user = await authorize(req);
  if (user instanceof Response) return user;
  const body = (await req.json().catch(() => null)) as { paths?: unknown[] } | null;
  const paths = (body?.paths ?? []).slice(0, 50);
  if (!paths.every((p) => ownPath(user.userId, p))) return json({ error: "That file is not yours." }, 403);
  const validUntil = Date.now() + 6 * 3600_000;
  const urls: Record<string, string> = {};
  await Promise.all(
    (paths as string[]).map(async (pathname) => {
      const token = await issueSignedToken({ pathname, operations: ["get"], validUntil });
      urls[pathname] = (await presignUrl(token, { operation: "get", pathname, access: "private" })).presignedUrl;
    }),
  );
  return json({ urls });
}
