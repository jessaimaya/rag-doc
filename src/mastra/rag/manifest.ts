import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { detectType, SUPPORTED_EXTENSIONS, type DocType } from './loaders';

/**
 * Shape of one entry in documents/manifest.json, the source of truth for what gets ingested.
 * Each entry points at a local `file` (relative to documents/) or a remote `url`, never both (the `.refine` enforces it).
 * `.loose()` keeps any extra keys you add, and they end up stored as document metadata. `skip: true` lists a document
 * without ingesting it (for example, files that cannot be redistributed).
 */
export const manifestEntrySchema = z
  .object({
    file: z.string().optional(),
    url: z.url().optional(),
    type: z.enum(['pdf', 'docx', 'html', 'md', 'txt']).optional(),
    title: z.string().optional(),
    category: z.string().default('General'),
    language: z.string().default('es'),
    source_url: z.string().nullable().optional(),
    retrieved: z.string().optional(),
    notes: z.string().optional(),
    skip: z.boolean().optional(),
  })
  .loose()
  .refine(e => Boolean(e.file) !== Boolean(e.url), { message: 'each entry needs exactly one of `file` or `url`' });

export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

/**
 * A manifest entry resolved into something ingestible: a stable id, a title, the file type and where the bytes come from.
 */
export interface DocumentSpec {
  docId: string;
  title: string;
  type?: DocType; // undefined for URLs until the response content-type is known
  file?: string; // absolute path
  url?: string;
  entry: ManifestEntry;
}

/**
 * Accent-free, lower-case, dash-separated id. It becomes the `doc_id`, so the same file name always maps to the same document.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Fallback title from a file name: drop the extension and turn dashes/underscores into spaces.
 */
export function titleFromName(name: string): string {
  return path.basename(name).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
}

/**
 * Reads the manifest and resolves every entry into a DocumentSpec.
 *
 * - Validates the manifest with zod, so a typo fails with a clear message.
 * - File names are compared in NFC form: on Linux "ó" may be stored decomposed on disk and composed in the manifest.
 * - Supported files in the folder that the manifest does not mention are still ingested with defaults and returned in
 *   `unlisted`, so nothing is silently ignored.
 * - Two documents producing the same id is an error: it would make one overwrite the other.
 *
 * Further reading:
 * - Unicode Standard Annex #15, Normalization Forms (why "ó" can be stored two ways): https://unicode.org/reports/tr15/
 */
export function resolveDocuments(dir: string): { specs: DocumentSpec[]; unlisted: string[] } {
  const manifestPath = path.join(dir, 'manifest.json');
  const raw: unknown = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : [];
  const entries = z.array(manifestEntrySchema).parse(raw);

  // Linux file names are byte-exact: "ó" may be stored decomposed on disk but composed in the manifest.
  const onDisk = new Map(fs.readdirSync(dir).map(name => [name.normalize('NFC'), name]));

  const specs: DocumentSpec[] = [];
  const listed = new Set<string>();
  for (const entry of entries) {
    if (entry.file) listed.add(entry.file.normalize('NFC'));
    if (entry.skip) continue;
    if (entry.file) {
      // Compare NFC-normalized: file names on disk can be NFD while the manifest is NFC
      const realName = onDisk.get(entry.file.normalize('NFC'));
      const abs = realName ? path.join(dir, realName) : undefined;
      if (!abs) throw new Error(`manifest.json lists "${entry.file}" but it does not exist in ${dir}`);
      specs.push({
        docId: slugify(entry.file),
        title: entry.title ?? titleFromName(entry.file),
        type: entry.type ?? detectType(entry.file),
        file: abs,
        entry,
      });
    } else {
      const url = entry.url!;
      specs.push({
        docId: slugify(new URL(url).pathname.split('/').pop() || url),
        title: entry.title ?? titleFromName(new URL(url).pathname),
        type: entry.type ?? detectType(url),
        url,
        entry,
      });
    }
  }

  const unlisted: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!SUPPORTED_EXTENSIONS.includes(path.extname(name).toLowerCase())) continue;
    if (listed.has(name.normalize('NFC'))) continue;
    unlisted.push(name);
    specs.push({
      docId: slugify(name),
      title: titleFromName(name),
      type: detectType(name),
      file: path.join(dir, name),
      entry: manifestEntrySchema.parse({ file: name }),
    });
  }

  const seen = new Set<string>();
  for (const spec of specs) {
    if (seen.has(spec.docId)) throw new Error(`Duplicate document id "${spec.docId}" in manifest`);
    seen.add(spec.docId);
  }
  return { specs, unlisted };
}
