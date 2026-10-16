import { ragConfig } from './config';

/**
 * Limits for calling the Voyage API (embeddings and reranking). A request holds at most 128 inputs and ~200k characters
 * (roughly 50k tokens, under the per-request cap). Characters are converted to tokens at 3 per token, a conservative
 * ratio for Spanish, because the API counts tokens and we only see text.
 */
const BASE_URL = 'https://api.voyageai.com/v1';
const MAX_INPUTS_PER_CALL = 128;
const MAX_CHARS_PER_CALL = 200_000; // ~50k tokens, well under the per-request token cap
const CHARS_PER_TOKEN = 3; // conservative for Spanish
const MAX_RETRIES = 6;

/**
 * Maximum characters per request. Without a configured limit it is the API cap. With `VOYAGE_TPM` set (a token-per-minute
 * quota) one request is kept to 60% of it, because a single request larger than the quota could never succeed.
 */
function batchCharLimit(): number {
  const tpm = envNumber('VOYAGE_TPM');
  return tpm ? Math.min(MAX_CHARS_PER_CALL, Math.floor(tpm * 0.6 * CHARS_PER_TOKEN)) : MAX_CHARS_PER_CALL;
}

export type InputType = 'document' | 'query';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * POST to Voyage with throttling and retries.
 *
 * How: wait for the client-side throttle, send, and return the JSON on success. A 429 (rate limit) or 5xx is retried up
 * to 6 times, waiting for the `retry-after` header when present, or backing off exponentially (2s, 4s, ... capped at 30s).
 * Any other error, or running out of retries, throws with the status and the start of the body so the cause is visible.
 */
async function post<T>(path: string, body: unknown, chars: number): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await throttle(estimateTokens(chars));
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ragConfig.voyageApiKey}` },
      body: JSON.stringify(body),
    });
    if (res.ok) return (await res.json()) as T;

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) {
      throw new Error(`Voyage ${path} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
    // Free-tier keys are rate limited to a few requests per minute, so back off generously.
    const retryAfter = Number(res.headers.get('retry-after'));
    const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(30_000, 2000 * 2 ** attempt);
    await sleep(delay);
  }
}

/**
 * Reads a numeric env var; empty, missing or invalid means "not set". `estimateTokens` converts characters to the
 * tokens the throttle budgets with.
 */
const envNumber = (name: string) => Number(process.env[name]) || undefined;
const estimateTokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

const requestLog: { at: number; tokens: number }[] = [];

/**
 * Optional client-side rate limiter. Voyage's free tier (no payment method) allows 3 requests and 10K tokens per minute:
 * setting VOYAGE_RPM=3 and VOYAGE_TPM=10000 keeps the client under that instead of burning retries on 429s.
 * Unset means no throttling.
 *
 * How: `requestLog` is a sliding one-minute window of past requests. If adding this request would exceed the request
 * or token budget, it sleeps until the oldest entry leaves the window and checks again. An empty window always lets
 * one request through, even a large one, so it can never wait forever.
 *
 * Further reading:
 * - Voyage AI docs, Rate Limits (RPM and TPM): https://docs.voyageai.com/docs/rate-limits
 */
async function throttle(tokens: number) {
  const rpm = envNumber('VOYAGE_RPM');
  const tpm = envNumber('VOYAGE_TPM');
  if (!rpm && !tpm) return;
  for (;;) {
    const now = Date.now();
    while (requestLog.length && now - requestLog[0].at >= 60_000) requestLog.shift();
    const usedTokens = requestLog.reduce((n, w) => n + w.tokens, 0);
    const fitsRequests = !rpm || requestLog.length < rpm;
    const fitsTokens = !tpm || requestLog.length === 0 || usedTokens + tokens <= tpm;
    if (fitsRequests && fitsTokens) {
      requestLog.push({ at: now, tokens });
      return;
    }
    await sleep(Math.max(500, 60_000 - (now - requestLog[0].at) + 250));
  }
}

/**
 * Splits the inputs into API-sized batches, preserving order so embedding i still belongs to text i.
 * A batch closes when it reaches 128 inputs or when the next text would push it over the character limit.
 */
export function toBatches(texts: string[], maxChars = batchCharLimit()): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const text of texts) {
    if (current.length >= MAX_INPUTS_PER_CALL || (current.length > 0 && chars + text.length > maxChars)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(text);
    chars += text.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

/**
 * Embeds texts with the configured Voyage model, in batches. `inputType` matters: Voyage optimizes vectors differently
 * for 'document' (what gets stored) and 'query' (what the user types), so ingestion uses 'document' and search uses
 * 'query'. Results are sorted by `index` because the API does not promise to return them in request order.
 *
 * Further reading:
 * - Voyage AI docs, Text Embeddings (input_type "query" vs "document"): https://docs.voyageai.com/docs/embeddings
 */
export async function embed(texts: string[], inputType: InputType): Promise<number[][]> {
  const out: number[][] = [];
  for (const batch of toBatches(texts)) {
    const res = await post<{ data: { embedding: number[]; index: number }[] }>('/embeddings', {
      input: batch,
      model: ragConfig.embedModel,
      input_type: inputType,
    }, batch.reduce((n, t) => n + t.length, 0));
    out.push(...res.data.sort((a, b) => a.index - b.index).map(d => d.embedding));
  }
  return out;
}

export interface Reranked {
  index: number;
  score: number;
}

/**
 * Cross-encoder rerank: scores each passage against the query jointly and returns the best `topK` as
 * {index into `documents`, relevance score}. Unlike embeddings, where query and passage are encoded separately and
 * compared, the model reads both together, so it catches relevance that vector distance misses. The score is
 * calibrated enough to compare across questions, which is what the relevance cutoff relies on.
 *
 * Further reading:
 * - Voyage AI docs, Rerankers: https://docs.voyageai.com/docs/reranker
 * - Sentence Transformers, "Retrieve & Re-Rank": https://www.sbert.net/examples/applications/retrieve_rerank/README.html
 */
export async function rerank(query: string, documents: string[], topK: number): Promise<Reranked[]> {
  if (documents.length === 0) return [];
  const res = await post<{ data: { index: number; relevance_score: number }[] }>('/rerank', {
    query,
    documents,
    model: ragConfig.rerankModel,
    top_k: Math.min(topK, documents.length),
  }, query.length + documents.reduce((n, d) => n + d.length, 0));
  return res.data.map(d => ({ index: d.index, score: d.relevance_score }));
}
