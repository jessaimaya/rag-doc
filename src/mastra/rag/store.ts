import pg from 'pg';
import { EMBED_DIM, ragConfig } from './config';

/**
 * A chunk as read back from the database, joined with the metadata of its document (title, category, source URL).
 */
export interface StoredChunk {
  id: string;
  docId: string;
  ord: number;
  context: string;
  text: string;
  section: string;
  page: number | null;
  pageEnd: number | null;
  title: string;
  category: string;
  sourceUrl: string | null;
}

/**
 * A chunk ready to insert: the text, its breadcrumb context, its page range and the embedding of `context + text`.
 */
export interface NewChunk {
  ord: number;
  context: string;
  text: string;
  section: string;
  page?: number;
  pageEnd?: number;
  embedding: number[];
}

/**
 * Document-level row. `contentHash` is how re-ingestion knows nothing changed; `metadata` keeps any extra manifest keys.
 */
export interface NewDocument {
  docId: string;
  title: string;
  category: string;
  language: string;
  sourceUrl: string | null;
  contentHash: string;
  metadata: Record<string, unknown>;
}

let pool: pg.Pool | undefined;
/**
 * Lazily created, shared connection pool. One pool per process avoids reconnecting on every query.
 */
export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: ragConfig.databaseUrl });
  return pool;
}

/**
 * Closes the pool. Scripts call it at the end, otherwise open connections keep the Node process alive.
 */
export async function closePool() {
  await pool?.end();
  pool = undefined;
}

/**
 * pgvector accepts vectors as the text '[0.1,0.2,...]'; this formats a number array that way (cast with ::vector in SQL).
 */
const vectorLiteral = (v: number[]) => `[${v.join(',')}]`;

/**
 * Creates everything the pipeline needs, idempotently (safe to run on every ingest).
 *
 * - the pgvector extension;
 * - `rag_documents`: one row per document, with the content hash and the chunk count;
 * - `rag_chunks`: one row per chunk, with its embedding. `ON DELETE CASCADE` means deleting a document removes its chunks;
 * - an index on (doc_id, ord) to read a document in order, and an HNSW index on the embedding with cosine operators so
 *   nearest-neighbour search stays fast as the corpus grows (approximate, but with high recall).
 *
 * Further reading:
 * - pgvector README (HNSW indexes, distance operators): https://github.com/pgvector/pgvector
 * - Malkov and Yashunin, "Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs": https://arxiv.org/abs/1603.09320
 */
export async function ensureSchema() {
  const db = getPool();
  await db.query('CREATE EXTENSION IF NOT EXISTS vector');
  await db.query(`
    CREATE TABLE IF NOT EXISTS rag_documents (
      doc_id        text PRIMARY KEY,
      title         text NOT NULL,
      category      text NOT NULL,
      language      text NOT NULL,
      source_url    text,
      content_hash  text NOT NULL,
      metadata      jsonb NOT NULL DEFAULT '{}',
      chunk_count   int NOT NULL DEFAULT 0,
      ingested_at   timestamptz NOT NULL DEFAULT now()
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS rag_chunks (
      id        text PRIMARY KEY,
      doc_id    text NOT NULL REFERENCES rag_documents(doc_id) ON DELETE CASCADE,
      ord       int NOT NULL,
      context   text NOT NULL,
      text      text NOT NULL,
      section   text NOT NULL DEFAULT '',
      page      int,
      page_end  int,
      embedding vector(${EMBED_DIM}) NOT NULL
    )`);
  await db.query('CREATE INDEX IF NOT EXISTS rag_chunks_doc_idx ON rag_chunks (doc_id, ord)');
  await db.query('CREATE INDEX IF NOT EXISTS rag_chunks_embedding_idx ON rag_chunks USING hnsw (embedding vector_cosine_ops)');
}

/**
 * Hash stored for a document at its last ingest, or undefined if it was never ingested. The ingest script compares it to the new hash to skip unchanged files.
 */
export async function getContentHash(docId: string): Promise<string | undefined> {
  const { rows } = await getPool().query('SELECT content_hash FROM rag_documents WHERE doc_id = $1', [docId]);
  return rows[0]?.content_hash;
}

