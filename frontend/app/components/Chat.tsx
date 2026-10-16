'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { STARTERS } from '@/lib/starters';
import type { Source } from '@/lib/sources';
import type { ClientEvent } from '@/lib/stream';
import { Markdown } from './Markdown';
import { Sources } from './Sources';

type Message = { id: string; role: 'user' | 'assistant'; content: string; sources?: Source[] };
type ChatError = { message: string };

const MAX_INPUT = 2000;
const MAX_HISTORY = 30;
const REQUEST_TIMEOUT_MS = 120_000;

class ApiError extends Error {
  constructor(public status: number) {
    super(`API error ${status}`);
  }
}

function describeError(err: unknown): ChatError {
  if (err instanceof ApiError && err.status === 429) {
    return { message: 'Hiciste muchas preguntas seguidas. Espera un momento e inténtalo de nuevo.' };
  }
  if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return { message: 'El asistente tardó demasiado en responder. Inténtalo de nuevo.' };
  }
  if (err instanceof TypeError) {
    return { message: 'No hay conexión con el asistente. Revisa tu internet e inténtalo de nuevo.' };
  }
  return { message: 'El asistente no está disponible en este momento. Inténtalo de nuevo en unos minutos.' };
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()));

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  // 'searching' until the retrieval tool answers, then 'writing' until the first words arrive.
  const [phase, setPhase] = useState<'searching' | 'writing'>('searching');

  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const listEnd = useRef<HTMLDivElement>(null);
  const lastAssistant = useRef<HTMLElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // A long answer should open at its first line, not its last, and the page must not chase the text while it streams in:
  // scroll once when a message is added (the answer's first words), not on every update to its content.
  const lastRole = messages[messages.length - 1]?.role;
  useEffect(() => {
    // The empty state must open at its headline; scrolling to the end would hide it on short screens.
    if (!lastRole && !error) return;
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    if (lastRole === 'assistant') lastAssistant.current?.scrollIntoView({ behavior, block: 'start' });
    else listEnd.current?.scrollIntoView({ behavior, block: 'end' });
  }, [messages.length, lastRole, error]);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [input]);

  const ask = useCallback(async (history: Message[]) => {
    const id = ++requestId.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError(null);
    setPhase('searching');

    const assistantId = newId();
    let text = '';
    let sources: Source[] | null = null;
    let frame = 0;
    // The answer grows word by word; re-render at most once per frame instead of once per token.
    const show = () => {
      frame = 0;
      const content = text;
      setMessages((prev) =>
        prev.some((m) => m.id === assistantId)
          ? prev.map((m) => (m.id === assistantId ? { ...m, content } : m))
          : [...prev, { id: assistantId, role: 'assistant', content }],
      );
    };

    try {
      // The backend keeps no memory, so the whole conversation is sent, capped at what the route accepts.
      let payload = history.slice(-MAX_HISTORY);
      while (payload.length > 1 && payload[0].role !== 'user') payload = payload.slice(1);
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: payload.map(({ role, content }) => ({ role, content })) }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
      if (!response.ok || !response.body) throw new ApiError(response.status);

      // Newline-delimited JSON events, see lib/stream.ts.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: ClientEvent;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (id !== requestId.current) return; // the conversation was reset while waiting
          if (event.type === 'status') setPhase(event.state);
          else if (event.type === 'text') {
            text += event.delta;
            if (!frame) frame = requestAnimationFrame(show);
          } else if (event.type === 'done') sources = event.sources;
          else throw new ApiError(502);
        }
      }
      if (id !== requestId.current) return;
      if (!sources || !text.trim()) throw new ApiError(502);
      cancelAnimationFrame(frame);
      const final = text.trim();
      const done = sources;
      setMessages((prev) =>
        prev.some((m) => m.id === assistantId)
          ? prev.map((m) => (m.id === assistantId ? { ...m, content: final, sources: done } : m))
          : [...prev, { id: assistantId, role: 'assistant', content: final, sources: done }],
      );
    } catch (err) {
      if (id !== requestId.current) return;
      cancelAnimationFrame(frame);
      // A half-written answer without its sources must not stay on screen as if it were complete.
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      console.error('Chat request failed', err);
      setError(describeError(err));
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        if (window.matchMedia('(pointer: fine)').matches) textarea.current?.focus();
      }
    }
  }, []);

  const send = (text: string) => {
    const content = text.trim().slice(0, MAX_INPUT);
    if (!content || loading) return;
    const next = [...messages, { id: newId(), role: 'user' as const, content }];
    setMessages(next);
    setInput('');
    void ask(next);
  };

  const reset = () => {
    requestId.current++;
    controller.current?.abort();
    setMessages([]);
    setInput('');
    setError(null);
    setLoading(false);
    textarea.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  // Writing has started once the answer's message exists; before that the dots show what the assistant is doing.
  const streamingId = loading && lastRole === 'assistant' ? lastAssistantId : undefined;

  return (
    <div className="flex h-dvh items-center justify-center p-2 sm:p-6">
      <div className="flex h-full max-h-[56rem] w-full max-w-4xl rounded-[22px] border border-white/40 bg-frame p-1.5 shadow-soft backdrop-blur-xl">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-panel">
          <header className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <span aria-hidden className="orb h-9 w-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-medium leading-tight tracking-tight">Asistente de trámites médicos</h1>
              <p className="truncate text-sm text-muted">IMSS, ISSSTE y seguros privados en México</p>
            </div>
            <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs text-accent sm:flex">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
              en línea
            </span>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={reset}
                className="shrink-0 rounded-full border border-line px-3.5 py-1.5 text-sm text-accent transition-colors hover:bg-accent-soft"
              >
                Nueva conversación
              </button>
            )}
          </header>

          <main className="fade-edges flex-1 overflow-y-auto" aria-label="Conversación">
            <div
              className={`mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 ${messages.length === 0 && !loading ? 'flex min-h-full flex-col justify-center' : ''}`}
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              aria-busy={loading}
            >
              {messages.length === 0 && !loading && (
                <section className="rise text-center">
                  <span aria-hidden className="orb mx-auto block h-14 w-14 rounded-full" />
                  <h2 className="mt-6 text-balance text-3xl font-medium leading-[1.05] tracking-[-0.035em] sm:text-5xl">
                    ¿Con qué trámite te ayudo?
                  </h2>
                  <p className="mx-auto mt-4 max-w-md text-balance text-[0.95rem] leading-snug text-muted">
                    Respondo con base en documentos públicos del IMSS, el ISSSTE, la CONAMED y aseguradoras, y te indico de dónde sale cada dato.
                    No doy diagnósticos ni consejos médicos.
                  </p>
                  <div className="mt-8 grid gap-3 text-left sm:grid-cols-2">
                    {STARTERS.map((s) => (
                      <button
                        key={s.question}
                        type="button"
                        onClick={() => send(s.question)}
                        className="group flex flex-col gap-1.5 rounded-2xl border border-line bg-bg p-4 text-left transition-all hover:-translate-y-0.5 hover:border-accent-hi hover:bg-accent-soft hover:shadow-soft"
                      >
                        <span className="font-mono text-[0.68rem] uppercase tracking-[0.12em] text-accent">{s.topic}</span>
                        <span className="text-[0.95rem] leading-snug">{s.question}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-6 font-mono text-[0.68rem] uppercase leading-relaxed tracking-[0.1em] text-muted">
                    Demostración: el consultorio «Valle Verde» y sus datos son ficticios
                  </p>
                </section>
              )}

              <div className="flex flex-col gap-6">
                {messages.map((m) =>
                  m.role === 'user' ? (
                    <div key={m.id} className="rise flex justify-end">
                      <p className="steel max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-4 py-2.5 shadow-soft">{m.content}</p>
                    </div>
                  ) : (
                    <article key={m.id} ref={m.id === lastAssistantId ? lastAssistant : undefined} className="rise scroll-mt-4">
                      <p className="mb-1.5 flex items-center gap-2 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-muted">
                        Asistente
                        {m.id === streamingId && (
                          <span className="flex gap-0.5" aria-hidden>
                            <span className="dot h-1 w-1 rounded-full bg-accent" />
                            <span className="dot h-1 w-1 rounded-full bg-accent" />
                            <span className="dot h-1 w-1 rounded-full bg-accent" />
                          </span>
                        )}
                      </p>
                      <div className="rounded-2xl rounded-tl-md border border-line bg-bg px-5 py-4">
                        <Markdown>{m.content}</Markdown>
                      </div>
                      {m.sources && m.sources.length > 0 && <Sources sources={m.sources} />}
                    </article>
                  ),
                )}

                {loading && lastRole === 'user' && (
                  <div role="status" className="rise flex items-center gap-3 text-sm text-muted">
                    <span className="flex gap-1" aria-hidden>
                      <span className="dot h-1.5 w-1.5 rounded-full bg-accent" />
                      <span className="dot h-1.5 w-1.5 rounded-full bg-accent" />
                      <span className="dot h-1.5 w-1.5 rounded-full bg-accent" />
                    </span>
                    {phase === 'searching' ? 'Buscando en los documentos…' : 'Leyendo los pasajes y redactando…'}
                  </div>
                )}

                {error && (
                  <div role="alert" className="rise flex flex-wrap items-center gap-3 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
                    <span className="min-w-0 flex-1">{error.message}</span>
                    <button
                      type="button"
                      onClick={() => void ask(messages)}
                      className="rounded-full border border-current px-3.5 py-1.5 font-medium transition-opacity hover:opacity-80"
                    >
                      Reintentar
                    </button>
                  </div>
                )}
              </div>
              <div ref={listEnd} />
            </div>
          </main>

          <footer className="pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
            <div className="mx-auto w-full max-w-2xl px-4 sm:px-6">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
                className="flex items-end gap-2 rounded-[1.75rem] border border-line bg-panel p-1.5 shadow-soft focus-within:border-accent-hi focus-within:ring-4 focus-within:ring-accent-hi/20"
              >
                <label htmlFor="question" className="sr-only">
                  Tu pregunta
                </label>
                <textarea
                  id="question"
                  ref={textarea}
                  rows={1}
                  value={input}
                  maxLength={MAX_INPUT}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Escribe tu pregunta sobre un trámite…"
                  className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-3.5 py-2 outline-none placeholder:text-muted"
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  aria-label="Enviar pregunta"
                  className="steel grid h-10 w-10 shrink-0 place-items-center rounded-full transition-opacity disabled:opacity-35"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </button>
              </form>
              <p className="mt-2 hidden text-center font-mono text-[0.68rem] uppercase tracking-[0.1em] text-muted sm:block">
                Enter para enviar · Shift+Enter para nueva línea
                {input.length > MAX_INPUT - 200 && <span className="ml-2 tabular-nums">{input.length}/{MAX_INPUT}</span>}
              </p>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
