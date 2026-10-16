import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';
import { AgentStreamParser, type ClientEvent } from '@/lib/stream';

const MAX_MESSAGES = 30;
const MAX_USER_LENGTH = 2000;
// Assistant answers are routinely longer than a user question (some exceed 3000 characters), and they come back as history.
const MAX_ASSISTANT_LENGTH = 8000;
// Max silence from the backend (retrieval + the model's first token) before the stream is cut.
const IDLE_TIMEOUT_MS = 45_000;
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN) || 10;

function isValidMessages(messages: unknown): messages is { role: string; content: string }[] {
  return (
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.length <= MAX_MESSAGES &&
    messages.every(
      (m) =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.length <= (m.role === 'user' ? MAX_USER_LENGTH : MAX_ASSISTANT_LENGTH),
    )
  );
}

export async function POST(request: NextRequest) {
  const limit = checkRateLimit(clientIp(request.headers), RATE_LIMIT_PER_MIN, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests, try again in a moment.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    );
  }

  let body: { messages?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (!isValidMessages(body.messages)) {
    return NextResponse.json({ error: 'Invalid messages' }, { status: 400 });
  }

  // API_URL is the server-side backend URL (Railway private network); local dev falls back to localhost
  const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4111';

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.MASTRA_API_KEY) {
    headers['x-api-key'] = process.env.MASTRA_API_KEY;
  }

  // One controller stops the upstream request when the browser leaves, when the stream stalls, or when we are done.
  const upstream = new AbortController();
  request.signal.addEventListener('abort', () => upstream.abort());
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const armIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => upstream.abort(), IDLE_TIMEOUT_MS);
  };

  let response: Response;
  try {
    armIdleTimer();
    response = await fetch(`${apiUrl}/api/agents/insuranceAgent/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ messages: body.messages }),
      signal: upstream.signal,
    });
  } catch (error) {
    clearTimeout(idleTimer);
    console.error('Chat route error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  if (!response.ok || !response.body) {
    clearTimeout(idleTimer);
    console.error('Backend error', response.status, await response.text().catch(() => ''));
    return NextResponse.json(
      { error: 'The assistant is not available right now.' },
      { status: response.status === 429 ? 429 : 502 },
    );
  }

  // The browser gets newline-delimited JSON events (see lib/stream.ts), never the agent's raw stream: that carries the
  // system prompt, the model's reasoning, token usage and provider headers.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const parser = new AgentStreamParser();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (events: ClientEvent[]) => {
        for (const event of events) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          armIdleTimer();
          send(parser.push(decoder.decode(value, { stream: true })));
        }
        send(parser.end());
      } catch (error) {
        // An abort caused by the browser leaving needs no message; a stall or a broken upstream does.
        if (!request.signal.aborted) {
          console.error('Chat stream error', error);
          send([{ type: 'error', code: 'unavailable' }]);
        }
      } finally {
        clearTimeout(idleTimer);
        controller.close();
      }
    },
    cancel() {
      clearTimeout(idleTimer);
      upstream.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no', // keep reverse proxies from buffering the stream
    },
  });
}
