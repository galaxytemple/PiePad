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

// 16 well-spaced hues based on Tailwind 500-tier values. Order matters
// because colorFor() hashes a name into PALETTE — changing the order will
// reshuffle existing users' auto-derived colors. New colors at the end is
// safe; reordering existing slots is not.
export const PALETTE = [
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#eab308", // yellow
  "#84cc16", // lime
  "#22c55e", // green
  "#10b981", // emerald
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#0ea5e9", // sky
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#d946ef", // fuchsia
  "#ec4899", // pink
] as const;

// True iff `value` is one of the canonical PALETTE entries. Used at the
// server-action boundary to reject anything else before it touches the DB.
export function isValidPaletteColor(value: string): boolean {
  return (PALETTE as readonly string[]).includes(value);
}

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
