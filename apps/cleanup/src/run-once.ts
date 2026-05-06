import "./env.js";
import { closePool } from "@piepad/db";
import { runCleanupOnce } from "./cleanup.js";

async function main(): Promise<void> {
  try {
    const summary = await runCleanupOnce();
    process.exitCode = summary.failed > 0 ? 1 : 0;
  } catch (err) {
    console.error("[cleanup] fatal", err);
    process.exitCode = 2;
  } finally {
    await closePool().catch(() => {});
  }
}

void main();
