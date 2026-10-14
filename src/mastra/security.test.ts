import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  safeEqual,
  resolveApiKey,
  createRateLimiter,
  createApiMiddleware,
  clientIp,
  type RequestContext,
} from './security';

function ctx(headers: Record<string, string> = {}): RequestContext {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { req: { header: (name: string) => lower[name.toLowerCase()] } };
}

const okNext = async () => {};
const bigLimiter = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });

test('safeEqual matches equal strings only', () => {
  assert.equal(safeEqual('secret', 'secret'), true);
  assert.equal(safeEqual('secret', 'secreT'), false);
  assert.equal(safeEqual('secret', 'secret-longer'), false);
});

test('production without an API key refuses to start', () => {
  assert.throws(() => resolveApiKey({ NODE_ENV: 'production' }), /MASTRA_API_KEY/);
  assert.throws(() => resolveApiKey({}), /MASTRA_API_KEY/);
  assert.throws(() => resolveApiKey({ MASTRA_API_KEY: '   ' }), /MASTRA_API_KEY/);
});

test('open mode is only allowed in development', () => {
  assert.equal(resolveApiKey({ NODE_ENV: 'development' }), null);
  assert.equal(resolveApiKey({ NODE_ENV: 'production', MASTRA_API_KEY: 'k' }), 'k');
});

test('request without the key gets 401', async () => {
  const handler = createApiMiddleware({ apiKey: 'k', limiter: bigLimiter() });
  const res = await handler(ctx(), okNext);
  assert.equal(res?.status, 401);
});

test('request with a wrong key gets 401', async () => {
  const handler = createApiMiddleware({ apiKey: 'k', limiter: bigLimiter() });
  const res = await handler(ctx({ 'x-api-key': 'nope' }), okNext);
  assert.equal(res?.status, 401);
});

test('valid key in x-api-key or Bearer header passes through', async () => {
  const handler = createApiMiddleware({ apiKey: 'k', limiter: bigLimiter() });
  let calls = 0;
  const next = async () => {
    calls += 1;
  };
  await handler(ctx({ 'x-api-key': 'k' }), next);
  await handler(ctx({ Authorization: 'Bearer k' }), next);
  assert.equal(calls, 2);
});

test('open mode lets requests through without a key', async () => {
  const handler = createApiMiddleware({ apiKey: null, limiter: bigLimiter() });
  let called = false;
  await handler(ctx(), async () => {
    called = true;
  });
  assert.equal(called, true);
});

test('rate limiter blocks after the limit and resets after the window', () => {
  let t = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
  assert.equal(limiter.check('a').allowed, true);
  assert.equal(limiter.check('a').allowed, true);
  const blocked = limiter.check('a');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec >= 1);
  assert.equal(limiter.check('b').allowed, true);
  t = 1001;
  assert.equal(limiter.check('a').allowed, true);
});

test('middleware answers 429 with Retry-After when rate limited', async () => {
  const handler = createApiMiddleware({
    apiKey: 'k',
    limiter: createRateLimiter({ limit: 1, windowMs: 60_000 }),
  });
  const headers = { 'x-api-key': 'k', 'x-forwarded-for': '1.2.3.4' };
  await handler(ctx(headers), okNext);
  const res = await handler(ctx(headers), okNext);
  assert.equal(res?.status, 429);
  assert.ok(res?.headers.get('Retry-After'));
});

test('client IP uses the rightmost x-forwarded-for entry', () => {
  assert.equal(clientIp(ctx({ 'x-forwarded-for': '6.6.6.6, 10.0.0.1, 203.0.113.7' })), '203.0.113.7');
  assert.equal(clientIp(ctx()), 'unknown');
});
