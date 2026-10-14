// Fixed-window in-memory limiter. Fine for a single instance.
const hits = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  if (hits.size > 10_000) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }
  let entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    hits.set(key, entry);
  }
  entry.count += 1;
  return {
    allowed: entry.count <= limit,
    retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

// Behind one trusted proxy (Railway) the rightmost x-forwarded-for entry is the real client.
export function clientIp(headers: Headers): string {
  const last = headers.get('x-forwarded-for')?.split(',').pop()?.trim();
  return last || headers.get('x-real-ip') || 'unknown';
}
