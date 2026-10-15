import { Bm25Index } from './bm25';
import { reciprocalRankFusion } from './fusion';
import { corpusVersion, loadAllChunks, vectorSearch, type StoredChunk } from './store';
import { embed, rerank } from './voyage';

export interface SearchOptions {
  topK?: number;
  /** Candidates pulled from each retriever before fusion. */
  candidates?: number;
  /** How many fused candidates are sent to the reranker. */
  rerankPool?: number;
  category?: string;
  /** Set false to skip the cross-encoder (ablations, evals). */
  rerank?: boolean;
}

export interface SearchResult {
  chunk: StoredChunk;
  /** Final relevance (rerank score when reranked, otherwise RRF score). */
  score: number;
  debug: { vectorRank?: number; bm25Rank?: number; rrf: number; rerank?: number };
}

const INDEX_TTL_MS = 30_000;
let cache: { version: string; checkedAt: number; index: Bm25Index; byId: Map<string, StoredChunk> } | undefined;

async function getLexicalIndex() {
  if (cache && Date.now() - cache.checkedAt < INDEX_TTL_MS) return cache;
  const version = await corpusVersion();
  if (cache?.version === version) {
    cache.checkedAt = Date.now();
    return cache;
  }
  const chunks = await loadAllChunks();
  cache = {
    version,
    checkedAt: Date.now(),
    // The breadcrumb is indexed too, so a query for "Artículo 12" or a document title matches its chunks.
    index: new Bm25Index(chunks.map(c => ({ id: c.id, text: `${c.context}\n${c.text}` }))),
    byId: new Map(chunks.map(c => [c.id, c])),
  };
  return cache;
}

export function invalidateIndex() {
  cache = undefined;
}

export async function hybridSearch(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const { topK = 5, candidates = 25, rerankPool = 30, category, rerank: useRerank = true } = options;
  const { index, byId } = await getLexicalIndex();
  if (index.size === 0) return [];

  const [queryEmbedding] = await embed([query], 'query');
  const vectorHits = await vectorSearch(queryEmbedding, candidates, category);
  const lexicalHits = index
    .search(query, category ? candidates * 4 : candidates)
    .filter(h => !category || byId.get(h.id)?.category === category)
    .slice(0, candidates);

  const fused = reciprocalRankFusion([vectorHits, lexicalHits]).slice(0, rerankPool);
  const base = fused
    .map(f => ({ chunk: byId.get(f.id)!, rrf: f.score, vectorRank: f.ranks[0], bm25Rank: f.ranks[1] }))
    .filter(r => r.chunk);

  if (useRerank && base.length > 1) {
    try {
      const ranked = await rerank(query, base.map(r => `${r.chunk.context}\n${r.chunk.text}`), topK);
      return ranked.map(r => ({
        chunk: base[r.index].chunk,
        score: r.score,
        debug: { vectorRank: base[r.index].vectorRank, bm25Rank: base[r.index].bm25Rank, rrf: base[r.index].rrf, rerank: r.score },
      }));
    } catch (err) {
      console.warn('Rerank failed, falling back to RRF order:', err instanceof Error ? err.message : err);
    }
  }
  return base.slice(0, topK).map(r => ({
    chunk: r.chunk,
    score: r.rrf,
    debug: { vectorRank: r.vectorRank, bm25Rank: r.bm25Rank, rrf: r.rrf },
  }));
}
