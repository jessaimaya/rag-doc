import pg from 'pg';
import { EMBED_DIM, ragConfig } from './config';

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

export interface NewChunk {
  ord: number;
  context: string;
  text: string;
  section: string;
  page?: number;
  pageEnd?: number;
  embedding: number[];
}

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
export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: ragConfig.databaseUrl });
  return pool;
}

export async function closePool() {
  await pool?.end();
  pool = undefined;
}

const vectorLiteral = (v: number[]) => `[${v.join(',')}]`;

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

export async function getContentHash(docId: string): Promise<string | undefined> {
  const { rows } = await getPool().query('SELECT content_hash FROM rag_documents WHERE doc_id = $1', [docId]);
  return rows[0]?.content_hash;
}

/** Replaces a document and all of its chunks in one transaction, so re-ingesting is idempotent. */
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

export async function deleteDocument(docId: string) {
  await getPool().query('DELETE FROM rag_documents WHERE doc_id = $1', [docId]);
}

export async function listDocuments() {
  const { rows } = await getPool().query(
    'SELECT doc_id, title, category, chunk_count, ingested_at FROM rag_documents ORDER BY doc_id',
  );
  return rows as { doc_id: string; title: string; category: string; chunk_count: number; ingested_at: Date }[];
}

const CHUNK_SELECT = `
  SELECT c.id, c.doc_id, c.ord, c.context, c.text, c.section, c.page, c.page_end,
         d.title, d.category, d.source_url
  FROM rag_chunks c JOIN rag_documents d USING (doc_id)`;

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

export async function loadAllChunks(): Promise<StoredChunk[]> {
  const { rows } = await getPool().query(`${CHUNK_SELECT} ORDER BY c.doc_id, c.ord`);
  return rows.map(toChunk);
}

/** Cheap fingerprint so the BM25 index can be rebuilt when documents change. */
export async function corpusVersion(): Promise<string> {
  const { rows } = await getPool().query('SELECT count(*) AS n, max(ingested_at) AS latest FROM rag_documents');
  return `${rows[0].n}:${rows[0].latest?.toISOString?.() ?? ''}`;
}

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
