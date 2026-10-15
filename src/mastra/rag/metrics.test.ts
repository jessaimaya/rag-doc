import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auroc, bestThreshold, firstRelevantRank, isRelevant, median, normalize, summarizeRanks, type EvalQuestion } from './metrics';

const question: EvalQuestion = {
  id: 'q',
  question: '¿Cuánto cuesta?',
  tag: 'lexical',
  relevant: [
    { doc: 'faq', mustContain: ['Consulta de primera vez', '$900'] },
    { doc: 'other', mustContain: ['precio'] },
  ],
};
const chunk = (docId: string, text: string, context = '') => ({ docId, context, text });

test('normalize folds accents, case and whitespace', () => {
  assert.equal(normalize('  Sábado\n  9:00  A 14:00 '), 'sabado 9:00 a 14:00');
});

test('isRelevant needs the right document and every phrase, ignoring accents and case', () => {
  assert.ok(isRelevant(question, chunk('faq', '| consulta de PRIMERA vez | $900 |')));
  assert.ok(!isRelevant(question, chunk('faq', 'Consulta de primera vez cuesta poco')), 'missing $900');
  assert.ok(!isRelevant(question, chunk('other-doc', 'Consulta de primera vez $900')), 'wrong document');
  assert.ok(isRelevant(question, chunk('other', 'x', 'Lista de Precio')), 'alternative judgment, matched through the breadcrumb');
});

test('firstRelevantRank is 1-based and undefined when nothing matches', () => {
  const list = [chunk('faq', 'nada'), chunk('faq', 'Consulta de primera vez $900'), chunk('faq', 'Consulta de primera vez $900')];
  assert.equal(firstRelevantRank(question, list), 2);
  assert.equal(firstRelevantRank(question, [chunk('faq', 'nada')]), undefined);
});

test('summarizeRanks computes Hit@k and MRR with a cutoff', () => {
  const s = summarizeRanks([1, 2, 5, undefined, 20]);
  assert.equal(s.n, 5);
  assert.equal(s.hitAt[1], 0.2);
  assert.equal(s.hitAt[3], 0.4);
  assert.equal(s.hitAt[5], 0.6);
  assert.ok(Math.abs(s.mrr - (1 + 0.5 + 0.2) / 5) < 1e-9); // rank 20 is beyond the MRR@10 cutoff
});

test('median handles odd and even lengths', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test('auroc is 1 for perfect separation, 0.5 for ties', () => {
  assert.equal(auroc([0.9, 0.8], [0.2, 0.1]), 1);
  assert.equal(auroc([0.5], [0.5]), 0.5);
  assert.ok(Number.isNaN(auroc([], [0.1])));
});

test('bestThreshold finds the cutoff that separates the two groups', () => {
  const { threshold, accuracy } = bestThreshold([0.9, 0.8, 0.7], [0.5, 0.4]);
  assert.equal(threshold, 0.7);
  assert.equal(accuracy, 1);
});
