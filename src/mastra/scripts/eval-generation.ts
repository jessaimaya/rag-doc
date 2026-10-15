import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { insuranceAgent } from '../agents/insurance-agent';
import { judgeAnswer, type Judgment } from '../rag/judge';
import { fabricatedCitations, isRelevant, isUnanswerable, mean, type EvalQuestion, type RetrievedRef } from '../rag/metrics';
import { closePool, loadAllChunks, type StoredChunk } from '../rag/store';

/**
 * Generation evals: run each question through the real agent (retrieval + tool + answer) and judge the answer.
 *
 *   npm run eval:generation                 one pass with the default relevance cutoff
 *   npm run eval:generation -- --compare    two passes: cutoff off (0) vs on (0.6), to measure what the cutoff buys
 *   npm run eval:generation -- --only faq-sabado,oos-francia --concurrency 2
 *   npm run eval:generation -- --out generation-v2   write evals/results/generation-v2.{md,json} (to keep a baseline)
 *
 * Per answer: an LLM judge (EVAL_JUDGE_MODEL, default claude-haiku-5-5 to keep runs cheap) lists the claims and whether the retrieved
 * passages support them, whether the agent declined, and, for answerable questions, whether the answer is correct
 * against the gold passage. Fabricated page numbers and URLs are detected without an LLM.
 */

const args = process.argv.slice(2);
const flagValue = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const compare = args.includes('--compare');
const only = flagValue('only')?.split(',');
const outName = flagValue('out') ?? 'generation';
const concurrency = Number(flagValue('concurrency') ?? 4);
const cutoffs = compare ? [0, 0.6] : [Number(flagValue('cutoff') ?? process.env.RAG_MIN_RELEVANCE ?? 0.6)];

interface RetrievedResult extends Partial<RetrievedRef> {
  title: string;
  section?: string | null;
  text: string;
}

interface Row {
  id: string;
  tag: string;
  unanswerable: boolean;
  question: string;
  answer: string;
  toolCalls: number;
  retrieved: RetrievedResult[];
  retrievedRelevant: boolean | null; // answerable questions only
  judgment?: Judgment;
  fabricated: { pages: number[]; urls: string[] };
  error?: string;
}

const pct = (x: number) => (Number.isNaN(x) ? '–' : `${(x * 100).toFixed(0)}%`);

