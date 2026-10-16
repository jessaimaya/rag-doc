import type { Block } from './loaders';

/**
 * Structure-aware + semantic chunking.
 *
 *  1. Parse the text into sections using headings (markdown #, "Artículo N", "CAPÍTULO", "6.1 Título").
 *  2. Split each section into atoms (sentences, list items, whole tables).
 *  3. Embed the atoms and find topic shifts: the cosine distance between the windows of atoms on
 *     each side of a boundary. Boundaries above a percentile threshold are semantic breakpoints.
 *  4. Pack atoms into chunks: break at semantic breakpoints once the chunk is big enough, always
 *     break before the size limit, never cross a section.
 */

export interface Atom {
  text: string;
  page?: number;
  kind: 'sentence' | 'item' | 'table';
  para: number;
}

export interface Section {
  path: string[];
  atoms: Atom[];
}

export interface Chunk {
  /** Body text shown to the user. */
  text: string;
  /** Breadcrumb ("Title › Section › Subsection") prepended when embedding / indexing. */
  context: string;
  section: string;
  page?: number;
  pageEnd?: number;
}

export interface ChunkOptions {
  title: string;
  /** Embeds atoms for semantic breakpoints. Omit for structure-only chunking. */
  embed?: (texts: string[]) => Promise<number[][]>;
  minChars?: number;
  maxChars?: number;
  /** Atom boundaries whose topic-shift distance is above this percentile become breakpoints. */
  breakpointPercentile?: number;
  window?: number;
}

const DEFAULTS = { minChars: 400, maxChars: 1400, breakpointPercentile: 0.85, window: 2 };
const TINY_SECTION_CHARS = 120;
const RUNT_CHARS = 60;
const MIN_CHUNK_CHARS = 20; // anything shorter (page furniture) is dropped

// ---------- headings ----------

export interface Heading {
  level: number;
  title: string;
  rest?: string;
}

/**
 * Decides whether a line is a heading and at what level (1 = top). Real documents rarely use one convention, so it
 * recognizes four: markdown `#`, legal headings (TÍTULO / CAPÍTULO / SECCIÓN, levels 1-3), "Artículo N" (level 4; the text
 * after the number stays as the start of the body) and numbered titles like "6.1 Requisitos" (level = number of dots + 1).
 * A numbered line is rejected when it looks like a sentence or a table-of-contents entry (long, ends with
 * punctuation, has a comma or a trailing page number). Headings drive the breadcrumb of every chunk and the rule that
 * a chunk never crosses a section.
 */
export function detectHeading(line: string): Heading | null {
  const text = line.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const md = text.match(/^(#{1,6})\s+(.+?)\s*#*$/);
  if (md) return { level: md[1].length, title: md[2] };

  const legal = text.match(/^(T[ÍI]TULO|CAP[ÍI]TULO|SECCI[ÓO]N)\s+[IVXLCDM\d]+\b.{0,80}$/i);
  if (legal) {
    const kind = legal[1].toUpperCase();
    return { level: kind.startsWith('T') ? 1 : kind.startsWith('C') ? 2 : 3, title: text };
  }

  const article = text.match(/^(Art[íi]culo\s+\d+[º°o]?(?:\s+(?:Bis|Ter|Quater))?)\s*[.\-–—:]+\s*(.*)$/i);
  if (article) return { level: 4, title: article[1], rest: article[2] || undefined };

  const numbered = text.match(/^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+[A-ZÁÉÍÓÚÑ]/);
  // a trailing page number means a table-of-contents entry, not a heading
  if (numbered && text.length <= 70 && !/[.;,:?]$/.test(text) && !text.includes(',') && !/\s\d{1,3}$/.test(text)) {
    return { level: numbered[1].split('.').length, title: text };
  }
  return null;
}

const ITEM_RE = /^\s*(?:[-*•▪●]|\d+[.)]|[a-zA-Z][.)]|[IVXLCDM]{1,6}[.)])\s+\S/;
const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isTableRule = (line: string) => /^\s*\|[\s:|-]+\|\s*$/.test(line);

// ---------- sentences ----------

const ABBREVIATIONS = /\b(Dra?|Lic|Art|N[úu]m|No|Sr|Sra|Srita|Ing|Mtro|Mtra|Fracc|etc|Vo|Bo|p[áa]gs?|pp|vs|Av|Col|Tel|Cd|Dir|Prof|Gral|Fig|S\.A|C\.V|A\.C|S\.C|A\.P)\./g;

