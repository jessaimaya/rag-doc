import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  auroc,
  bestThreshold,
  firstRelevantRank,
  isRelevant,
  isUnanswerable,
  median,
  summarizeRanks,
  type EvalQuestion,
  type QuestionTag,
} from '../rag/metrics';
import { hybridSearch, type SearchMode } from '../rag/retriever';
import { closePool, loadAllChunks } from '../rag/store';
import { embed } from '../rag/voyage';

/**
 * Retrieval evals over evals/questions.json.
 *
 *   npm run eval              run all six configurations and write evals/results/latest.{md,json}
 *   npm run eval -- --check   only validate the dataset against the index (no API calls)
 *   npm run eval -- --only hybrid+rerank,vector   run a subset of configurations
 *   npm run eval -- --rrf-weights 2,1             weight vector:BM25 in the RRF fusion (hybrid configs are renamed hybrid[2:1])
 *
 * A retrieved chunk is relevant when it comes from the judged document and contains every `mustContain` phrase
 * (accent/case-insensitive, breadcrumb + text), so judgments survive re-chunking.
 */

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const onlyArg = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
const weightsArg = args.includes('--rrf-weights') ? args[args.indexOf('--rrf-weights') + 1] : undefined;
const rrfWeights = weightsArg ? (weightsArg.split(',').map(Number) as [number, number]) : undefined;
const TOP_K = 10;
const POOL = 30;

interface Config {
  name: string;
  mode: SearchMode;
  rerank: boolean;
}

const hybridName = rrfWeights ? `hybrid[${rrfWeights.join(':')}]` : 'hybrid';
const ALL_CONFIGS: Config[] = [
  { name: 'vector', mode: 'vector', rerank: false },
  { name: 'bm25', mode: 'bm25', rerank: false },
  { name: hybridName, mode: 'hybrid', rerank: false },
  { name: 'vector+rerank', mode: 'vector', rerank: true },
  { name: 'bm25+rerank', mode: 'bm25', rerank: true },
  { name: `${hybridName}+rerank`, mode: 'hybrid', rerank: true },
];

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const fmt = (x: number) => (Number.isNaN(x) ? '–' : x.toFixed(3));

