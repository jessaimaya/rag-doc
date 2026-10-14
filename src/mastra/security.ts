import { createHash, timingSafeEqual } from 'node:crypto';

type Env = Record<string, string | undefined>;

/** Minimal slice of the Hono context that the middleware needs. */
export interface RequestContext {
  req: { header(name: string): string | undefined };
}

/** Compares two strings in constant time (hashing first hides the length). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Returns the API key the server must enforce, or null when the API is open.
 * The API is only allowed to be open when NODE_ENV=development. Any other
 * value, including unset, requires MASTRA_API_KEY.
 */
export function resolveApiKey(env: Env): string | null {
  const key = env.MASTRA_API_KEY?.trim();
  if (key) return key;
  if (env.NODE_ENV === 'development') return null;
  throw new Error('MASTRA_API_KEY is required unless NODE_ENV=development');
}

export function extractApiKey(c: RequestContext): string | undefined {
  const direct = c.req.header('x-api-key');
  if (direct) return direct;
  const auth = c.req.header('authorization');
  const match = auth?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

/**
 * Client IP behind a single trusted proxy (Railway): the proxy appends the
 * real address, so the rightmost x-forwarded-for entry is the one to trust.
 * Earlier entries can be forged by the client.
 */
export function clientIp(c: RequestContext): string {
  const forwarded = c.req.header('x-forwarded-for');
  const last = forwarded?.split(',').pop()?.trim();
  return last || c.req.header('x-real-ip') || 'unknown';
}

export interface RateLimiter {
  check(key: string): { allowed: boolean; retryAfterSec: number };
}

/** Fixed-window in-memory limiter. Fine for a single instance. */
export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, { count: number; resetAt: number }>();

  return {
    check(key) {
      const t = now();
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
      }
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= t) {
        entry = { count: 0, resetAt: t + opts.windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      return {
        allowed: entry.count <= opts.limit,
        retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - t) / 1000)),
      };
    },
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Rate limits per client IP, then checks the API key (when one is enforced). */
export function createApiMiddleware(opts: { apiKey: string | null; limiter: RateLimiter }) {
  return async (c: RequestContext, next: () => Promise<void>) => {
    const { allowed, retryAfterSec } = opts.limiter.check(clientIp(c));
    if (!allowed) {
      return json(
        429,
        { error: 'Too Many Requests', message: 'Rate limit exceeded' },
        { 'Retry-After': String(retryAfterSec) },
      );
    }

    if (opts.apiKey !== null) {
      const provided = extractApiKey(c);
      if (!provided || !safeEqual(provided, opts.apiKey)) {
        return json(401, { error: 'Unauthorized', message: 'Valid API key required' });
      }
    }

    return next();
  };
}
