import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { hybridSearch } from './retriever';

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
    return {
      results: results.map((r, i) => ({
        n: i + 1,
        title: r.chunk.title,
        category: r.chunk.category,
        section: r.chunk.section || null,
        page: r.chunk.page,
        sourceUrl: r.chunk.sourceUrl,
        relevance: Number(r.score.toFixed(3)),
        text: r.chunk.text,
      })),
    };
  },
});
