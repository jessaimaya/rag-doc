import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { hybridSearch } from './retriever';

/**
 * Minimum rerank score for the best result. Below it the tool reports that nothing relevant was found, so the agent
 * declines instead of improvising from weak matches. Calibrated with `npm run eval` (answerable questions scored
 * >= 0.695, unanswerable <= 0.512 on the first eval set). 0 disables the cutoff. Read at call time so evals can A/B it.
 */
export const DEFAULT_MIN_RELEVANCE = 0.6;
/**
 * Current relevance cutoff. Read on every call (not at import) so the eval can run the same agent with the cutoff on and
 * off. `RAG_MIN_RELEVANCE=0` disables it; a missing or non-numeric value falls back to the default.
 */
export function minRelevance(): number {
  const raw = process.env.RAG_MIN_RELEVANCE;
  const value = raw === undefined || raw === '' ? DEFAULT_MIN_RELEVANCE : Number(raw);
  return Number.isFinite(value) ? value : DEFAULT_MIN_RELEVANCE;
}

type Search = typeof hybridSearch;

/**
 * What the tool returns when retrieval itself fails (database down, embedding provider error). A thrown error would make the
 * agent retry the search until it runs out of steps and return no text, so the failure is reported as a result instead.
 */
export const RETRIEVAL_UNAVAILABLE = {
  results: [],
  note: 'retrieval_unavailable',
  message:
    'El buscador de documentos tiene un problema técnico y no se puede consultar ahora. No repitas la búsqueda. Dile al usuario que no puedes consultar los documentos en este momento y que lo intente de nuevo en unos minutos. No respondas con conocimiento propio.',
};

/** Connection failures arrive as an AggregateError with an empty message; the useful part is the code of the first cause (ECONNREFUSED...). */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err instanceof AggregateError ? err.errors[0] : undefined;
  const code = (cause as { code?: string } | undefined)?.code ?? (err as { code?: string }).code;
  return [err.name, code, err.message].filter(Boolean).join(' ');
}

/**
 * The tool's real logic, separated from the Mastra wrapper so tests can inject a fake `search`.
 *
 * Three outcomes, each shaped for the model that will read it:
 * - retrieval failed: returns RETRIEVAL_UNAVAILABLE (a normal result, not an exception, so the agent does not retry in a loop);
 * - the best rerank score is under the cutoff: returns `no_relevant_documents` with an instruction not to invent an
 *   answer. This is what makes the assistant say "I don't have that" instead of improvising from weak matches;
 * - otherwise: the top 5 chunks with title, section, page, source URL and text, numbered so the answer can cite them.
 */
export async function runRagSearch(query: string, category?: string, search: Search = hybridSearch) {
  let results: Awaited<ReturnType<Search>>;
  try {
    results = await search(query, { topK: 5, category });
  } catch (err) {
    // Log the cause server-side only; the model and the user get the generic message.
    console.error('Retrieval failed:', describeError(err));
    return RETRIEVAL_UNAVAILABLE;
  }
  const best = results[0]?.score ?? 0;
  if (best < minRelevance()) {
    return {
      results: [],
      note: 'no_relevant_documents',
      message: 'La base de conocimiento no contiene información relevante para esta pregunta. No inventes la respuesta.',
    };
  }
  return {
    results: results.map((r, i) => ({
      n: i + 1,
      title: r.chunk.title,
      category: r.chunk.category,
      // Absent fields are omitted rather than null: a model asked to cite "page: null" tends to invent one.
      ...(r.chunk.section ? { section: r.chunk.section } : {}),
      ...(r.chunk.page ? { page: r.chunk.page } : {}),
      ...(r.chunk.sourceUrl ? { sourceUrl: r.chunk.sourceUrl } : {}),
      relevance: Number(r.score.toFixed(3)),
      text: r.chunk.text,
    })),
  };
}

/**
 * The tool the agent calls to search the knowledge base. The description (in Spanish, like the users) tells the model
 * when to use it and what comes back; the zod `inputSchema` is what the model must fill in: a query and an optional category.
 */
export const insuranceRAGTool = createTool({
  id: 'insuranceRAGTool',
  description:
    'Busca en la base de conocimiento de trámites de seguros médicos de México (IMSS, ISSSTE, aseguradoras privadas, procedimientos hospitalarios, derechos del paciente y el consultorio de demostración). Devuelve fragmentos con título del documento, sección, página y URL de origen para citar.',
  inputSchema: z.object({
    query: z.string().describe('Pregunta o términos de búsqueda en español'),
    category: z.string().optional().describe('Filtro opcional por categoría, p. ej. "IMSS" o "ISSSTE"'),
  }),
  execute: async ({ context }) => runRagSearch(context.query, context.category),
});