async function pool<T, R>(items: T[], size: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

async function runPass(questions: EvalQuestion[], chunks: StoredChunk[], cutoff: number): Promise<Row[]> {
  process.env.RAG_MIN_RELEVANCE = String(cutoff);
  const titleToDoc = new Map(chunks.map(c => [c.title, c.docId]));
  let done = 0;

  return pool(questions, concurrency, async q => {
    const row: Row = {
      id: q.id,
      tag: q.tag,
      unanswerable: isUnanswerable(q),
      question: q.question,
      answer: '',
      toolCalls: 0,
      retrieved: [],
      retrievedRelevant: null,
      fabricated: { pages: [], urls: [] },
    };
    try {
      const res: any = await insuranceAgent.generate([{ role: 'user', content: q.question }]);
      row.answer = res.text ?? '';
      const toolResults: any[] = res.toolResults ?? [];
      row.toolCalls = toolResults.length;
      row.retrieved = toolResults.flatMap(t => t.payload?.result?.results ?? []);
      if (!row.unanswerable) {
        row.retrievedRelevant = row.retrieved.some(r =>
          isRelevant(q, { docId: titleToDoc.get(r.title) ?? '', context: r.section ?? '', text: r.text }),
        );
      }
      row.fabricated = fabricatedCitations(row.answer, row.retrieved.map(r => ({ page: r.page ?? null, sourceUrl: r.sourceUrl ?? null })));

      const gold = row.unanswerable ? [] : chunks.filter(c => isRelevant(q, c)).slice(0, 3).map(c => `${c.context}\n${c.text}`.slice(0, 1500));
      row.judgment = await judgeAnswer({
        question: q.question,
        // The judge sees the same metadata the agent was given (page, URL), so citing it is not an "unsupported claim".
        retrieved: row.retrieved.map(r => `${r.title}${r.section ? ` › ${r.section}` : ''}${r.page ? ` (p. ${r.page})` : ''}${r.sourceUrl ? ` <${r.sourceUrl}>` : ''}\n${r.text}`),
        gold,
        answer: row.answer,
      });
    } catch (err) {
      row.error = err instanceof Error ? err.message : String(err);
    }
    process.stdout.write(`\r  cutoff ${cutoff}: ${++done}/${questions.length}`);
    return row;
  });
}

/** The right behaviour for an unanswerable question: say the information is missing. */
const admits = (r: Row) => r.judgment!.declined || r.judgment!.admitsMissing;
/** ...and do not invent anything while doing so. */
const handled = (r: Row) => admits(r) && r.judgment!.claims.every(c => c.supported);

function summarize(rows: Row[]) {
  const ok = rows.filter(r => r.judgment && !r.error);
  const answerable = ok.filter(r => !r.unanswerable);
  const unanswerable = ok.filter(r => r.unanswerable);
  const claims = (rs: Row[]) => rs.flatMap(r => r.judgment!.claims);
  const unsupportedShare = (rs: Row[]) => rs.filter(r => r.judgment!.claims.some(c => !c.supported)).length / (rs.length || NaN);
  const supported = (rs: Row[]) => claims(rs).filter(c => c.supported).length / (claims(rs).length || NaN);
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

async function main() {
  const all: EvalQuestion[] = JSON.parse(fs.readFileSync(path.resolve('evals/questions.json'), 'utf8'));
  const questions = only ? all.filter(q => only.includes(q.id)) : all;
  const chunks = await loadAllChunks();
  console.log(`🧪 ${questions.length} questions × ${cutoffs.length} pass(es), judge ${process.env.EVAL_JUDGE_MODEL || 'claude-haiku-5-5'}`);

  const passes: { cutoff: number; rows: Row[]; summary: ReturnType<typeof summarize> }[] = [];
  for (const cutoff of cutoffs) {
    const rows = await runPass(questions, chunks, cutoff);
    console.log();
    passes.push({ cutoff, rows, summary: summarize(rows) });
  }

  const L: string[] = [`# Generation eval — ${new Date().toISOString().slice(0, 10)}`, ''];
  L.push(`${questions.length} questions through the real agent (retrieval → tool → answer), judged by ${process.env.EVAL_JUDGE_MODEL || 'claude-haiku-5-5'}. Cutoff = minimum rerank score of the best result; below it the tool returns "no relevant documents".`, '');
  const cols = passes.map(p => `cutoff ${p.cutoff}`);
  const row = (label: string, f: (s: ReturnType<typeof summarize>) => string) => `| ${label} | ${passes.map(p => f(p.summary)).join(' | ')} |`;
  L.push(`### Answerable questions (n=${passes[0].summary.answerable.n})`, '', `| metric | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---').join('|')}|`);
  L.push(
    row('agent called the tool', s => pct(s.answerable.toolCalled)),
    row('relevant passage retrieved', s => pct(s.answerable.retrievedRelevant)),
    row('**answer correct**', s => pct(s.answerable.correct)),
    row('answer partial', s => pct(s.answerable.partial)),
    row('answer incorrect', s => pct(s.answerable.incorrect)),
    row('false refusal (declined but answerable)', s => pct(s.answerable.falseRefusal)),
    row('**faithfulness** (supported claims / claims)', s => pct(s.answerable.faithfulness)),
    row('answers with ≥1 unsupported claim', s => pct(s.answerable.withUnsupported)),
    row('answers citing a page/URL that was not retrieved', s => pct(s.answerable.fabricatedCitation)),
    '',
  );
  L.push(`### Unanswerable questions (n=${passes[0].summary.unanswerable.n}: out of scope + near miss)`, '', `| metric | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---').join('|')}|`);
  L.push(
    row('**handled correctly** (says it is missing, invents nothing)', s => pct(s.unanswerable.handled)),
    row('  out of scope', s => pct(s.unanswerable.byTag.out_of_scope.handled)),
    row('  near miss (on topic, answer absent)', s => pct(s.unanswerable.byTag.near_miss.handled)),
    row('admits the information is missing', s => pct(s.unanswerable.admitsMissing)),
    row('answers with ≥1 unsupported claim', s => pct(s.unanswerable.withUnsupported)),
    '',
  );
  if (passes.some(p => p.summary.errors)) L.push(`> ${passes.map(p => `cutoff ${p.cutoff}: ${p.summary.errors} errored`).join('; ')}`, '');

  const last = passes[passes.length - 1];
  L.push(`### Problem cases (cutoff ${last.cutoff})`, '');
  for (const r of last.rows) {
    const j = r.judgment;
    const problems: string[] = [];
    if (r.error) problems.push(`error: ${r.error.slice(0, 120)}`);
    else if (j) {
      if (!r.unanswerable && j.correctness !== 'correct') problems.push(`${j.correctness}${j.declined ? ' (declined)' : ''}`);
      if (r.unanswerable && !(j.declined || j.admitsMissing)) problems.push('did not admit the information is missing');
      const bad = j.claims.filter(c => !c.supported);
      if (bad.length) problems.push(`${bad.length} unsupported claim(s): ${bad.slice(0, 2).map(c => `“${c.claim.slice(0, 90)}”`).join('; ')}`);
      if (r.fabricated.pages.length || r.fabricated.urls.length) problems.push(`fabricated citation: ${[...r.fabricated.pages.map(p => `p.${p}`), ...r.fabricated.urls].join(', ')}`);
    }
    if (problems.length) L.push(`- **${r.id}** — ${problems.join(' · ')}${j ? ` — _${j.reason}_` : ''}`);
  }
  L.push('', '_Single sample per question at the model\'s default sampling, judged by one LLM: expect a few points of run-to-run noise._', '');

  fs.mkdirSync('evals/results', { recursive: true });
  fs.writeFileSync(`evals/results/${outName}.md`, L.join('\n'));
  fs.writeFileSync(`evals/results/${outName}.json`, JSON.stringify(passes.map(p => ({ cutoff: p.cutoff, summary: p.summary, rows: p.rows })), null, 2));
  console.log('\n' + L.join('\n'));
}

main()
  .catch(err => {
    console.error('❌', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closePool);
