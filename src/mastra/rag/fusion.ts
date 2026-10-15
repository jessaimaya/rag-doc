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
 * Reciprocal Rank Fusion: score(d) = sum over lists of weight / (k + rank). Uses ranks only, so
 * cosine similarities and BM25 scores (different scales) combine without normalization.
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
