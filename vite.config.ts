import path from "node:path";
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

const noAuth = Boolean(process.env.NO_AUTH);

// In development the same files Vercel deploys as functions (api/*.ts) answer /api/* here.
function localApi(): Plugin {
  return {
    name: "local-api",
    configureServer(server: ViteDevServer) {
      Object.assign(process.env, loadEnv("development", process.cwd(), ""));
      // NO_AUTH=1 npm run dev: no accounts, everything saved as the user "local" (for testing the cloud sync).
      if (noAuth) delete process.env.CLERK_SECRET_KEY;
      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/api\/([a-z-]+)/);
        if (!match) return next();
        try {
          const mod = await server.ssrLoadModule(path.resolve(process.cwd(), `api/${match[1]}.ts`));
          const handler = mod[req.method ?? "GET"];
          if (typeof handler !== "function") {
            res.statusCode = 405;
            return res.end();
          }
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          const request = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
          });
          const response: Response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          console.error(e);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
      });
    },
  };
}

// The animator page (web/animator.html) runs in an opaque-origin sandbox, so its scripts load cross-origin:
// they need CORS (vercel.json sets it for production), and in development Vite's own inline scripts and
// live-reload socket need its content policy relaxed.
function animatorDev(): Plugin {
  return {
    name: "animator-dev",
    apply: "serve",
    transformIndexHtml(html, ctx) {
      if (!ctx.path.endsWith("animator.html")) return html;
      return html.replace("script-src 'self' 'unsafe-eval'", "script-src 'self' 'unsafe-eval' 'unsafe-inline' http://localhost:*").replace("connect-src ", "connect-src ws://localhost:* http://localhost:* ");
    },
  };
}

export default defineConfig({
  root: "web",
  // .env files sit at the repo root; only the Clerk publishable key (Vercel provisions it as NEXT_PUBLIC_*) reaches the browser.
  envDir: process.cwd(),
  envPrefix: noAuth ? ["VITE_"] : ["VITE_", "NEXT_PUBLIC_CLERK_"],
  plugins: [react(), localApi(), animatorDev()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: { main: path.resolve("web/index.html"), animator: path.resolve("web/animator.html") } },
  },
  server: { port: 5173, cors: { origin: [/^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/, "null"] } },
});
