import type { Source } from '@/lib/sources';

/** The passages behind an answer, so every claim can be checked against the document it came from. */
export function Sources({ sources }: { sources: Source[] }) {
  return (
    <details className="group mt-2">
      <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-line px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-accent transition-colors hover:bg-accent-soft [&::-webkit-details-marker]:hidden">
        <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
        Pasajes consultados · {sources.length}
      </summary>
      <ul className="mt-2 grid gap-2">
        {sources.map((s, i) => (
          <li key={`${s.title}-${i}`}>
            <details className="group/card rounded-xl border border-line bg-panel">
              <summary className="flex cursor-pointer list-none items-start gap-3 p-3 [&::-webkit-details-marker]:hidden">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-[0.65rem] text-accent">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-snug">{s.title}</span>
                  {s.section && <span className="mt-0.5 block text-xs leading-snug text-muted">{s.section}</span>}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1.5">
                  {s.page !== undefined && <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[0.65rem] text-accent">p. {s.page}</span>}
                  <span className="flex items-center gap-1.5" title="Puntaje del reordenador (0 a 100): qué tan bien responde el pasaje a la pregunta">
                    <span aria-hidden className="h-1 w-12 overflow-hidden rounded-full bg-accent-soft">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(s.relevance * 100)}%` }} />
                    </span>
                    <span className="font-mono text-[0.65rem] tabular-nums text-muted">{Math.round(s.relevance * 100)}</span>
                  </span>
                </span>
              </summary>
              <div className="border-t border-line px-3 pb-3 pt-2.5">
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">{s.excerpt}</p>
                {s.sourceUrl && (
                  <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm text-accent underline underline-offset-4">
                    Abrir el documento original
                  </a>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
    </details>
  );
}
