import 'dotenv/config';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { chunkDocument } from '../rag/chunker';
import { ragConfig } from '../rag/config';
import { detectType, loadDocument, SUPPORTED_EXTENSIONS } from '../rag/loaders';
import { manifestEntrySchema, resolveDocuments, slugify, titleFromName, type DocumentSpec } from '../rag/manifest';
import { closePool, deleteDocument, ensureSchema, getContentHash, listDocuments, replaceDocument } from '../rag/store';
import { embed } from '../rag/voyage';

/**
 * The one ingestion path. Reads documents/manifest.json (or a --dir), and for each document:
 * load -> structure-aware + semantic chunking -> embed -> replace in Postgres.
 *
 *   npm run ingest                      ingest everything that changed
 *   npm run ingest -- --only imss       only documents whose id contains "imss"
 *   npm run ingest -- --force           re-ingest even if the file and settings are unchanged
 *   npm run ingest -- --dry-run         parse + chunk only (no API calls, no database writes)
 *   npm run ingest -- --no-semantic     structure-only chunking (skips the per-sentence embedding pass)
 *   npm run ingest -- --prune           delete documents from the database that are no longer in the manifest
 *   npm run ingest -- --url <url> [--category IMSS] [--title "..."]   ingest one remote document without touching the manifest
 */

// Bump when chunking logic changes so unchanged files are re-chunked.
const CHUNKER_VERSION = 'v3';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const dryRun = flag('dry-run');
const semantic = !flag('no-semantic');
const force = flag('force');
const only = option('only')?.toLowerCase();
const dir = path.resolve(option('dir') ?? 'documents');

async function readSource(spec: DocumentSpec): Promise<{ buffer: Buffer; type: ReturnType<typeof detectType> }> {
  if (spec.file) return { buffer: fs.readFileSync(spec.file), type: spec.type };
  const res = await fetch(spec.url!);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const type = spec.type ?? detectType(spec.url!, res.headers.get('content-type') ?? undefined);
  return { buffer: Buffer.from(await res.arrayBuffer()), type };
}

async function ingest(spec: DocumentSpec): Promise<'ingested' | 'unchanged' | 'dry-run'> {
  const { buffer, type } = await readSource(spec);
  if (!type) throw new Error(`Cannot tell the file type; set "type" in the manifest (${SUPPORTED_EXTENSIONS.join(', ')})`);

  const hash = createHash('sha256')
    .update(buffer)
    .update(JSON.stringify({ CHUNKER_VERSION, semantic, model: ragConfig.embedModel, title: spec.entry.title, category: spec.entry.category }))
    .digest('hex');
  if (!dryRun && !force && (await getContentHash(spec.docId)) === hash) return 'unchanged';

  const loaded = await loadDocument(buffer, type);
  const title = spec.entry.title ?? loaded.detectedTitle ?? titleFromName(spec.docId);
  const useEmbeddings = semantic && !dryRun;
  const chunks = await chunkDocument(loaded.blocks, {
    title,
    embed: useEmbeddings ? texts => embed(texts, 'document') : undefined,
  });
  if (chunks.length === 0) throw new Error('Document produced no chunks');

  const sizes = chunks.map(c => c.text.length);
  const avg = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length);
  console.log(`   ${type.toUpperCase()} · ${loaded.blocks.length} block(s) · ${chunks.length} chunks · avg ${avg} chars (min ${Math.min(...sizes)}, max ${Math.max(...sizes)})`);

  if (dryRun) {
    const sample = chunks[Math.floor(chunks.length / 2)];
    console.log(`   sample [${sample.context}${sample.page ? ` · p.${sample.page}` : ''}]: ${sample.text.slice(0, 160).replace(/\s+/g, ' ')}…`);
    return 'dry-run';
  }

  const vectors = await embed(chunks.map(c => `${c.context}\n${c.text}`), 'document');
  const { file, url, type: _t, title: _ti, category, language, source_url, skip: _s, ...extra } = spec.entry;
  await replaceDocument(
    { docId: spec.docId, title, category, language, sourceUrl: source_url ?? url ?? null, contentHash: hash, metadata: { file, ...extra } },
    chunks.map((c, i) => ({ ord: i, context: c.context, text: c.text, section: c.section, page: c.page, pageEnd: c.pageEnd, embedding: vectors[i] })),
  );
  return 'ingested';
}

async function main() {
  const urlArg = option('url');
  const { specs: all, unlisted } = urlArg
    ? {
        specs: [
          {
            docId: slugify(new URL(urlArg).pathname.split('/').pop() || urlArg),
            title: option('title') ?? titleFromName(new URL(urlArg).pathname),
            type: detectType(urlArg),
            url: urlArg,
            entry: manifestEntrySchema.parse({ url: urlArg, title: option('title'), category: option('category') }),
          } satisfies DocumentSpec,
        ],
        unlisted: [],
      }
    : resolveDocuments(dir);
  if (unlisted.length) console.warn(`⚠️  Not in manifest.json, ingested with defaults: ${unlisted.join(', ')}`);
  const specs = only ? all.filter(s => s.docId.includes(only) || s.title.toLowerCase().includes(only)) : all;
  if (specs.length === 0) throw new Error(only ? `No document matches "${only}"` : `No documents found in ${dir}`);

  if (!dryRun) await ensureSchema();
  console.log(`📚 ${specs.length} document(s) from ${dir}${dryRun ? ' (dry run)' : ''}${semantic ? '' : ' (structure-only chunking)'}\n`);

  const failed: string[] = [];
  for (const spec of specs) {
    console.log(`📄 ${spec.docId}`);
    try {
      const outcome = await ingest(spec);
      if (outcome === 'unchanged') console.log('   ↺ unchanged, skipped (use --force to redo)');
      else if (outcome === 'ingested') console.log('   ✅ stored');
    } catch (err) {
      failed.push(spec.docId);
      console.error(`   ❌ ${err instanceof Error ? err.message : err}`);
    }
  }

  if (flag('prune') && !only && !dryRun) {
    const keep = new Set(all.map(s => s.docId));
    for (const doc of await listDocuments()) {
      if (!keep.has(doc.doc_id)) {
        await deleteDocument(doc.doc_id);
        console.log(`🗑️  pruned ${doc.doc_id}`);
      }
    }
  }

  if (!dryRun) {
    console.log('\nIn database:');
    for (const d of await listDocuments()) console.log(`  ${String(d.chunk_count).padStart(4)} chunks  ${d.doc_id}  [${d.category}]`);
  }
  if (failed.length) {
    console.error(`\n❌ ${failed.length} failed: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

main()
  .catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closePool);
