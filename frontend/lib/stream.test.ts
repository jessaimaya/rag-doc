import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentStreamParser, type ClientEvent } from './stream';

const sse = (e: unknown) => `data: ${JSON.stringify(e)}\n\n`;
const passage = { title: 'Doc', section: 'S', page: 2, sourceUrl: 'https://example.org/a.pdf', relevance: 0.9, text: 'contenido' };
const feed = (chunks: string[]): ClientEvent[] => {
  const p = new AgentStreamParser();
  return [...chunks.flatMap((c) => p.push(c)), ...p.end()];
};

test('maps a normal run: searching, writing, text, then done with the sources', () => {
  const events = feed([
    sse({ type: 'start', payload: {} }),
    sse({ type: 'step-start', payload: { request: { body: { system: 'SECRET PROMPT' } } } }),
    sse({ type: 'tool-call', payload: { toolName: 'insuranceRAGTool', args: { query: 'q' } } }),
    sse({ type: 'tool-result', payload: { toolName: 'insuranceRAGTool', result: { results: [passage] } } }),
    sse({ type: 'reasoning-delta', payload: { text: 'private thoughts' } }),
    sse({ type: 'text-delta', payload: { text: 'Hola' } }),
    sse({ type: 'text-delta', payload: { text: ' mundo' } }),
    sse({ type: 'finish', payload: {} }),
    'data: [DONE]\n\n',
  ]);
  assert.deepEqual(events.map((e) => e.type), ['status', 'status', 'text', 'text', 'done']);
  const done = events.at(-1) as Extract<ClientEvent, { type: 'done' }>;
  assert.equal(done.sources.length, 1);
  assert.equal(done.sources[0].title, 'Doc');
});

test('never forwards the prompt, the reasoning or unknown events', () => {
  const out = JSON.stringify(
    feed([
      sse({ type: 'step-start', payload: { request: { body: { system: 'SECRET PROMPT' } } } }),
      sse({ type: 'reasoning-delta', payload: { text: 'private thoughts' } }),
      sse({ type: 'something-new', payload: { text: 'x' } }),
      sse({ type: 'text-delta', payload: { text: 'ok' } }),
      sse({ type: 'finish', payload: {} }),
    ]),
  );
  assert.doesNotMatch(out, /SECRET PROMPT|private thoughts|something-new/);
});

test('events split across chunk boundaries are reassembled', () => {
  const whole = sse({ type: 'text-delta', payload: { text: 'partido' } }) + sse({ type: 'finish', payload: {} });
  const events = feed([whole.slice(0, 20), whole.slice(20, 61), whole.slice(61)]);
  assert.deepEqual(events, [{ type: 'text', delta: 'partido' }, { type: 'done', sources: [] }]);
});

test('a finish without any text is an "empty" error, and an upstream error event is "unavailable"', () => {
  assert.deepEqual(feed([sse({ type: 'finish', payload: {} })]), [{ type: 'error', code: 'empty' }]);
  assert.deepEqual(feed([sse({ type: 'error', payload: { error: 'boom' } })]), [{ type: 'error', code: 'unavailable' }]);
});

test('a stream cut off before finish reports an error instead of hanging', () => {
  assert.deepEqual(feed([sse({ type: 'text-delta', payload: { text: 'a medias' } })]), [
    { type: 'text', delta: 'a medias' },
    { type: 'error', code: 'unavailable' },
  ]);
});

test('malformed lines are ignored, and unsafe or invalid passages are dropped', () => {
  const events = feed([
    'data: {not json}\n\n',
    sse({
      type: 'tool-result',
      payload: { toolName: 'insuranceRAGTool', result: { results: [{ ...passage, sourceUrl: 'javascript:alert(1)' }, { nope: true }] } },
    }),
    sse({ type: 'text-delta', payload: { text: 'x' } }),
    sse({ type: 'finish', payload: {} }),
  ]);
  const done = events.at(-1) as Extract<ClientEvent, { type: 'done' }>;
  assert.equal(done.sources.length, 1);
  assert.equal(done.sources[0].sourceUrl, undefined);
});

test('after finish, later events are ignored', () => {
  const events = feed([sse({ type: 'text-delta', payload: { text: 'a' } }), sse({ type: 'finish', payload: {} }), sse({ type: 'text-delta', payload: { text: 'late' } })]);
  assert.deepEqual(events.map((e) => e.type), ['text', 'done']);
});
