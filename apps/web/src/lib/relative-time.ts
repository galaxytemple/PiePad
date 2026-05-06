// Tiny "3m ago" formatter. Computed at render time on the server, so the
// value is only as fresh as the page load — refresh to update.

const UNITS: Array<[number, string]> = [
  [60, "s"],
  [60, "m"],
  [24, "h"],
  [30, "d"],
  [12, "mo"],
  [Number.POSITIVE_INFINITY, "y"],
];

export function timeAgo(date: Date | null | undefined): string {
  if (!date) return "—";
  const ms = Date.now() - date.getTime();
  if (ms < 0) return "just now";
  let value = Math.floor(ms / 1000);
  for (let i = 0; i < UNITS.length; i++) {
    const [step, unit] = UNITS[i]!;
    if (value < step) return `${value}${unit} ago`;
    value = Math.floor(value / step);
  }
  return `${value}y ago`;
}