/**
 * Replaces a document and all of its chunks in one transaction, so re-ingesting is idempotent.
 *
 * How: inside BEGIN/COMMIT, delete the old document (the cascade removes its chunks), insert the new row and then every
 * chunk with the id `<docId>#<ord>`. If anything fails, ROLLBACK leaves the previous version intact: a search never sees a
 * half-ingested document, and a failed run does not lose the old data.
 */
export async function replaceDocument(doc: NewDocument, chunks: NewChunk[]) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM rag_documents WHERE doc_id = $1', [doc.docId]);
    await client.query(
      `INSERT INTO rag_documents (doc_id, title, category, language, source_url, content_hash, metadata, chunk_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [doc.docId, doc.title, doc.category, doc.language, doc.sourceUrl, doc.contentHash, doc.metadata, chunks.length],
    );
    for (const c of chunks) {
      await client.query(
        `INSERT INTO rag_chunks (id, doc_id, ord, context, text, section, page, page_end, embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::vector)`,
        [`${doc.docId}#${c.ord}`, doc.docId, c.ord, c.context, c.text, c.section, c.page ?? null, c.pageEnd ?? null, vectorLiteral(c.embedding)],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Removes one document and, through the cascade, its chunks. Used by `ingest --prune`.
 */
export async function deleteDocument(docId: string) {
  await getPool().query('DELETE FROM rag_documents WHERE doc_id = $1', [docId]);
}

/**
 * Documents with their chunk counts, for `check-db` and the ingest summary.
 */
export async function listDocuments() {
  const { rows } = await getPool().query(
    'SELECT doc_id, title, category, chunk_count, ingested_at FROM rag_documents ORDER BY doc_id',
  );
  return rows as { doc_id: string; title: string; category: string; chunk_count: number; ingested_at: Date }[];
}

/**
 * Shared SELECT for reading chunks together with the document fields the tool needs for citations.
 */
const CHUNK_SELECT = `
  SELECT c.id, c.doc_id, c.ord, c.context, c.text, c.section, c.page, c.page_end,
         d.title, d.category, d.source_url
  FROM rag_chunks c JOIN rag_documents d USING (doc_id)`;

/**
 * Maps a snake_case database row to the camelCase StoredChunk.
 */
const toChunk = (r: any): StoredChunk => ({
  id: r.id,
  docId: r.doc_id,
  ord: r.ord,
  context: r.context,
  text: r.text,
  section: r.section,
  page: r.page,
  pageEnd: r.page_end,
  title: r.title,
  category: r.category,
  sourceUrl: r.source_url,
});

/**
 * Every chunk in reading order. It feeds the BM25 index and the evals; the corpus is small enough to hold in memory.
 */
export async function loadAllChunks(): Promise<StoredChunk[]> {
  const { rows } = await getPool().query(`${CHUNK_SELECT} ORDER BY c.doc_id, c.ord`);
  return rows.map(toChunk);
}

/**
 * Cheap fingerprint of the corpus: document count + latest ingest time. If it is unchanged the BM25 index is still
 * valid; any ingest, re-ingest or deletion changes it, so the retriever knows to rebuild.
 */
export async function corpusVersion(): Promise<string> {
  const { rows } = await getPool().query('SELECT count(*) AS n, max(ingested_at) AS latest FROM rag_documents');
  return `${rows[0].n}:${rows[0].latest?.toISOString?.() ?? ''}`;
}

/**
 * Nearest chunks to an embedding. `<=>` is pgvector's cosine distance, so `1 - distance` is the cosine similarity
 * returned as the score. The optional category filter is applied in SQL (`$3 IS NULL OR category = $3`), and ORDER BY on
 * the same expression lets Postgres use the HNSW index.
 *
 * Further reading:
 * - pgvector README, Querying (<=> is cosine distance): https://github.com/pgvector/pgvector
 */
export async function vectorSearch(embedding: number[], limit: number, category?: string): Promise<{ id: string; score: number }[]> {
  const { rows } = await getPool().query(
    `SELECT c.id, 1 - (c.embedding <=> $1::vector) AS score
     FROM rag_chunks c JOIN rag_documents d USING (doc_id)
     WHERE ($3::text IS NULL OR d.category = $3)
     ORDER BY c.embedding <=> $1::vector
     LIMIT $2`,
    [vectorLiteral(embedding), limit, category ?? null],
  );
  return rows.map(r => ({ id: r.id, score: Number(r.score) }));
}
