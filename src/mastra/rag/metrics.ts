/** Pure retrieval-evaluation helpers: relevance judgments and ranking metrics. */

/** `out_of_scope`: unrelated to the corpus. `near_miss`: on topic, but the answer is not in the documents. */
export type QuestionTag = 'semantic' | 'lexical' | 'exact' | 'out_of_scope' | 'near_miss';

export interface Judgment {
  /** Document id (see `npm run check-db`). */
  doc: string;
  /** Normalized substrings that must ALL appear in the chunk (breadcrumb + text). */
  mustContain: string[];
}

export interface EvalQuestion {
  id: string;
  question: string;
  tag: QuestionTag;
  /** Any of these judgments makes a chunk relevant. Empty for out-of-scope questions. */
  relevant: Judgment[];
  note?: string;
}

/** True when the corpus has no answer (out-of-scope and near-miss questions have no relevant judgments). */
export const isUnanswerable = (q: EvalQuestion) => q.relevant.length === 0;

export interface JudgedChunk {
  docId: string;
  context: string;
  text: string;
}

/** Accent-, case- and whitespace-insensitive form used for matching. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function isRelevant(question: EvalQuestion, chunk: JudgedChunk): boolean {
  const haystack = normalize(`${chunk.context}\n${chunk.text}`);
  return question.relevant.some(j => j.doc === chunk.docId && j.mustContain.every(s => haystack.includes(normalize(s))));
}

/** 1-based rank of the first relevant chunk, or undefined when none is in the list. */
export function firstRelevantRank(question: EvalQuestion, ranked: JudgedChunk[]): number | undefined {
  const i = ranked.findIndex(c => isRelevant(question, c));
  return i === -1 ? undefined : i + 1;
}

export interface RankSummary {
  n: number;
  hitAt: Record<number, number>;
  mrr: number;
}

/** Hit@k = share of questions whose first relevant chunk is within the top k. MRR = mean of 1/rank (0 when missed). */
export function summarizeRanks(ranks: (number | undefined)[], ks = [1, 3, 5], mrrCutoff = 10): RankSummary {
  const n = ranks.length;
  const hitAt: Record<number, number> = {};
  for (const k of ks) hitAt[k] = n ? ranks.filter(r => r !== undefined && r <= k).length / n : 0;
  const mrr = n ? ranks.reduce<number>((sum, r) => sum + (r !== undefined && r <= mrrCutoff ? 1 / r : 0), 0) / n : 0;
  return { n, hitAt, mrr };
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Probability that a random in-scope score is higher than a random out-of-scope score (ties count half).
 * 1.0 means the scores perfectly separate answerable from unanswerable questions; 0.5 is chance.
 */
export function auroc(positives: number[], negatives: number[]): number {
  if (!positives.length || !negatives.length) return NaN;
  let wins = 0;
  for (const p of positives) for (const n of negatives) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (positives.length * negatives.length);
}

/** Threshold on the top-1 score that best separates in-scope (above) from out-of-scope (below). */
export function bestThreshold(positives: number[], negatives: number[]): { threshold: number; accuracy: number } {
  const candidates = [...new Set([...positives, ...negatives])].sort((a, b) => a - b);
  let best = { threshold: candidates[0] ?? 0, accuracy: 0 };
  for (const t of candidates) {
    const correct = positives.filter(p => p >= t).length + negatives.filter(n => n < t).length;
    const accuracy = correct / (positives.length + negatives.length);
    if (accuracy > best.accuracy) best = { threshold: t, accuracy };
  }
  return best;
}

// ---------- citation checks (no LLM needed) ----------

export interface RetrievedRef {
  page: number | null;
  sourceUrl: string | null;
}

const trimUrl = (u: string) => u.replace(/[.,;:)\]]+$/, '').replace(/\/$/, '');

/** Page numbers ("p. 20", "pp. 20-21") and URLs the answer cites that do not appear in what the tool returned. */
export function fabricatedCitations(answer: string, retrieved: RetrievedRef[]): { pages: number[]; urls: string[] } {
  const knownPages = new Set(retrieved.map(r => r.page).filter((p): p is number => p !== null));
  const knownUrls = new Set(retrieved.map(r => r.sourceUrl).filter((u): u is string => !!u).map(trimUrl));

  const pages = new Set<number>();
  for (const m of answer.matchAll(/(?<![\w.])p(?:p|ágs?|ág)?\.\s*(\d{1,3})(?!\d)(?:\s*[-–]\s*(\d{1,3}))?/gi)) {
    for (const n of [m[1], m[2]]) if (n && !knownPages.has(Number(n))) pages.add(Number(n));
  }
  const urls = new Set<string>();
  for (const m of answer.matchAll(/https?:\/\/[^\s)\]>"'`]+/g)) {
    const url = trimUrl(m[0]);
    if (!knownUrls.has(url)) urls.add(url);
  }
  return { pages: [...pages], urls: [...urls] };
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
}
