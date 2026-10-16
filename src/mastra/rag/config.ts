/** Single place that reads env for the RAG pipeline. Read lazily so tests can import pure modules without env. */

/**
 * Size of every embedding vector. It must match the model (voyage-3 returns 1024 numbers) AND the `vector(1024)` column
 * that `ensureSchema` creates in Postgres: change one and the other must follow, or inserts fail on a dimension mismatch.
 */
export const EMBED_DIM = 1024; // voyage-3 / voyage-3.5 default output dimension

/**
 * Reads a mandatory environment variable and fails with the variable's name when it is missing.
 *
 * Why: a missing key otherwise shows up much later as an opaque 401 from the embedding API or a connection error from
 * Postgres. Failing at the point of use, with the exact name, makes a bad `.env` obvious.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * The only place where the pipeline reads its settings (database URL, Voyage key, model names).
 *
 * Why getters: the values are resolved when they are used, not when the module is imported. That lets tests import pure
 * modules (chunker, bm25, fusion, metrics) without any environment, and lets scripts call `dotenv/config` first.
 */
export const ragConfig = {
  get databaseUrl() {
    return process.env.DATABASE_URL || process.env.DB_CONNECTION || requireEnv('DATABASE_URL');
  },
  get voyageApiKey() {
    return requireEnv('VOYAGE_API_KEY');
  },
  get embedModel() {
    return process.env.VOYAGE_EMBED_MODEL || 'voyage-3';
  },
  get rerankModel() {
    return process.env.VOYAGE_RERANK_MODEL || 'rerank-2.5';
  },
};
