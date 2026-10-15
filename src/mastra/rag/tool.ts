import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { hybridSearch } from './retriever';

/**
 * Minimum rerank score for the best result. Below it the tool reports that nothing relevant was found, so the agent
 * declines instead of improvising from weak matches. Calibrated with `npm run eval` (answerable questions scored
 * >= 0.695, unanswerable <= 0.512 on the first eval set). 0 disables the cutoff. Read at call time so evals can A/B it.
 */
export const DEFAULT_MIN_RELEVANCE = 0.6;
export function minRelevance(): number {
  const raw = process.env.RAG_MIN_RELEVANCE;
  const value = raw === undefined || raw === '' ? DEFAULT_MIN_RELEVANCE : Number(raw);
  return Number.isFinite(value) ? value : DEFAULT_MIN_RELEVANCE;
}

export const insuranceRAGTool = createTool({
  id: 'insuranceRAGTool',
  description:
    'Busca en la base de conocimiento de trámites de seguros médicos de México (IMSS, ISSSTE, aseguradoras privadas, procedimientos hospitalarios, derechos del paciente y el consultorio de demostración). Devuelve fragmentos con título del documento, sección, página y URL de origen para citar.',
  inputSchema: z.object({
    query: z.string().describe('Pregunta o términos de búsqueda en español'),
    category: z.string().optional().describe('Filtro opcional por categoría, p. ej. "IMSS" o "ISSSTE"'),
  }),
  execute: async ({ context }) => {
    const results = await hybridSearch(context.query, { topK: 5, category: context.category });
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
  },
});
