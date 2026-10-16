import { collectSources, isRecord, type Source } from './sources';

/** What the browser receives from /api/chat: one JSON object per line. */
export type ClientEvent =
  | { type: 'status'; state: 'searching' | 'writing' }
  | { type: 'text'; delta: string }
  | { type: 'done'; sources: Source[] }
  | { type: 'error'; code: 'unavailable' | 'empty' };

const TOOL = 'insuranceRAGTool';

/**
 * Converts the Mastra agent's server-sent events into ClientEvents.
 *
 * It is an allow-list: only the events below are understood, everything else is dropped on purpose. The raw stream includes
 * `step-start` events that embed the full request (system prompt and conversation) and `reasoning-delta` events with the
 * model's reasoning; neither may reach the browser.
 */
export class AgentStreamParser {
  private buffer = '';
  private results: unknown[] = [];
  private textLength = 0;
  private finished = false;

  /** Feed a decoded chunk; returns the events completed by it. */
  push(chunk: string): ClientEvent[] {
    this.buffer += chunk;
    const blocks = this.buffer.split(/\r?\n\r?\n/);
    this.buffer = blocks.pop() ?? '';
    return blocks.flatMap((block) => this.handleBlock(block));
  }

  /** Call when the upstream closes. A stream that ended without a `finish` event was cut off. */
  end(): ClientEvent[] {
    const rest = this.buffer.trim() ? this.handleBlock(this.buffer) : [];
    this.buffer = '';
    if (this.finished) return rest;
    this.finished = true;
    return [...rest, { type: 'error', code: 'unavailable' }];
  }

  private handleBlock(block: string): ClientEvent[] {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data || data === '[DONE]' || this.finished) return [];
    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      return [];
    }
    return isRecord(event) ? this.handleEvent(event) : [];
  }

  private handleEvent(event: Record<string, unknown>): ClientEvent[] {
    const payload = isRecord(event.payload) ? event.payload : {};
    switch (event.type) {
      case 'tool-call':
        return payload.toolName === TOOL ? [{ type: 'status', state: 'searching' }] : [];
      case 'tool-result': {
        if (payload.toolName !== TOOL) return [];
        if (isRecord(payload.result)) this.results.push(payload.result.results);
        return [{ type: 'status', state: 'writing' }];
      }
      case 'text-delta': {
        if (typeof payload.text !== 'string' || !payload.text) return [];
        this.textLength += payload.text.length;
        return [{ type: 'text', delta: payload.text }];
      }
      case 'finish':
        this.finished = true;
        return this.textLength > 0 ? [{ type: 'done', sources: collectSources(this.results) }] : [{ type: 'error', code: 'empty' }];
      case 'error':
        this.finished = true;
        return [{ type: 'error', code: 'unavailable' }];
      default:
        return [];
    }
  }
}
