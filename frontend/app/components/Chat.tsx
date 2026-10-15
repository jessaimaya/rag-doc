'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { STARTERS } from '@/lib/starters';
import { Markdown } from './Markdown';

type Message = { id: string; role: 'user' | 'assistant'; content: string };
type ChatError = { message: string };

const MAX_INPUT = 2000;
const MAX_HISTORY = 30;
const REQUEST_TIMEOUT_MS = 60_000;

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

  const requestId = useRef(0);
  const listEnd = useRef<HTMLDivElement>(null);
  const lastAssistant = useRef<HTMLElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // A long answer should open at its first line, not its last; everything else follows the bottom.
  useEffect(() => {
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && !loading) lastAssistant.current?.scrollIntoView({ behavior, block: 'start' });
    else listEnd.current?.scrollIntoView({ behavior, block: 'end' });
  }, [messages, loading, error]);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [input]);

  const ask = useCallback(async (history: Message[]) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      // The backend keeps no memory, so the whole conversation is sent, capped at what the route accepts.
      let payload = history.slice(-MAX_HISTORY);
      while (payload.length > 1 && payload[0].role !== 'user') payload = payload.slice(1);
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: payload.map(({ role, content }) => ({ role, content })) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new ApiError(response.status);
      const data = await response.json();
      if (id !== requestId.current) return; // the conversation was reset while waiting
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      if (!text) throw new ApiError(502);
      setMessages((prev) => [...prev, { id: newId(), role: 'assistant', content: text }]);
    } catch (err) {
      if (id !== requestId.current) return;
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

  return (
    <div className="flex h-dvh flex-col">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-ink">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-serif text-lg font-semibold leading-tight">Asistente de trámites médicos</h1>
            <p className="truncate text-sm text-muted">IMSS, ISSSTE y seguros privados en México</p>
          </div>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={reset}
              className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm transition-colors hover:bg-accent-soft"
            >
              Nueva conversación
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto" aria-label="Conversación">
        <div className="mx-auto w-full max-w-3xl px-4 py-8" role="log" aria-live="polite" aria-relevant="additions">
          {messages.length === 0 && !loading && (
            <section className="rise">
              <h2 className="font-serif text-3xl font-semibold leading-tight sm:text-4xl">¿Con qué trámite te ayudo?</h2>
              <p className="mt-3 max-w-xl text-muted">
                Respondo con base en documentos públicos del IMSS, el ISSSTE, la CONAMED y aseguradoras, y te indico de dónde sale cada dato.
                No doy diagnósticos ni consejos médicos.
              </p>
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {STARTERS.map((s) => (
                  <button
                    key={s.question}
                    type="button"
                    onClick={() => send(s.question)}
                    className="group flex flex-col gap-1 rounded-xl border border-line bg-panel p-4 text-left transition-colors hover:border-accent hover:bg-accent-soft"
                  >
                    <span className="text-xs font-semibold uppercase tracking-wider text-accent">{s.topic}</span>
                    <span className="text-[0.95rem] leading-snug">{s.question}</span>
                  </button>
                ))}
              </div>
              <p className="mt-6 text-sm text-muted">
                Demostración: el consultorio «Valle Verde» y sus datos (horarios, precios, cuentas) son ficticios.
              </p>
            </section>
          )}

          <div className="flex flex-col gap-6">
            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="rise flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-user px-4 py-2.5">{m.content}</p>
                </div>
              ) : (
                <article key={m.id} ref={m.id === lastAssistantId ? lastAssistant : undefined} className="rise scroll-mt-4">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Asistente</p>
                  <div className="rounded-2xl rounded-tl-md border border-line bg-panel px-5 py-4">
                    <Markdown>{m.content}</Markdown>
                  </div>
                </article>
              ),
            )}

            {loading && (
              <div role="status" className="rise flex items-center gap-3 text-sm text-muted">
                <span className="flex gap-1" aria-hidden>
                  <span className="dot h-1.5 w-1.5 rounded-full bg-accent" />
                  <span className="dot h-1.5 w-1.5 rounded-full bg-accent" />
                  <span className="dot h-1.5 w-1.5 rounded-full bg-accent" />
                </span>
                Buscando en los documentos…
              </div>
            )}

            {error && (
              <div role="alert" className="rise flex flex-wrap items-center gap-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
                <span className="min-w-0 flex-1">{error.message}</span>
                <button
                  type="button"
                  onClick={() => void ask(messages)}
                  className="rounded-lg border border-current px-3 py-1.5 font-medium transition-opacity hover:opacity-80"
                >
                  Reintentar
                </button>
              </div>
            )}
          </div>
          <div ref={listEnd} />
        </div>
      </main>

      <footer className="border-t border-line bg-bg pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto w-full max-w-3xl px-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-end gap-2 rounded-2xl border border-line bg-panel p-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30"
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
              className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 outline-none placeholder:text-muted"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              aria-label="Enviar pregunta"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-ink transition-opacity disabled:opacity-35"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </form>
          <p className="mt-2 text-center text-xs text-muted">
            Enter para enviar · Shift+Enter para nueva línea
            {input.length > MAX_INPUT - 200 && <span className="ml-2 tabular-nums">{input.length}/{MAX_INPUT}</span>}
          </p>
        </div>
      </footer>
    </div>
  );
}
