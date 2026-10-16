import 'dotenv/config';
import { closePool, ensureSchema, getPool, listDocuments } from '../rag/store';

/**
 * Health check: connects, makes sure the schema and pgvector exist (`ensureSchema` is idempotent) and lists the ingested documents. Run it first when something fails.
 */
async function main() {
  const db = getPool();
  await db.query('SELECT 1');
  console.log('Connected to Postgres');
  await ensureSchema();
  const { rows } = await db.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
  console.log(`pgvector ${rows[0]?.extversion} enabled, rag_documents / rag_chunks ready`);
  const docs = await listDocuments();
  console.log(docs.length ? `${docs.length} document(s):` : 'No documents yet. Run: npm run ingest');
  for (const d of docs) console.log(`  ${String(d.chunk_count).padStart(4)} chunks  ${d.doc_id}  [${d.category}]`);
}

main()
  .catch(err => {
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closePool);
