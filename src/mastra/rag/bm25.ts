/** In-memory Okapi BM25 with Spanish-aware tokenization. Fine for corpora up to tens of thousands of chunks. */

/**
 * Very common Spanish words (articles, prepositions, pronouns) that carry no topic. Dropping them keeps them out of the
 * index, so a query like "qué necesito para una incapacidad" is scored on "necesito" and "incapacidad" only.
 * The list is written without accents because it is compared against already-folded text.
 */
const STOPWORDS = new Set(
  `a al algo ante con contra cual cuando de del desde donde el ella ellos en entre era es esa ese eso esta este esto
  fue ha han hay la las le les lo los me mi muy ni no nos o para pero por que se sea ser si sin sobre son su sus te
  tu un una uno unos unas y ya como mas mis tambien`.split(/\s+/),
);

/**
 * Normalizes text for matching: NFD splits "é" into "e" + a combining accent, the regex deletes the accents, and
 * the result is lower-cased. Users type with and without accents, so "trámite" and "tramite" must be the same token.
 *
 * Further reading:
 * - Unicode Standard Annex #15, Normalization Forms (NFD, NFC): https://unicode.org/reports/tr15/
 */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/**
 * Turns text into the list of terms that BM25 counts. Used for both documents and queries, which is what makes them comparable.
 *
 * Steps: fold accents and case, split on anything that is not a letter or digit, drop one-letter tokens and stopwords,
 * apply the light stemmer. Hyphenated codes that contain a digit ("ST-7", "NOM-004-SSA3-2012") also yield one joined
 * token ("st7"): splitting them leaves fragments like "st" that match nothing in particular, and the whole code is
 * exactly what a user types when they look for a form.
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

/**
 * Light Spanish stemmer. It removes the adverb ending "-mente", a plural "s" and one final vowel, so trámite/trámites
 * and médico/médica/médicos collapse to the same stem and match each other.
 *
 * Why not a full stemmer: it is a few lines, has no dependency, and over-stemming is harmless here because the vector
 * retriever and the reranker cover for BM25's imprecision. Numbers and short words (<= 4 chars) are left untouched
 * so codes and acronyms keep their identity.
 */
function stem(token: string): string {
  if (/\d/.test(token) || token.length <= 4) return token;
  let t = token.replace(/mente$/, '');
  if (t.length > 3) t = t.replace(/s$/, '');
  if (t.length > 4) t = t.replace(/[aeo]$/, '');
  return t;
}

/**
 * One lexical match: the chunk id and its BM25 score. Scores are only comparable inside one query, which is why the
 * fusion step uses ranks and never these raw values.
 */
export interface Bm25Hit {
  id: string;
  score: number;
}

/**
 * In-memory Okapi BM25 index. It is the "exact words" half of hybrid search: embeddings are good at meaning but can miss
 * a form number, an article number or a rare name, which BM25 finds because the literal term is in the chunk.
 *
 * Structure: an inverted index (`postings`: term -> [chunk, term frequency]) plus each chunk's length. A query only
 * touches the posting lists of its own terms, so search is fast without any database. Rebuilding it for tens of thousands
 * of chunks takes well under a second, which is why the retriever keeps it in memory instead of in Postgres.
 *
 * Further reading:
 * - Introduction to Information Retrieval, "Okapi BM25: a non-binary model" (Stanford): https://nlp.stanford.edu/IR-book/html/htmledition/okapi-bm25-a-non-binary-model-1.html
 */
export class Bm25Index {
  private readonly ids: string[] = [];
  private readonly lengths: number[] = [];
  private readonly postings = new Map<string, [doc: number, tf: number][]>();
  private readonly avgLength: number;

  /**
   * Builds the index in one pass. For every document: tokenize, count how often each term appears (tf) and append
   * [doc, tf] to the term's posting list. `k1` controls how fast repeated terms stop adding score (saturation) and `b` how
   * strongly long documents are penalized; 1.2 and 0.75 are the standard BM25 defaults.
   */
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

  /**
   * Number of indexed chunks. The retriever uses it to return early when the database is empty.
   */
  get size() {
    return this.ids.length;
  }

  /**
   * Scores every chunk that shares at least one term with the query and returns the best `k`.
   *
   * For each query term: idf = ln(1 + (N - df + 0.5) / (df + 0.5)) makes rare terms worth more than common ones, and
   * the term-frequency part tf * (k1 + 1) / (tf + k1 * (1 - b + b * len / avgLen)) rewards repetition with diminishing
   * returns and normalizes by chunk length. A chunk's score is the sum over the query terms. Duplicate query terms are
   * collapsed with a Set so repeating a word does not inflate its weight.
   */
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