/**
 * Splits a paragraph into sentences on . ! ? … followed by an uppercase letter, opening mark or digit. Spanish
 * abbreviations ("Dra.", "Art.", "S.A.") would look like sentence ends, so their dots are swapped for a placeholder
 * character before the split and restored afterwards.
 */
export function splitSentences(paragraph: string): string[] {
  const protectedText = paragraph.replace(ABBREVIATIONS, m => m.slice(0, -1) + '\u0001');
  return protectedText
    .split(/(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÑ¿¡"“(\[0-9])/)
    .map(s => s.replace(/\u0001/g, '.').trim())
    .filter(Boolean);
}

/**
 * Merges very short sentences into the previous one so every atom carries enough meaning to embed (a 10-character atom produces a noisy vector).
 */
function mergeShort(sentences: string[], minLen = 40): string[] {
  const out: string[] = [];
  for (const s of sentences) {
    if (out.length && (s.length < minLen || out[out.length - 1].length < minLen)) out[out.length - 1] += ' ' + s;
    else out.push(s);
  }
  return out;
}

// ---------- parsing ----------

/**
 * Step 1-2 of chunking: turns blocks of text into sections made of atoms.
 *
 * A single pass over the lines keeps one "open paragraph". A blank line closes it; a heading closes it and opens a new
 * section whose `path` is the heading stack (["Title", "Chapter", "Article"]); a list item starts its own atom (steps and
 * requirements stay whole); table rows are gathered into one table atom; other lines are joined into a paragraph that is
 * then split into sentences. PDF pages do not close paragraphs, because text often continues on the next page. The `para`
 * number records which atoms came from the same paragraph so they can be re-joined with a space instead of a newline.
 */
export function parseSections(blocks: Block[]): Section[] {
  const sections: Section[] = [{ path: [], atoms: [] }];
  const stack: { level: number; title: string }[] = [];
  let para = 0;

  let paragraph: { lines: string[]; page?: number; kind: 'text' | 'item' | 'table' } | null = null;

  const current = () => sections[sections.length - 1];
  const flush = () => {
    if (!paragraph) return;
    const text = paragraph.lines.join(paragraph.kind === 'table' ? '\n' : ' ').replace(/[ \t]+/g, ' ').trim();
    const page = paragraph.page;
    if (text) {
      para++;
      if (paragraph.kind === 'text') {
        for (const s of mergeShort(splitSentences(text))) current().atoms.push({ text: s, page, kind: 'sentence', para });
      } else {
        current().atoms.push({ text, page, kind: paragraph.kind === 'table' ? 'table' : 'item', para });
      }
    }
    paragraph = null;
  };

  const openSection = (h: Heading) => {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    stack.push({ level: h.level, title: h.title });
    sections.push({ path: stack.map(s => s.title), atoms: [] });
  };

  for (const block of blocks) {
    for (const rawLine of block.text.split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      if (!line.trim()) {
        flush();
        continue;
      }
      if (isTableRule(line)) continue;
      if (isTableRow(line)) {
        if (paragraph?.kind !== 'table') {
          flush();
          paragraph = { lines: [], page: block.page, kind: 'table' };
        }
        paragraph!.lines.push(line.trim());
        continue;
      }
      const heading = detectHeading(line);
      if (heading) {
        flush();
        openSection(heading);
        if (heading.rest) paragraph = { lines: [heading.rest], page: block.page, kind: 'text' };
        continue;
      }
      if (ITEM_RE.test(line)) {
        flush();
        paragraph = { lines: [line.trim()], page: block.page, kind: 'item' };
        continue;
      }
      // continuation of the current paragraph / item, or a new paragraph
      if (!paragraph || paragraph.kind === 'table') {
        flush();
        paragraph = { lines: [], page: block.page, kind: 'text' };
      }
      paragraph.lines.push(line.trim());
    }
    // PDF pages do not end paragraphs: text may continue on the next page.
    if (block.page === undefined) flush();
  }
  flush();

  return mergeTinySections(sections.filter(s => s.atoms.length > 0 || s.path.length > 0));
}

const bodyChars = (s: Section) => s.atoms.reduce((n, a) => n + a.text.length, 0);

/**
 * A heading with almost no body (a one-line article, "CAPÍTULO II") would become a useless chunk, so it is folded into
 * the section that follows, keeping its title as text. When the folded sections are siblings (same depth and parent)
 * the destination is labelled as a range ("ARTICULO 112 – ARTICULO 113") for articles so a citation never points at only
 * the last article.
 */
export function mergeTinySections(sections: Section[]): Section[] {
  const out: Section[] = [];
  let carry: Atom[] = [];
  let carriedPaths: string[][] = [];
  const isTiny = (s: Section) => s.path.length > 0 && bodyChars(s) < TINY_SECTION_CHARS;

  sections.forEach((section, i) => {
    if (isTiny(section) && i < sections.length - 1) {
      carry.push(
        { text: section.path[section.path.length - 1], kind: 'item', para: -1, page: section.atoms[0]?.page },
        ...section.atoms,
      );
      carriedPaths.push(section.path);
      return;
    }
    let path = section.path;
    const first = carriedPaths[0];
    const isArticle = (title: string) => /^art[íi]culo\b/i.test(title);
    if (first && path.length > 0 && isArticle(first[first.length - 1]) && isArticle(path[path.length - 1]) && first.length === path.length && first.slice(0, -1).join('\u0000') === path.slice(0, -1).join('\u0000')) {
      path = [...path.slice(0, -1), `${first[first.length - 1]} – ${path[path.length - 1]}`];
    }
    out.push({ path, atoms: [...carry, ...section.atoms] });
    carry = [];
    carriedPaths = [];
  });
  if (carry.length) out.push({ path: carriedPaths[0] ?? [], atoms: carry });
  return out.filter(s => s.atoms.length > 0);
}

// ---------- semantic breakpoints ----------

/**
 * Component-wise average of vectors; used to summarize a window of atoms as one vector.
 */
function mean(vectors: number[][]): number[] {
  const out = new Array(vectors[0].length).fill(0);
  for (const v of vectors) for (let i = 0; i < v.length; i++) out[i] += v[i];
  return out.map(x => x / vectors.length);
}

/**
 * Cosine similarity of two vectors: 1 = same direction (same topic), 0 = unrelated. Returns 0 for a zero vector instead of NaN.
 */
export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Topic-shift score for the boundary *before* atom i (1..n-1): 1 - cos(mean of the `window` atoms before, mean of the
 * `window` atoms from i on). Index 0 is unused.
 *
 * Why a window and not one sentence: a single sentence is noisy, so comparing the average of 2 atoms on each side
 * gives a smoother signal. A high value means the text on the right talks about something different from the left,
 * which makes the boundary a good place to cut.
 */
export function boundaryDistances(embeddings: number[][], window: number): number[] {
  const n = embeddings.length;
  const dist = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const left = mean(embeddings.slice(Math.max(0, i - window), i));
    const right = mean(embeddings.slice(i, Math.min(n, i + window)));
    dist[i] = 1 - cosine(left, right);
  }
  return dist;
}

/**
 * Value below which a share `p` of the numbers fall. It turns 'distance' scores into a relative threshold (top 15% of shifts) that works for any document.
 */
export function percentile(values: number[], p: number): number {
  if (!values.length) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

// ---------- packing ----------

/**
 * Splits an atom larger than `max` (a long list item, a table) so no chunk blows past the limit. Tables are split by
 * rows and every piece repeats the header row, so each part is still readable on its own. Text is cut at the last
 * space before the limit (or at the limit itself if there is no space in the second half).
 */
export function splitOversize(atom: Atom, max: number): Atom[] {
  if (atom.text.length <= max) return [atom];
  if (atom.kind === 'table') {
    const rows = atom.text.split('\n');
    const header = rows.slice(0, 1);
    const out: Atom[] = [];
    let cur = [...header];
    for (const row of rows.slice(1)) {
      if (cur.join('\n').length + row.length > max && cur.length > header.length) {
        out.push({ ...atom, text: cur.join('\n') });
        cur = [...header];
      }
      cur.push(row);
    }
    out.push({ ...atom, text: cur.join('\n') });
    return out;
  }
  const out: Atom[] = [];
  let rest = atom.text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    out.push({ ...atom, text: rest.slice(0, cut).trim() });
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push({ ...atom, text: rest });
  return out;
}

/**
 * Re-assembles atoms into text: a space between atoms from the same paragraph, a newline between paragraphs.
 */
function join(atoms: Atom[]): string {
  let text = '';
  atoms.forEach((a, i) => {
    if (i > 0) text += a.para === atoms[i - 1].para ? ' ' : '\n';
    text += a.text;
  });
  return text;
}

/**
 * Step 4: packs a section's atoms into chunks of roughly minChars-maxChars.
 *
 * Rules, in order: never exceed `maxChars` (close the chunk before the atom that would overflow it); close at a semantic
 * breakpoint once the chunk has at least `minChars`; never cross a section boundary (each call handles one section).
 * A last group that is a runt (tiny, or small enough to fit in the previous one) is folded into the previous chunk, and
 * fragments under 20 characters (page furniture) are dropped. Each chunk gets its breadcrumb ("Title › Section"), which
 * is embedded and indexed with the text but not shown to the user, plus its first and last page.
 *
 * Further reading:
 * - Anthropic, "Contextual Retrieval" (prepending context to each chunk before embedding and indexing): https://www.anthropic.com/news/contextual-retrieval
 */
export function packSection(
  section: Section,
  breaks: Set<number>, // indexes into section.atoms where a semantic breakpoint sits *before* the atom
  title: string,
  opts: Required<Pick<ChunkOptions, 'minChars' | 'maxChars'>>,
): Chunk[] {
  const groups: Atom[][] = [];
  let cur: Atom[] = [];
  let size = 0;
  const close = () => {
    if (cur.length) groups.push(cur);
    cur = [];
    size = 0;
  };

  section.atoms.forEach((atom, i) => {
    const pieces = splitOversize(atom, opts.maxChars);
    pieces.forEach((piece, j) => {
      const atBreak = j === 0 && breaks.has(i);
      if (cur.length && (size + piece.text.length > opts.maxChars || (atBreak && size >= opts.minChars))) close();
      cur.push(piece);
      size += piece.text.length + 1;
    });
  });
  close();

  // fold a runt last group into the previous one: always when tiny, or when it still fits comfortably
  if (groups.length > 1) {
    const last = groups[groups.length - 1];
    const lastSize = join(last).length;
    const prevSize = join(groups[groups.length - 2]).length;
    if (lastSize < RUNT_CHARS || (lastSize < opts.minChars / 2 && prevSize + lastSize <= opts.maxChars * 1.25)) {
      groups.splice(groups.length - 2, 2, [...groups[groups.length - 2], ...last]);
    }
  }

  const sectionName = section.path.join(' › ');
  const context = [title, ...section.path].filter(Boolean).join(' › ');
  return groups.filter(atoms => join(atoms).length >= MIN_CHUNK_CHARS).map(atoms => {
    const pages = atoms.map(a => a.page).filter((p): p is number => p !== undefined);
    return {
      text: join(atoms),
      context,
      section: sectionName,
      page: pages[0],
      pageEnd: pages.length ? pages[pages.length - 1] : undefined,
    };
  });
}

/**
 * Entry point of the chunker: blocks in, chunks out.
 *
 * 1. `parseSections` builds sections and atoms from the headings and the layout.
 * 2. If an `embed` function was given, all atoms are embedded in one call, and each section's boundary distances are
 *    computed. A single global threshold (the 85th percentile of all shifts) picks the breakpoints, so a chunk is cut where
 *    the topic really changes and not at a fixed size.
 * 3. `packSection` builds the chunks. Without `embed` (the `--no-semantic` flag, or a dry run) only the structure is used.
 */
export async function chunkDocument(blocks: Block[], options: ChunkOptions): Promise<Chunk[]> {
  const opts = { ...DEFAULTS, ...options };
  const sections = parseSections(blocks);

  // Semantic breakpoints: embed every atom once, score boundaries inside each section, pick a global threshold.
  const breaksBySection: Set<number>[] = sections.map(() => new Set<number>());
  if (options.embed) {
    const flat = sections.flatMap(s => s.atoms.map(a => a.text));
    if (flat.length > 1) {
      const embeddings = await options.embed(flat);
      const perSection: number[][] = [];
      let offset = 0;
      for (const section of sections) {
        const d = boundaryDistances(embeddings.slice(offset, offset + section.atoms.length), opts.window);
        perSection.push(d);
        offset += section.atoms.length;
      }
      const threshold = percentile(perSection.flatMap(d => d.slice(1)), opts.breakpointPercentile);
      perSection.forEach((d, s) => d.forEach((value, i) => i > 0 && value > threshold && breaksBySection[s].add(i)));
    }
  }

  return sections.flatMap((section, i) => packSection(section, breaksBySection[i], opts.title, opts));
}
