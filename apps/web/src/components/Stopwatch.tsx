"use client";

import { useEffect, useState } from "react";

// Personal stopwatch — each viewer has their own clock. Not synced via Yjs;
// for an interview-style shared timer we'd want a Y.Map entry, but per-user
// is the saner default.

export function Stopwatch() {
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [accumulated, setAccumulated] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  const elapsedMs =
    running && startedAt !== null ? accumulated + (now - startedAt) : accumulated;

  const toggle = () => {
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

  const reset = () => {
    setRunning(false);
    setStartedAt(null);
    setAccumulated(0);
  };

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
        onClick={reset}
        aria-label="Reset"
        disabled={elapsedMs === 0 && !running}
        className="rounded px-1 text-xs hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-700"
      >
        ↺
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
