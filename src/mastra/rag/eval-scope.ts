import * as fs from 'fs';
import * as path from 'path';
import type { EvalQuestion } from './metrics';
import { slugify } from './manifest';

/**
 * Some documents are listed in the manifest with `skip: true` (for example, files that cannot be redistributed).
 * Questions whose judgments point at such a document cannot be answered from a fresh clone, so the evals leave them out
 * and say so. This returns the ids (same slug as ingestion) of the skipped documents. A judgment pointing at an unknown
 * document is still an error, so typos keep failing loudly.
 */
export function skippedDocIds(entries: { file?: string; skip?: boolean }[]): Set<string> {
  return new Set(entries.filter(e => e.skip && e.file).map(e => slugify(e.file!)));
}

/**
 * Splits the questions into the ones the public corpus can answer and the ones that depend on a skipped document.
 */
export function splitByCorpus(questions: EvalQuestion[], skipped: Set<string>): { runnable: EvalQuestion[]; skipped: EvalQuestion[] } {
  const isSkipped = (q: EvalQuestion) => q.relevant.some(r => skipped.has(r.doc));
  return { runnable: questions.filter(q => !isSkipped(q)), skipped: questions.filter(isSkipped) };
}

/**
 * Reads evals/questions.json and documents/manifest.json (relative to the working directory), applies the split and prints which questions were left out.
 */
export function loadEvalQuestions(): { runnable: EvalQuestion[]; skipped: EvalQuestion[] } {
  const questions: EvalQuestion[] = JSON.parse(fs.readFileSync(path.resolve('evals/questions.json'), 'utf8'));
  const manifestPath = path.resolve('documents/manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : [];
  const split = splitByCorpus(questions, skippedDocIds(manifest));
  if (split.skipped.length) {
    console.log(`Skipping ${split.skipped.length} question(s) whose documents are not in the public corpus: ${split.skipped.map(q => q.id).join(', ')}`);
  }
  return split;
}
