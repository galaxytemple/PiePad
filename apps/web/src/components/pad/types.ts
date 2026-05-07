export type AwarenessUser = {
  name: string;
  color: string;
  avatarUrl: string | null;
};

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
  compileStderr: string | null;
  durationMs: number;
}

export interface RunError {
  error: string;
  message?: string;
  retryAfterSec?: number;
}

export interface DeletedNotice {
  reason?: string;
  at?: number;
}

export const PALETTE = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
] as const;

// Stable color per logged-in identity so my pill colour does not flicker
// across reconnects within the same tab. Hash the name into the palette.
export function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % PALETTE.length;
  return PALETTE[idx] as string;
}

// Pick a printable single-letter initial from a display name. Whitespace,
// punctuation, and emoji-only names fall back to "?".
export function pickInitial(name: string | undefined | null): string {
  if (!name) return "?";
  for (const ch of name.trim()) {
    if (/^[\p{L}\p{N}]$/u.test(ch)) return ch.toUpperCase();
  }
  return "?";
}
