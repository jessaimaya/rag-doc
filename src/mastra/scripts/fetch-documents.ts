import * as fs from 'fs';
import * as path from 'path';
import { manifestEntrySchema } from '../rag/manifest';
import { z } from 'zod';

/**
 * Downloads the public documents listed in documents/manifest.json into documents/.
 * The third-party PDFs are not committed (they belong to their publishers); this rebuilds the corpus from each entry's `source_url`.
 *
 *   npm run fetch-docs               download what is missing
 *   npm run fetch-docs -- --force    download again even if the file exists
 */

const force = process.argv.includes('--force');
const dir = path.resolve('documents');
const TIMEOUT_MS = 60_000;
const MAX_BYTES = 50 * 1024 * 1024;

const entries = z.array(manifestEntrySchema).parse(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')));
const exists = (name: string) => fs.readdirSync(dir).some(n => n.normalize('NFC') === name.normalize('NFC'));

let failed = 0;
for (const entry of entries) {
  if (!entry.file || entry.skip) continue;
  if (!force && exists(entry.file)) {
    console.log(`= ${entry.file} (already there)`);
    continue;
  }
  if (!entry.source_url) {
    console.warn(`! ${entry.file}: no source_url in the manifest, nothing to download`);
    failed++;
    continue;
  }
  try {
    const res = await fetch(entry.source_url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_BYTES) throw new Error(`unexpected size (${buffer.length} bytes)`);
    // An error page saved under a .pdf name would poison the index, so check the magic bytes.
    if (entry.file.toLowerCase().endsWith('.pdf') && buffer.subarray(0, 5).toString() !== '%PDF-') {
      throw new Error('response is not a PDF');
    }
    fs.writeFileSync(path.join(dir, entry.file), buffer);
    console.log(`+ ${entry.file} (${Math.round(buffer.length / 1024)} KB)`);
  } catch (err) {
    failed++;
    console.warn(`! ${entry.file}: ${err instanceof Error ? err.message : err} <- ${entry.source_url}`);
  }
}

if (failed) {
  console.error(`\n${failed} document(s) could not be fetched. Download them by hand into documents/ and re-run.`);
  process.exit(1);
}
console.log('\nCorpus ready. Next: npm run ingest');
