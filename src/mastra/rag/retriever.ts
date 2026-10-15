import { Bm25Index } from './bm25';
import { reciprocalRankFusion } from './fusion';
import { corpusVersion, loadAllChunks, vectorSearch, type StoredChunk } from './store';
import { embed, rerank } from './voyage';

export type SearchMode = 'hybrid' | 'vector' | 'bm25';

export interface SearchOptions {
  topK?: number;
  /** Which retrievers feed the result. `hybrid` (default) fuses both with RRF; the others exist for ablations. */
  mode?: SearchMode;
  /** Precomputed query embedding (evals reuse one embedding across configurations). */
  queryEmbedding?: number[];
  /** Candidates pulled from each retriever before fusion (raised to rerankPool when reranking). */
  candidates?: number;
  /** How many fused candidates are sent to the reranker. */
  rerankPool?: number;
  category?: string;
  /** RRF weights [vector, bm25]; default equal. Raise the vector weight when BM25 is the weaker signal. */
  rrfWeights?: [number, number];
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
  const { topK = 5, candidates = 25, rerankPool = 30, category, mode = 'hybrid', rerank: useRerank = true, rrfWeights } = options;
  const { index, byId } = await getLexicalIndex();
  if (index.size === 0) return [];

  // single-retriever modes must supply enough candidates for the reranker
  const pool = Math.max(candidates, useRerank ? rerankPool : topK);
  const wantVector = mode !== 'bm25';
  const wantLexical = mode !== 'vector';

  const vectorHits = wantVector ? await vectorSearch(options.queryEmbedding ?? (await embed([query], 'query'))[0], pool, category) : [];
  const lexicalHits = wantLexical
    ? index
        .search(query, category ? pool * 4 : pool)
        .filter(h => !category || byId.get(h.id)?.category === category)
        .slice(0, pool)
    : [];

  const ranked =
    mode === 'vector'
      ? vectorHits.map((h, i) => ({ id: h.id, score: h.score, ranks: [i + 1, undefined] as (number | undefined)[] }))
      : mode === 'bm25'
        ? lexicalHits.map((h, i) => ({ id: h.id, score: h.score, ranks: [undefined, i + 1] as (number | undefined)[] }))
        : reciprocalRankFusion([vectorHits, lexicalHits], { weights: rrfWeights });

  const base = ranked
    .slice(0, useRerank ? rerankPool : topK)
    .map(f => ({ chunk: byId.get(f.id)!, rrf: f.score, vectorRank: f.ranks[0], bm25Rank: f.ranks[1] }))
    .filter(r => r.chunk);

  if (useRerank && base.length > 0) {
    try {
      const reranked = await rerank(query, base.map(r => `${r.chunk.context}\n${r.chunk.text}`), topK);
      return reranked.map(r => ({
        chunk: base[r.index].chunk,
        score: r.score,
        debug: { vectorRank: base[r.index].vectorRank, bm25Rank: base[r.index].bm25Rank, rrf: base[r.index].rrf, rerank: r.score },
      }));
    } catch (err) {
      console.warn('Rerank failed, falling back to the unreranked order:', err instanceof Error ? err.message : err);
    }
  }
  return base.slice(0, topK).map(r => ({
    chunk: r.chunk,
    score: r.rrf,
    debug: { vectorRank: r.vectorRank, bm25Rank: r.bm25Rank, rrf: r.rrf },
  }));
}
