import * as fs from 'fs';
import * as path from 'path';
import { summarizeRanks, type EvalQuestion } from '../rag/metrics';

/**
 * Builds the datasets behind the eval dashboard from the saved eval results. No network, no API calls.
 *   npm run dashboard:data   -> evals/dashboard-data/*.json
 */

const root = path.resolve('evals');
const read = <T>(p: string): T => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const text = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const write = (name: string, rows: unknown[]) => {
  fs.mkdirSync(path.join(root, 'dashboard-data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dashboard-data', `${name}.json`), JSON.stringify(rows, null, 1));
  console.log(`${name}.json: ${rows.length} rows`);
};

const questions = read<EvalQuestion[]>('questions.json');
const retrieval = read<Record<string, { ranks: Record<string, number>; top1: Record<string, number> }>>('results/latest.json');
const generation = read<{ cutoff: number; summary: any; rows: any[] }[]>('results/generation.json')[0];

const CONFIGS = ['vector', 'bm25', 'hybrid', 'vector+rerank', 'bm25+rerank', 'hybrid+rerank'] as const;
const slug = (c: string) => c.replace('+', '_');
const LABELS: Record<string, string> = { vector: 'Vector', bm25: 'BM25', hybrid: 'Hybrid (RRF)', 'vector+rerank': 'Vector + rerank', 'bm25+rerank': 'BM25 + rerank', 'hybrid+rerank': 'Hybrid + rerank' };

// ---------- corpus ----------
write('corpus', [
  { doc_id: 'imss-incapacidad-9220-003-329-pdf', short: 'IMSS procedure', title: 'IMSS procedure 9220-003-329 (temporary work disability)', category: 'IMSS', type: 'PDF', pages: 51, chunks: 102, origin: 'public' },
  { doc_id: 'issste-reglamento-servicios-medicos-pdf', short: 'ISSSTE regulation', title: 'ISSSTE medical services regulation', category: 'ISSSTE', type: 'PDF', pages: 19, chunks: 164, origin: 'public' },
  { doc_id: 'metlife-condiciones-gmm-colectivo-pdf', short: 'MetLife terms', title: 'MetLife group major medical expenses terms', category: 'Private insurer', type: 'PDF', pages: 33, chunks: 164, origin: 'public' },
  { doc_id: 'conamed-decalogos-derechos-pdf', short: 'CONAMED rights', title: 'CONAMED patient rights and duties', category: 'Patient rights', type: 'PDF', pages: 62, chunks: 59, origin: 'public' },
  { doc_id: 'clinica-valle-verde-faq-md', short: 'Clinic FAQ (fictional)', title: 'Valle Verde clinic FAQ (fictional)', category: 'Clinic FAQ', type: 'Markdown', pages: 0, chunks: 26, origin: 'fictional' },
  { doc_id: 'guia-tramite-programacion-de-cirugia-pdf', short: 'GNP surgery guide', title: 'GNP surgery scheduling guide', category: 'Hospital procedures', type: 'PDF', pages: 10, chunks: 7, origin: 'public' },
  { doc_id: 'sura-aviso-accidente-enfermedad-pdf', short: 'SURA notice', title: 'SURA accident or illness notice', category: 'Private insurer', type: 'PDF', pages: 2, chunks: 5, origin: 'public' },
  { doc_id: 'gnp-aviso-accidente-pdf', short: 'GNP notice', title: 'GNP accident or illness notice', category: 'Private insurer', type: 'PDF', pages: 2, chunks: 4, origin: 'public' },
]);

// ---------- retrieval summary ----------
const latencyRows = [...text('results/latest.md').matchAll(/^\| (\S+) \| \d+% \| \d+% \| \d+% \| [\d.]+ \| (\d+) ms \|$/gm)];
const p50: Record<string, number> = {};
for (const m of latencyRows) if (!(m[1] in p50)) p50[m[1]] = Number(m[2]);

