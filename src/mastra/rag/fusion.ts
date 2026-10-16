/**
 * Anything with an id can be fused; the fusion only needs the order of each list, never its scores.
 */
export interface Ranked {
  id: string;
}

export interface Fused {
  id: string;
  score: number;
  /** 1-based rank in each input list, undefined when the list did not return the item. */
  ranks: (number | undefined)[];
}

/**
 * Reciprocal Rank Fusion (RRF): merges several ranked lists into one. score(d) = sum over lists of weight / (k + rank).
 *
 * Why: vector similarity (cosine, 0..1) and BM25 (unbounded) live on different scales, so adding or averaging the raw
 * scores needs fragile normalization. RRF uses ranks only: a chunk that sits near the top of both lists beats one that
 * is first in just one. `k` (60 is the value from the original paper) flattens the curve so the gap between rank 1 and
 * rank 2 is not huge. `weights` lets one retriever count more (the evals sweep vector:BM25 weights).
 *
 * `ranks` keeps the 1-based position in every input list, which `npm run search` prints to show who found what.
 *
 * Further reading:
 * - Cormack, Clarke and Buettcher, "Reciprocal rank fusion outperforms Condorcet and individual rank learning methods" (SIGIR 2009): https://doi.org/10.1145/1571941.1572114
 */
export function reciprocalRankFusion(lists: Ranked[][], options: { k?: number; weights?: number[] } = {}): Fused[] {
  const k = options.k ?? 60;
  const fused = new Map<string, Fused>();
  lists.forEach((list, li) => {
    const weight = options.weights?.[li] ?? 1;
    list.forEach((item, i) => {
      const entry = fused.get(item.id) ?? { id: item.id, score: 0, ranks: new Array(lists.length).fill(undefined) };
      entry.score += weight / (k + i + 1);
      entry.ranks[li] = i + 1;
      fused.set(item.id, entry);
    });
  });
  return [...fused.values()].sort((a, b) => b.score - a.score);
}
