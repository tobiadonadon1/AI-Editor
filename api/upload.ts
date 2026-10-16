import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { authorize, hasStorage, json, ownMediaPath, readJson } from "./_lib/server.js";

// Media goes from the browser straight to Vercel Blob (no 4.5 MB function limit);
// this route only hands out a short-lived token for one path inside the user's own folder.
export async function POST(req: Request) {
  if (!hasStorage()) return json({ error: "Cloud storage is not set up on this server.", code: "storage" }, 503);
  const user = await authorize(req);
  if (user instanceof Response) return user;
  const body = await readJson<HandleUploadBody>(req);
  if (body?.type !== "blob.generate-client-token") return json({ error: "Unexpected upload event" }, 400);
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!ownMediaPath(user.userId, pathname)) throw new Error("That path is outside your storage.");
        return {
          allowedContentTypes: ["video/*", "audio/*", "image/*", "application/octet-stream"],
          // The cloud copy is the edit proxy, so even long recordings stay well under this.
          maximumSizeInBytes: 2 * 1024 ** 3,
          allowOverwrite: true,
          addRandomSuffix: false,
          validUntil: Date.now() + 2 * 3600_000,
        };
      },
    });
    return json(result);
  } catch (e) {
    console.error("upload token", e);
    return json({ error: e instanceof Error && e.message.includes("outside your storage") ? e.message : "Could not start the upload." }, 400);
  }
}
