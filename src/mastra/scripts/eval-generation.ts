import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { insuranceAgent } from '../agents/insurance-agent';
import { loadEvalQuestions } from '../rag/eval-scope';
import { judgeAnswer, type Judgment } from '../rag/judge';
import { fabricatedCitations, isRelevant, isUnanswerable, mean, type EvalQuestion, type RetrievedRef } from '../rag/metrics';
import { summarize, type GenerationSummary } from '../rag/gen-summary';
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

/**
 * Runs `fn` over `items` with at most `size` in flight, keeping the results in input order. It limits parallel calls to the LLM so the eval does not hit rate limits.
 */
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

/**
 * Runs every question through the real agent and judges the result, with the given relevance cutoff.
 *
 * For each question: call the agent, read the tool results to know what it retrieved, check whether a relevant passage
 * was among them, detect fabricated page numbers/URLs without an LLM, and ask the judge. The judge sees the same metadata the
 * agent saw (page, URL), so citing it is not penalized. One question failing is recorded in its row and does not stop the pass.
 */
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

/**
 * Runs one pass per cutoff (`--compare` runs 0 and 0.6 to measure what the cutoff buys), then writes a markdown report and a JSON file
 * with the full rows. The report separates answerable questions (correctness, faithfulness, false refusals, fabricated
 * citations) from unanswerable ones (did it admit the information is missing without inventing anything?), and lists the
 * problem cases with the judge's reason.
 *
 * Further reading:
 * - Es et al., "Ragas: Automated Evaluation of Retrieval Augmented Generation": https://arxiv.org/abs/2309.15217
 * - Zheng et al., "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena": https://arxiv.org/abs/2306.05685
 */
async function main() {
  const { runnable: all } = loadEvalQuestions();
  const questions = only ? all.filter(q => only.includes(q.id)) : all;
  const chunks = await loadAllChunks();
  console.log(`${questions.length} questions × ${cutoffs.length} pass(es), judge ${process.env.EVAL_JUDGE_MODEL || 'claude-haiku-5-5'}`);

  const passes: { cutoff: number; rows: Row[]; summary: GenerationSummary }[] = [];
  for (const cutoff of cutoffs) {
    const rows = await runPass(questions, chunks, cutoff);
    console.log();
    passes.push({ cutoff, rows, summary: summarize(rows) });
  }

  const L: string[] = [`# Generation eval — ${new Date().toISOString().slice(0, 10)}`, ''];
  L.push(`${questions.length} questions through the real agent (retrieval → tool → answer), judged by ${process.env.EVAL_JUDGE_MODEL || 'claude-haiku-5-5'}. Cutoff = minimum rerank score of the best result; below it the tool returns "no relevant documents".`, '');
  const cols = passes.map(p => `cutoff ${p.cutoff}`);
  const row = (label: string, f: (s: GenerationSummary) => string) => `| ${label} | ${passes.map(p => f(p.summary)).join(' | ')} |`;
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
    console.error('Error:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closePool);
