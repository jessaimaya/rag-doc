import { ragConfig } from './config';

const BASE_URL = 'https://api.voyageai.com/v1';
const MAX_INPUTS_PER_CALL = 128;
const MAX_CHARS_PER_CALL = 200_000; // ~50k tokens, well under the per-request token cap
const CHARS_PER_TOKEN = 3; // conservative for Spanish
const MAX_RETRIES = 6;

/** With a token-per-minute cap, a single request must fit inside it (with headroom). */
function batchCharLimit(): number {
  const tpm = envNumber('VOYAGE_TPM');
  return tpm ? Math.min(MAX_CHARS_PER_CALL, Math.floor(tpm * 0.6 * CHARS_PER_TOKEN)) : MAX_CHARS_PER_CALL;
}

export type InputType = 'document' | 'query';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
 * Optional client-side throttle for rate-limited keys. Voyage's free tier (no payment method) allows
 * 3 requests and 10K tokens per minute: set VOYAGE_RPM=3 and VOYAGE_TPM=10000 to stay under that
 * instead of burning retries on 429s. Unset means no throttling.
 */
const envNumber = (name: string) => Number(process.env[name]) || undefined;
const estimateTokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

const requestLog: { at: number; tokens: number }[] = [];

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

/** Splits inputs into API-sized batches, preserving order. */
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

/** Cross-encoder rerank: scores each document against the query jointly. */
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
