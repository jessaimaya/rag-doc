/** Pure retrieval-evaluation helpers: relevance judgments and ranking metrics. */

/** `out_of_scope`: unrelated to the corpus. `near_miss`: on topic, but the answer is not in the documents. */
export type QuestionTag = 'semantic' | 'lexical' | 'exact' | 'out_of_scope' | 'near_miss';

/**
 * A relevance judgment: a chunk is a correct answer if it comes from `doc` and contains ALL the `mustContain` phrases.
 */
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

/**
 * True when the corpus has no answer (out-of-scope and near-miss questions have no relevant judgments).
 */
export const isUnanswerable = (q: EvalQuestion) => q.relevant.length === 0;

export interface JudgedChunk {
  docId: string;
  context: string;
  text: string;
}

/**
 * Accent-, case- and whitespace-insensitive form used for matching, so a judgment does not break over formatting differences.
 *
 * Further reading:
 * - Unicode Standard Annex #15, Normalization Forms: https://unicode.org/reports/tr15/
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Is this chunk a correct answer to the question? Judgments are phrases, not chunk ids, on purpose: chunk ids change
 * every time the chunker changes, but the phrase that answers a question does not, so the dataset survives re-chunking.
 */
export function isRelevant(question: EvalQuestion, chunk: JudgedChunk): boolean {
  const haystack = normalize(`${chunk.context}\n${chunk.text}`);
  return question.relevant.some(j => j.doc === chunk.docId && j.mustContain.every(s => haystack.includes(normalize(s))));
}

/**
 * 1-based position of the first relevant chunk in a ranked list, or undefined when none is there.
 */
export function firstRelevantRank(question: EvalQuestion, ranked: JudgedChunk[]): number | undefined {
  const i = ranked.findIndex(c => isRelevant(question, c));
  return i === -1 ? undefined : i + 1;
}

export interface RankSummary {
  n: number;
  hitAt: Record<number, number>;
  mrr: number;
}

/**
 * Hit@k = share of questions whose first relevant chunk is within the top k. MRR (mean reciprocal rank) = average of 1/rank,
 * counting 0 when the chunk is missed or beyond `mrrCutoff`; it rewards putting the right chunk first more than hit@k does.
 *
 * Further reading:
 * - Introduction to Information Retrieval, "Evaluation of ranked retrieval results" (precision at k, MAP): https://nlp.stanford.edu/IR-book/html/htmledition/evaluation-of-ranked-retrieval-results-1.html
 */
export function summarizeRanks(ranks: (number | undefined)[], ks = [1, 3, 5], mrrCutoff = 10): RankSummary {
  const n = ranks.length;
  const hitAt: Record<number, number> = {};
  for (const k of ks) hitAt[k] = n ? ranks.filter(r => r !== undefined && r <= k).length / n : 0;
  const mrr = n ? ranks.reduce<number>((sum, r) => sum + (r !== undefined && r <= mrrCutoff ? 1 / r : 0), 0) / n : 0;
  return { n, hitAt, mrr };
}

/**
 * Middle value (average of the two middle ones for an even count). Used for latency, where a few slow calls would skew a mean.
 */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Probability that a random answerable question scores higher than a random unanswerable one (ties count half).
 * 1.0 means the scores separate the two groups perfectly; 0.5 is chance. It answers: is the top rerank score a reliable
 * signal to say "the corpus does not know this"?
 *
 * Further reading:
 * - Fawcett, "An introduction to ROC analysis" (Pattern Recognition Letters, 2006): https://doi.org/10.1016/j.patrec.2005.10.010
 */
export function auroc(positives: number[], negatives: number[]): number {
  if (!positives.length || !negatives.length) return NaN;
  let wins = 0;
  for (const p of positives) for (const n of negatives) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (positives.length * negatives.length);
}

/**
 * Tries every observed score as a cutoff and keeps the one that classifies most questions correctly (answerable above it, unanswerable below). This is how the relevance cutoff was calibrated.
 *
 * Further reading:
 * - Fawcett, "An introduction to ROC analysis" (choosing operating points): https://doi.org/10.1016/j.patrec.2005.10.010
 */
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

/**
 * Detects invented citations without an LLM: page numbers ("p. 20", "pp. 20-21") and URLs in the answer that do not
 * appear in what the tool returned. If the model cites page 31 and no retrieved chunk is on page 31, it made it up.
 * URLs are compared after trimming trailing punctuation and slashes.
 */
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

/**
 * Arithmetic mean; NaN for an empty list so an empty group shows as '-' in reports rather than as a fake 0.
 */
export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;
}
