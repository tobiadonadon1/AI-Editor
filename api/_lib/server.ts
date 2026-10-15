import Anthropic from "@anthropic-ai/sdk";
import { verifyToken } from "@clerk/backend";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const hasAuth = () => Boolean(process.env.CLERK_SECRET_KEY);
export const hasStorage = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
export const hasDatabase = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);

// Every API call carries the Clerk session token. Without Clerk configured (local dev) everyone is "local".
export async function authorize(req: Request): Promise<{ userId: string } | Response> {
  if (!hasAuth()) return { userId: "local" };
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return json({ error: "Sign in to use the editor.", code: "auth" }, 401);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  // Browser sessions name the site they were issued for (azp) and must match this one. Tokens minted with
  // the secret key through Clerk's backend API (scripts, tests) carry no azp.
  const azp = (() => {
    try {
      return Boolean(JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).azp);
    } catch {
      return true;
    }
  })();
  try {
    const claims = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY, authorizedParties: azp && host ? [`${proto}://${host}`] : undefined });
    return { userId: claims.sub };
  } catch {
    return json({ error: "Your session expired. Sign in again.", code: "auth" }, 401);
  }
}

// Each user's files live under their own prefix; paths from the browser must stay inside it.
export const userPrefix = (userId: string) => `u/${userId.replace(/[^a-zA-Z0-9_-]/g, "")}/`;
export const ownPath = (userId: string, path: unknown): path is string =>
  typeof path === "string" && path.startsWith(userPrefix(userId)) && !path.includes("..") && path.length < 400;

const gatewayToken = (req?: Request) => process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || req?.headers.get("x-vercel-oidc-token") || "";

// Claude directly with ANTHROPIC_API_KEY, or through Vercel AI Gateway when only that is set up.
export function claude(req?: Request): { client: Anthropic; model: string; direct: boolean } | null {
  if (process.env.ANTHROPIC_API_KEY) {
    return { client: new Anthropic(), model: "claude-opus-5-5", direct: true };
  }
  if (process.env.USE_AI_GATEWAY && gatewayToken(req)) {
    return {
      client: new Anthropic({ apiKey: gatewayToken(req), baseURL: "https://ai-gateway.vercel.sh" }),
      model: "anthropic/claude-opus-5.5",
      direct: false,
    };
  }
  return null;
}

export const hasTranscription = () => Boolean(process.env.ELEVENLABS_API_KEY);
