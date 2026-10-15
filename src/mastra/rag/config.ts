/** Single place that reads env for the RAG pipeline. Read lazily so tests can import pure modules without env. */

export const EMBED_DIM = 1024; // voyage-3 / voyage-3.5 default output dimension

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

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
