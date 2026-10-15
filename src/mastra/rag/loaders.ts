import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { convert } from 'html-to-text';
import * as path from 'path';

export type DocType = 'pdf' | 'docx' | 'html' | 'md' | 'txt';

/** A contiguous piece of extracted text. PDFs produce one block per page. */
export interface Block {
  text: string;
  page?: number;
}

export interface LoadedDocument {
  blocks: Block[];
  /** Title found inside the file itself (markdown front matter, first heading), if any. */
  detectedTitle?: string;
}

const EXTENSIONS: Record<string, DocType> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.html': 'html',
  '.htm': 'html',
  '.md': 'md',
  '.markdown': 'md',
  '.txt': 'txt',
};

export const SUPPORTED_EXTENSIONS = Object.keys(EXTENSIONS);

export function detectType(nameOrUrl: string, contentType?: string): DocType | undefined {
  const ext = path.extname(nameOrUrl.split('?')[0]).toLowerCase();
  if (EXTENSIONS[ext]) return EXTENSIONS[ext];
  if (contentType?.includes('pdf')) return 'pdf';
  if (contentType?.includes('html')) return 'html';
  if (contentType?.includes('wordprocessingml')) return 'docx';
  if (contentType?.includes('markdown')) return 'md';
  if (contentType?.startsWith('text/')) return 'txt';
  return undefined;
}

export async function loadDocument(buffer: Buffer, type: DocType): Promise<LoadedDocument> {
  switch (type) {
    case 'pdf':
      return { blocks: removeRepeatedLines(await loadPdf(buffer)) };
    case 'docx': {
      const { value } = await mammoth.convertToHtml({ buffer });
      return { blocks: [{ text: htmlToMarkdownish(value) }] };
    }
    case 'html':
      return { blocks: [{ text: htmlToMarkdownish(buffer.toString('utf8')) }] };
    case 'md':
      return loadMarkdown(buffer.toString('utf8'));
    case 'txt':
      return { blocks: [{ text: buffer.toString('utf8') }] };
  }
}

// ---------- Markdown / HTML ----------

export function loadMarkdown(raw: string): LoadedDocument {
  let text = raw.replace(/^﻿/, '');
  let detectedTitle: string | undefined;
  const frontMatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (frontMatter) {
    detectedTitle = frontMatter[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1];
    text = text.slice(frontMatter[0].length);
  }
  detectedTitle ??= text.match(/^#\s+(.+)$/m)?.[1];
  return { blocks: [{ text }], detectedTitle };
}

/** Converts HTML to plain text but keeps headings as `#` lines so the chunker can use the structure. */
export function htmlToMarkdownish(html: string): string {
  const withHeadings = html.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, inner) => {
    const title = inner.replace(/<[^>]+>/g, '').trim();
    return title ? `<p>\n${'#'.repeat(Number(level))} ${title}\n</p>` : '';
  });
  return convert(withHeadings, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'nav', format: 'skip' },
      { selector: 'footer', format: 'skip' },
    ],
  });
}

// ---------- PDF ----------

/**
 * Some PDFs (the IMSS procedures) embed fonts whose Latin-1 codes are read back as MacRoman, so
 * "Descripción" comes out as "DescripciÛn". Detect that pattern and map the characters back.
 */
const MAC_TO_LATIN1 = (() => {
  const map = new Map<string, string>();
  const mac = new TextDecoder('macintosh');
  for (let byte = 0xa0; byte <= 0xff; byte++) {
    map.set(mac.decode(Uint8Array.of(byte)), String.fromCharCode(byte));
  }
  return map;
})();

export function fixMacRomanMojibake(text: string): string {
  const suspicious = (text.match(/[a-z][ÛÒ˙ÈÌ·][a-z]/g) ?? []).length;
  const genuine = (text.match(/[a-z][óñúéí][a-z]/g) ?? []).length;
  if (suspicious < 10 || suspicious < genuine * 2) return text;
  // Curly quotes / dashes in these files are usually correct; only remap them when they sit between two letters
  // (an uppercase accent inside a word such as "FORMACIÓN"), never at a word edge.
  const TYPOGRAPHIC = /[\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026]/;
  const chars = [...text];
  return chars
    .map((ch, i) => {
      if (ch.charCodeAt(0) <= 0x7f) return ch;
      if (TYPOGRAPHIC.test(ch) && !(/\p{L}/u.test(chars[i - 1] ?? '') && /\p{L}/u.test(chars[i + 1] ?? ''))) return ch;
      return MAC_TO_LATIN1.get(ch) ?? ch;
    })
    .join('');
}

async function loadPdf(buffer: Buffer): Promise<Block[]> {
  if (!buffer?.length) throw new Error('Invalid PDF file: empty buffer');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const blocks: Block[] = result.pages.map(page => ({
      page: page.num,
      text: page.text
        .split('\n')
        .filter(line => !/^--\s*\d+\s+of\s+\d+\s*--$/.test(line.trim()))
        .join('\n'),
    }));
    if (!blocks.some(b => b.text.trim())) throw new Error('No text could be extracted (scanned PDF? OCR is not supported yet)');
    const fixed = fixMacRomanMojibake(blocks.map(b => b.text).join('\n'));
    return fixed === blocks.map(b => b.text).join('\n') ? blocks : blocks.map(b => ({ ...b, text: fixMacRomanMojibake(b.text) }));
  } finally {
    await parser.destroy();
  }
}

/** Drops running headers/footers: short lines that repeat (ignoring digits) on many pages. */
export function removeRepeatedLines(blocks: Block[]): Block[] {
  if (blocks.length < 4) return blocks;
  const norm = (line: string) => line.toLowerCase().replace(/\d+/g, '#').trim();
  const pagesWithLine = new Map<string, number>();
  for (const block of blocks) {
    for (const key of new Set(block.text.split('\n').map(norm))) {
      pagesWithLine.set(key, (pagesWithLine.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(blocks.length * 0.4));
  return blocks.map(block => ({
    ...block,
    text: block.text
      .split('\n')
      .filter(line => line.length > 80 || (pagesWithLine.get(norm(line)) ?? 0) < threshold)
      .join('\n'),
  }));
}
