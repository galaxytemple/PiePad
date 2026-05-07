// In-memory per-key token bucket. Single-process only — when we ever scale
// the web container out, swap the storage for Redis or similar. Each bucket
// expires after `windowMs` and is reaped on the next access plus by a periodic
// sweep so unique keys (e.g. one bucket per signed-in user) don't leak forever.

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  consume(key: string): { allowed: boolean; retryAfterSec: number };
}

interface Options {
  limit: number;
  windowMs: number;
  sweepIntervalMs?: number;
}

export function createRateLimiter(opts: Options): RateLimiter {
  const limit = Math.max(1, Math.floor(opts.limit));
  const windowMs = Math.max(1_000, Math.floor(opts.windowMs));
  const sweepEvery = Math.max(windowMs, opts.sweepIntervalMs ?? 5 * windowMs);

  const buckets = new Map<string, Bucket>();
  let lastSweep = Date.now();

  function sweep(now: number): void {
    if (now - lastSweep < sweepEvery) return;
    lastSweep = now;
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  }

  return {
    consume(key) {
      const now = Date.now();
      sweep(now);
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, retryAfterSec: 0 };
      }
      if (bucket.count >= limit) {
        return {
          allowed: false,
          retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        };
      }
      bucket.count += 1;
      return { allowed: true, retryAfterSec: 0 };
    },
  };
}
