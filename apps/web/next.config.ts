import dotenv from "dotenv";
import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load project-root .env so apps/web shares env with apps/ws (single source
// of truth). Next.js's own .env loader points at apps/web/, which we don't
// use. Override:false means apps/web/.env(.local) still wins if present.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../../.env"), override: false });

const nextConfig: NextConfig = {
  transpilePackages: ["@piepad/db"],
  // Self-contained server bundle for Docker — copies only the runtime deps
  // each route actually uses, so the production image stays slim.
  output: "standalone",
  // Monorepo: tracing must walk up to the workspace root to pick up shared
  // packages (@piepad/db) and the right node_modules layout.
  outputFileTracingRoot: path.resolve(here, "../../"),
  // 127.0.0.1 is what Playwright (and our Piston/ws-internal) use to dodge
  // Node 17+'s IPv6-first localhost resolution; Next 16 dev rejects it
  // unless we list it explicitly.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
