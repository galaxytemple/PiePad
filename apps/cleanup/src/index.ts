import "./env.js";
import { closePool } from "@piepad/db";
import cron from "node-cron";
import { runCleanupOnce } from "./cleanup.js";

const SCHEDULE = process.env.CLEANUP_CRON ?? "0 3 * * *"; // 03:00 UTC daily
const RUN_ON_START = process.env.CLEANUP_RUN_ON_START !== "false";

if (!cron.validate(SCHEDULE)) {
  console.error(`[cleanup] invalid CLEANUP_CRON expression: ${SCHEDULE}`);
  process.exit(1);
}

console.log(`piepad-cleanup scheduled for ${SCHEDULE} (UTC)`);

let inFlight = false;
async function tick(reason: string): Promise<void> {
  if (inFlight) {
    console.warn(`[cleanup] ${reason} skipped — previous run still active`);
    return;
  }
  inFlight = true;
  try {
    console.log(`[cleanup] starting (${reason})`);
    await runCleanupOnce();
  } catch (err) {
    console.error("[cleanup] tick failed:", err);
  } finally {
    inFlight = false;
  }
}

const job = cron.schedule(SCHEDULE, () => void tick("scheduled"), {
  scheduled: true,
  timezone: "UTC",
});

if (RUN_ON_START) {
  // Catch-up pass on boot covers gaps if the container was down for a
  // scheduled tick.
  void tick("startup");
}

let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`piepad-cleanup received ${signal}, shutting down`);
  job.stop();
  await closePool().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