async function main() {
  const questions: EvalQuestion[] = JSON.parse(fs.readFileSync(path.resolve('evals/questions.json'), 'utf8'));
  const chunks = await loadAllChunks();
  if (!chunks.length) throw new Error('The index is empty. Run `npm run ingest` first.');

  // Dataset sanity: every in-scope question needs at least one relevant chunk in the index.
  const inScope = questions.filter(q => !isUnanswerable(q));
  const outScope = questions.filter(isUnanswerable);
  const broken = inScope.filter(q => !chunks.some(c => isRelevant(q, c)));
  console.log(`📋 ${questions.length} questions (${inScope.length} answerable, ${outScope.length} unanswerable), ${chunks.length} chunks indexed`);
  for (const q of inScope) {
    const n = chunks.filter(c => isRelevant(q, c)).length;
    if (n === 0) console.error(`   ❌ ${q.id}: no chunk matches its judgments`);
    else if (n > 8) console.warn(`   ⚠️  ${q.id}: ${n} chunks match, the judgment may be too loose`);
  }
  if (broken.length) throw new Error(`${broken.length} question(s) have no relevant chunk; fix evals/questions.json`);
  if (checkOnly) return console.log('✅ dataset is consistent with the index');

  const configs = onlyArg ? ALL_CONFIGS.filter(c => onlyArg.split(',').includes(c.name)) : ALL_CONFIGS;
  const embeddings = await embed(questions.map(q => q.question), 'query');

  const results: Record<string, { ranks: Map<string, number | undefined>; latencies: number[]; top1: Map<string, number> }> = {};
  for (const config of configs) {
    process.stdout.write(`▶ ${config.name} `);
    const run = { ranks: new Map<string, number | undefined>(), latencies: [] as number[], top1: new Map<string, number>() };
    for (const [i, q] of questions.entries()) {
      const started = performance.now();
      const hits = await hybridSearch(q.question, {
        topK: TOP_K,
        mode: config.mode,
        rerank: config.rerank,
        rerankPool: POOL,
        candidates: POOL,
        queryEmbedding: embeddings[i],
        rrfWeights,
      });
      run.latencies.push(performance.now() - started);
      // For rerank configs only the rerank score is comparable across questions; no candidates at all counts as 0.
      run.top1.set(q.id, config.rerank ? (hits[0]?.debug.rerank ?? 0) : (hits[0]?.score ?? 0));
      if (!isUnanswerable(q)) run.ranks.set(q.id, firstRelevantRank(q, hits.map(h => h.chunk)));
      process.stdout.write('.');
    }
    results[config.name] = run;
    console.log();
  }

  // ---- report ----
  const tags: QuestionTag[] = ['semantic', 'lexical', 'exact'];
  const lines: string[] = [];
  const table = (title: string, subset: EvalQuestion[]) => {
    lines.push(`### ${title} (n=${subset.length})`, '', '| config | Hit@1 | Hit@3 | Hit@5 | MRR@10 | p50 latency |', '|---|---|---|---|---|---|');
    for (const c of configs) {
      const r = results[c.name];
      const s = summarizeRanks(subset.map(q => r.ranks.get(q.id)));
      lines.push(`| ${c.name} | ${pct(s.hitAt[1])} | ${pct(s.hitAt[3])} | ${pct(s.hitAt[5])} | ${fmt(s.mrr)} | ${Math.round(median(r.latencies))} ms |`);
    }
    lines.push('');
  };
  lines.push(`# Retrieval eval — ${new Date().toISOString().slice(0, 10)}`, '', `${inScope.length} answerable questions (+${outScope.length} unanswerable), ${chunks.length} chunks. Relevant = right document + all \`mustContain\` phrases. Rerank pool ${POOL}, top ${TOP_K}.`, '');
  table('All in-scope questions', inScope);
  for (const tag of tags) table(`Tag: ${tag}`, inScope.filter(q => q.tag === tag));

  const misses = configs.map(c => ({ c, missed: inScope.filter(q => (results[c.name].ranks.get(q.id) ?? 99) > 5).map(q => q.id) }));
  lines.push('### Questions missed at top 5', '');
  for (const { c, missed } of misses) lines.push(`- **${c.name}**: ${missed.length ? missed.join(', ') : 'none'}`);
  lines.push('');

  const rerankConfigs = configs.filter(c => c.rerank);
  if (rerankConfigs.length && outScope.length) {
    lines.push('### Can the rerank score tell answerable from unanswerable questions?', '', 'Top-1 rerank score on answerable vs unanswerable questions (out-of-scope and near-miss). AUROC 1.0 = perfect separation, 0.5 = chance.', '', '| config | answerable min | answerable median | unanswerable median | unanswerable max | AUROC | best cutoff (accuracy) |', '|---|---|---|---|---|---|---|');
    for (const c of rerankConfigs) {
      const r = results[c.name];
      const pos = inScope.map(q => r.top1.get(q.id) ?? 0);
      const neg = outScope.map(q => r.top1.get(q.id) ?? 0);
      const best = bestThreshold(pos, neg);
      lines.push(`| ${c.name} | ${fmt(Math.min(...pos))} | ${fmt(median(pos))} | ${fmt(median(neg))} | ${fmt(Math.max(...neg))} | ${fmt(auroc(pos, neg))} | ${fmt(best.threshold)} (${pct(best.accuracy)}) |`);
    }
    lines.push('');
  }
  lines.push('_Small sample: differences of one or two questions are within noise._', '');

  const report = lines.join('\n');
  console.log('\n' + report);
  fs.mkdirSync('evals/results', { recursive: true });
  const suffix = rrfWeights ? `-rrf-${rrfWeights.join('-')}` : '';
  fs.writeFileSync(`evals/results/latest${suffix}.md`, report);
  fs.writeFileSync(
    `evals/results/latest${suffix}.json`,
    JSON.stringify(
      Object.fromEntries(configs.map(c => [c.name, { ranks: Object.fromEntries(results[c.name].ranks), top1: Object.fromEntries(results[c.name].top1) }])),
      null,
      2,
    ),
  );
}

main()
  .catch(err => {
    console.error('❌', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closePool);
