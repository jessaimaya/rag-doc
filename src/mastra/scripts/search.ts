import 'dotenv/config';
import { hybridSearch } from '../rag/retriever';
import { closePool } from '../rag/store';

/**
 * Inspect retrieval: npm run search -- "¿qué necesito para una incapacidad?" [--no-rerank] [--category IMSS] [--top 5]
 * Prints where each hit ranked in the vector list and the BM25 list, its fused (RRF) score and its rerank score.
 */
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const query = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && ['category', 'top'].includes(args[i - 1].slice(2)))).join(' ');

async function main() {
  if (!query) throw new Error('Usage: npm run search -- "your question" [--no-rerank] [--category X] [--top N]');
  const results = await hybridSearch(query, {
    topK: Number(option('top') ?? 5),
    category: option('category'),
    rerank: !args.includes('--no-rerank'),
  });
  console.log(`\n${query}\n`);
  results.forEach((r, i) => {
    const d = r.debug;
    console.log(`#${i + 1}  ${r.chunk.title}${r.chunk.page ? ` · p.${r.chunk.page}` : ''}${r.chunk.section ? ` · ${r.chunk.section}` : ''}`);
    console.log(`    vector #${d.vectorRank ?? '-'} · bm25 #${d.bm25Rank ?? '-'} · rrf ${d.rrf.toFixed(4)}${d.rerank !== undefined ? ` · rerank ${d.rerank.toFixed(3)}` : ''}`);
    console.log(`    ${r.chunk.text.slice(0, 220).replace(/\s+/g, ' ')}…\n`);
  });
  if (!results.length) console.log('No results (is the database ingested?)');
}

main()
  .catch(err => {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closePool);
