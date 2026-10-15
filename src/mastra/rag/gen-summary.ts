import type { Judgment } from './judge';

/** The fields of one evaluated answer that the summary needs (the eval runner's rows satisfy this). */
export interface SummaryRow {
  tag: string;
  unanswerable: boolean;
  toolCalls: number;
  retrievedRelevant: boolean | null;
  judgment?: Judgment;
  fabricated: { pages: number[]; urls: string[] };
  error?: string;
}

/** The right behaviour for an unanswerable question: say the information is missing. */
const admits = (r: SummaryRow) => r.judgment!.declined || r.judgment!.admitsMissing;
/** ...and do not invent anything while doing so. */
const handled = (r: SummaryRow) => admits(r) && r.judgment!.claims.every(c => c.supported);

export function summarize(rows: SummaryRow[]) {
  const ok = rows.filter(r => r.judgment && !r.error);
  const answerable = ok.filter(r => !r.unanswerable);
  const unanswerable = ok.filter(r => r.unanswerable);
  const claims = (rs: SummaryRow[]) => rs.flatMap(r => r.judgment!.claims);
  const unsupportedShare = (rs: SummaryRow[]) => rs.filter(r => r.judgment!.claims.some(c => !c.supported)).length / (rs.length || NaN);
  const supported = (rs: SummaryRow[]) => claims(rs).filter(c => c.supported).length / (claims(rs).length || NaN);
  return {
    errors: rows.filter(r => r.error).length,
    answerable: {
      n: answerable.length,
      toolCalled: answerable.filter(r => r.toolCalls > 0).length / (answerable.length || NaN),
      retrievedRelevant: answerable.filter(r => r.retrievedRelevant).length / (answerable.length || NaN),
      correct: answerable.filter(r => r.judgment!.correctness === 'correct').length / (answerable.length || NaN),
      partial: answerable.filter(r => r.judgment!.correctness === 'partial').length / (answerable.length || NaN),
      incorrect: answerable.filter(r => r.judgment!.correctness === 'incorrect').length / (answerable.length || NaN),
      falseRefusal: answerable.filter(r => r.judgment!.declined).length / (answerable.length || NaN),
      faithfulness: supported(answerable),
      withUnsupported: unsupportedShare(answerable),
      fabricatedCitation: answerable.filter(r => r.fabricated.pages.length || r.fabricated.urls.length).length / (answerable.length || NaN),
    },
    unanswerable: {
      n: unanswerable.length,
      admitsMissing: unanswerable.filter(admits).length / (unanswerable.length || NaN),
      withUnsupported: unsupportedShare(unanswerable),
      handled: unanswerable.filter(handled).length / (unanswerable.length || NaN),
      byTag: Object.fromEntries(
        ['out_of_scope', 'near_miss'].map(tag => {
          const rs = unanswerable.filter(r => r.tag === tag);
          return [tag, { n: rs.length, handled: rs.filter(handled).length / (rs.length || NaN) }];
        }),
      ),
    },
  };
}


export type GenerationSummary = ReturnType<typeof summarize>;
