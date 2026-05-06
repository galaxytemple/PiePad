"use client";

import { useEffect, useState } from "react";

// Personal stopwatch — each viewer has their own clock. Not synced via Yjs;
// for an interview-style shared timer we'd want a Y.Map entry, but per-user
// is the saner default.

const RESET_CONFIRM_MS = 3000;

export function Stopwatch() {
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [accumulated, setAccumulated] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [resetArmed, setResetArmed] = useState(false);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  // Auto-disarm reset confirmation after 3s of inaction.
  useEffect(() => {
    if (!resetArmed) return;
    const id = setTimeout(() => setResetArmed(false), RESET_CONFIRM_MS);
    return () => clearTimeout(id);
  }, [resetArmed]);

  const elapsedMs =
    running && startedAt !== null ? accumulated + (now - startedAt) : accumulated;

  const toggle = () => {
    setResetArmed(false);
    if (running) {
      setAccumulated(elapsedMs);
      setStartedAt(null);
      setRunning(false);
    } else {
      setStartedAt(Date.now());
      setNow(Date.now());
      setRunning(true);
    }
  };

  const handleResetClick = () => {
    if (elapsedMs === 0 && !running) return;
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setRunning(false);
    setStartedAt(null);
    setAccumulated(0);
    setResetArmed(false);
  };

  const resetDisabled = elapsedMs === 0 && !running;

  return (
    <div className="flex items-center gap-1 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800">
      <span className="font-mono text-sm tabular-nums">
        {formatTime(elapsedMs)}
      </span>
      <button
        type="button"
        onClick={toggle}
        aria-label={running ? "Pause" : "Start"}
        className="rounded px-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700"
      >
        {running ? "⏸" : "▶"}
      </button>
      <button
        type="button"
        onClick={handleResetClick}
        aria-label={resetArmed ? "Confirm reset" : "Reset"}
        disabled={resetDisabled}
        className={`rounded px-1.5 text-xs transition-colors disabled:opacity-30 ${
          resetArmed
            ? "bg-red-500 text-white hover:bg-red-600"
            : "hover:bg-zinc-100 dark:hover:bg-zinc-700"
        }`}
        title={
          resetArmed ? "Click again to confirm reset" : "Click to reset"
        }
      >
        {resetArmed ? "Sure?" : "↺"}
      </button>
    </div>
  );
}

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}
