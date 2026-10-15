import Anthropic from "@anthropic-ai/sdk";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// Optional shared password for a public deployment, so a link cannot run up the API bill.
export function checkAccess(req: Request): Response | null {
  const code = process.env.APP_ACCESS_CODE;
  if (!code) return null;
  if (req.headers.get("x-access-code") === code) return null;
  return json({ error: "This editor needs the access code.", code: "access" }, 401);
}

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
