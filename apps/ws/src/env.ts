import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Side-effect import: must run before any module that reads process.env at
// evaluation time (notably @piepad/db which builds Oracle config eagerly).
const here = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(here, "../../../.env");
dotenv.config({ path: rootEnv, quiet: true });