const answerable = questions.filter(q => q.relevant.length > 0);
const retrievalSummary: unknown[] = [];
for (const config of CONFIGS) {
  for (const tag of ['all', 'semantic', 'lexical', 'exact']) {
    const subset = answerable.filter(q => tag === 'all' || q.tag === tag);
    const s = summarizeRanks(subset.map(q => retrieval[config].ranks[q.id]));
    retrievalSummary.push({ row_id: `${slug(config)}__${tag}`, config: slug(config), label: LABELS[config], tag, n: s.n, hit1: s.hitAt[1], hit3: s.hitAt[3], hit5: s.hitAt[5], mrr10: Number(s.mrr.toFixed(3)), p50_ms: p50[config] ?? null });
  }
}
write('retrieval_summary', retrievalSummary);

// ---------- fusion weights (from the sweep result files) ----------
const sweepRow = (file: string, name: string) => {
  const m = text(file).match(new RegExp(`^\\| ${name.replace(/[[\]+]/g, '\\$&')} \\| (\\d+)% \\| (\\d+)% \\| (\\d+)% \\| ([\\d.]+) \\|`, 'm'));
  if (!m) throw new Error(`${name} not found in ${file}`);
  return { hit1: Number(m[1]) / 100, hit3: Number(m[2]) / 100, hit5: Number(m[3]) / 100, mrr10: Number(m[4]) };
};
const sweep: unknown[] = [];
for (const [weights, file, suffix, id] of [['1:1', 'results/latest.md', '', '1to1'], ['2:1', 'results/latest-rrf-2-1.md', '[2:1]', '2to1'], ['3:1', 'results/latest-rrf-3-1.md', '[3:1]', '3to1']] as const) {
  sweep.push({ row_id: `hybrid_${id}`, label: `Hybrid, vector:BM25 ${weights}`, reranked: false, ...sweepRow(file, `hybrid${suffix}`) });
  sweep.push({ row_id: `hybrid_rerank_${id}`, label: `Hybrid, vector:BM25 ${weights}, reranked`, reranked: true, ...sweepRow(file, `hybrid${suffix}+rerank`) });
}
sweep.push({ row_id: 'vector', label: 'Vector only', reranked: false, ...sweepRow('results/latest.md', 'vector') });
sweep.push({ row_id: 'vector_rerank', label: 'Vector only, reranked', reranked: true, ...sweepRow('results/latest.md', 'vector+rerank') });
write('fusion_sweep', sweep);

// ---------- generation summary ----------
const g = generation.summary;
const metric = (run: any, group: string, key: string, label: string, value: number | null, n: number) => ({ ...run, group, metric: key, label, value, n });
const rows: unknown[] = [];
const push = (run: any, a: any, u: any) => {
  const A = (k: string, l: string, v: number) => rows.push(metric(run, 'answerable', k, l, v, a.n));
  const U = (k: string, l: string, v: number) => rows.push(metric(run, 'unanswerable', k, l, v, u.n));
  A('correct', 'Answer correct', a.correct); A('partial', 'Answer partial', a.partial); A('incorrect', 'Answer incorrect', a.incorrect);
  A('false_refusal', 'Wrongly refused', a.falseRefusal); A('faithfulness', 'Faithfulness (claims supported)', a.faithfulness);
  A('with_unsupported', 'Answers with an unsupported claim', a.withUnsupported); A('fabricated_citation', 'Cited a page or URL never retrieved', a.fabricatedCitation);
  U('handled', 'Handled correctly', u.handled); U('handled_out_of_scope', 'Handled: out of scope', u.byTag.out_of_scope.handled);
  U('handled_near_miss', 'Handled: near miss', u.byTag.near_miss.handled); U('admits_missing', 'Admits the information is missing', u.admitsMissing);
  U('with_unsupported', 'Answers with an unsupported claim', u.withUnsupported);
};
// The two Sonnet-judged passes come from the run log: that run's output file was overwritten by the later Haiku run.
const sonnetNote = 'Sonnet judge; before the judge was shown page/URL metadata';
push({ run: 'sonnet_cutoff_off', run_label: 'Cutoff off', judge: 'Sonnet', cutoff: 0, note: sonnetNote },
  { n: 50, correct: 0.96, partial: 0.02, incorrect: 0.02, falseRefusal: 0, faithfulness: 0.9, withUnsupported: 0.64, fabricatedCitation: 0.02 },
  { n: 13, handled: 0.69, admitsMissing: 1, withUnsupported: 0.31, byTag: { out_of_scope: { handled: 0.86 }, near_miss: { handled: 0.5 } } });
