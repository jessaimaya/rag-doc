/** In-memory Okapi BM25 with Spanish-aware tokenization. Fine for corpora up to tens of thousands of chunks. */

const STOPWORDS = new Set(
  `a al algo ante con contra cual cuando de del desde donde el ella ellos en entre era es esa ese eso esta este esto
  fue ha han hay la las le les lo los me mi muy ni no nos o para pero por que se sea ser si sin sobre son su sus te
  tu un una uno unos unas y ya como mas mis tambien`.split(/\s+/),
);

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/**
 * Lowercase, strip accents, split on non-alphanumerics, drop stopwords, light Spanish stemming.
 * Hyphenated codes that contain a digit ("ST-7", "NOM-004-SSA3-2012") also yield one joined token
 * ("st7"), because splitting them leaves fragments like "st" that match nothing in particular.
 */
export function tokenize(text: string): string[] {
  const folded = fold(text);
  const parts = folded
    .split(/[^a-z0-9ñ]+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
  const codes = (folded.match(/[a-z0-9ñ]+(?:-[a-z0-9ñ]+)+/g) ?? []).filter(c => /\d/.test(c)).map(c => c.replace(/-/g, ''));
  return [...parts, ...codes];
}

/** Light Spanish stemmer: drop plural "s" and one final vowel, so trámite/trámites and médico/médica/médicos collapse. */
function stem(token: string): string {
  if (/\d/.test(token) || token.length <= 4) return token;
  let t = token.replace(/mente$/, '');
  if (t.length > 3) t = t.replace(/s$/, '');
  if (t.length > 4) t = t.replace(/[aeo]$/, '');
  return t;
}

export interface Bm25Hit {
  id: string;
  score: number;
}

export class Bm25Index {
  private readonly ids: string[] = [];
  private readonly lengths: number[] = [];
  private readonly postings = new Map<string, [doc: number, tf: number][]>();
  private readonly avgLength: number;

  constructor(
    docs: { id: string; text: string }[],
    private readonly k1 = 1.2,
    private readonly b = 0.75,
  ) {
    docs.forEach((doc, i) => {
      const tokens = tokenize(doc.text);
      this.ids.push(doc.id);
      this.lengths.push(tokens.length);
      const counts = new Map<string, number>();
      for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
      for (const [term, tf] of counts) {
        const list = this.postings.get(term);
        if (list) list.push([i, tf]);
        else this.postings.set(term, [[i, tf]]);
      }
    });
    this.avgLength = this.lengths.reduce((a, b) => a + b, 0) / Math.max(1, this.lengths.length);
  }

  get size() {
    return this.ids.length;
  }

  search(query: string, k: number): Bm25Hit[] {
    const n = this.ids.length;
    const scores = new Map<number, number>();
    for (const term of new Set(tokenize(query))) {
      const list = this.postings.get(term);
      if (!list) continue;
      const idf = Math.log(1 + (n - list.length + 0.5) / (list.length + 0.5));
      for (const [doc, tf] of list) {
        const norm = tf + this.k1 * (1 - this.b + (this.b * this.lengths[doc]) / this.avgLength);
        scores.set(doc, (scores.get(doc) ?? 0) + (idf * tf * (this.k1 + 1)) / norm);
      }
    }
    return [...scores]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([doc, score]) => ({ id: this.ids[doc], score }));
  }
}
