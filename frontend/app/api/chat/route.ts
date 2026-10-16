import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';
import { extractSources } from '@/lib/sources';

const MAX_MESSAGES = 30;
const MAX_USER_LENGTH = 2000;
// Assistant answers are routinely longer than a user question (some exceed 3000 characters), and they come back as history.
const MAX_ASSISTANT_LENGTH = 8000;
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

  try {
    const response = await fetch(`${apiUrl}/api/agents/insuranceAgent/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ messages: body.messages }),
    });

    if (!response.ok) {
      console.error('Backend error', response.status, await response.text());
      return NextResponse.json(
        { error: 'The assistant is not available right now.' },
        { status: response.status === 429 ? 429 : 502 },
      );
    }

    // Send the browser only what it needs. The raw agent response also carries provider headers (organization id, rate
    // limits), token usage and tool arguments.
    const data = await response.json();
    return NextResponse.json({ text: typeof data?.text === 'string' ? data.text : '', sources: extractSources(data) });
  } catch (error) {
    console.error('Chat route error', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