push({ run: 'sonnet_cutoff_on', run_label: 'Cutoff on', judge: 'Sonnet', cutoff: 0.6, note: `${sonnetNote}; 2 questions errored in the judge` },
  { n: 49, correct: 0.98, partial: 0.02, incorrect: 0, falseRefusal: 0, faithfulness: 0.89, withUnsupported: 0.67, fabricatedCitation: 0.02 },
  { n: 12, handled: 0.92, admitsMissing: 1, withUnsupported: 0.08, byTag: { out_of_scope: { handled: 1 }, near_miss: { handled: 0.8 } } });
push({ run: 'haiku_cutoff_on', run_label: 'Cutoff on, cheap judge', judge: 'Haiku', cutoff: 0.6, note: 'Haiku judge; page/URL metadata visible to the judge' }, g.answerable, g.unanswerable);
write('generation_summary', rows);

// ---------- one row per question ----------
const genById = new Map(generation.rows.map((r: any) => [r.id, r]));
const round = (x: number | null | undefined, d = 3) => (x === null || x === undefined ? null : Number(x.toFixed(d)));
const questionRows = questions.map(q => {
  const ans = q.relevant.length > 0;
  const gen: any = genById.get(q.id);
  const j = gen?.judgment;
  const claims: { claim: string; supported: boolean }[] = j?.claims ?? [];
  const sources = (gen?.retrieved ?? []).slice(0, 5).map((r: any) => `${r.title}${r.section ? ` › ${r.section}` : ''}${r.page ? ` (p. ${r.page})` : ''} · score ${r.relevance}`);
  // Top retrieval score: the retrieval eval for most questions; for near misses (added later) the best score the agent saw.
  const nearMissScore = gen?.retrieved?.length ? Math.max(...gen.retrieved.map((r: any) => r.relevance)) : null;
  const top = q.tag === 'near_miss' ? nearMissScore : (retrieval['hybrid+rerank'].top1[q.id] ?? null);
  const row: Record<string, unknown> = { id: q.id, tag: q.tag, group: ans ? 'answerable' : q.tag, question: q.question, expected_doc: [...new Set(q.relevant.map(r => r.doc))].join(', ') };
  for (const c of CONFIGS) row[`rank_${slug(c)}`] = ans ? (retrieval[c].ranks[q.id] ?? null) : null;
  Object.assign(row, {
    top_score: round(top),
    top_score_source: q.tag === 'near_miss' ? (nearMissScore === null ? 'cut off below 0.6 (score not recorded)' : 'generation run') : top === null ? '' : 'retrieval eval',
    gen_correctness: j ? (ans ? j.correctness : 'not applicable') : 'error',
    gen_verdict: !j ? 'error' : ans ? j.correctness : j.admitsMissing || j.declined ? 'admits gap' : 'answered',
    gen_admits_missing: j ? Boolean(j.admitsMissing || j.declined) : null,
    gen_claims: claims.length,
    gen_unsupported: claims.filter(c => !c.supported).length,
    gen_unsupported_text: claims.filter(c => !c.supported).map(c => c.claim).join(' | '),
    gen_fabricated: [...(gen?.fabricated?.pages ?? []).map((p: number) => `p.${p}`), ...(gen?.fabricated?.urls ?? [])].join(', '),
    gen_tool_calls: gen?.toolCalls ?? null,
    gen_sources: sources.join('\n'),
    gen_answer: gen?.answer ?? '',
    gen_reason: j?.reason ?? '',
  });
  return row;
});
write('question_results', questionRows);
