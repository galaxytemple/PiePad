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
};

export default nextConfig;
