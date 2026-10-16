import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skippedDocIds, splitByCorpus } from './eval-scope';
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

import { fabricatedCitations, mean } from './metrics';

test('fabricatedCitations flags pages and URLs that were not retrieved', () => {
  const retrieved = [
    { page: 20, sourceUrl: 'https://imss.gob.mx/a.pdf' },
    { page: null, sourceUrl: null },
  ];
  const ok = fabricatedCitations('Ver sección 5, p. 20 — https://imss.gob.mx/a.pdf.', retrieved);
  assert.deepEqual(ok, { pages: [], urls: [] });
  const bad = fabricatedCitations('Consulta p. 99 y pp. 20-21 en https://otro.example/x', retrieved);
  assert.deepEqual(bad.pages.sort(), [21, 99]);
  assert.deepEqual(bad.urls, ['https://otro.example/x']);
});

test('fabricatedCitations does not mistake a postal code (C.P. 00000) for a page', () => {
  assert.deepEqual(fabricatedCitations('Calle Ejemplo 123, C.P. 00000, Ciudad de México. Ver p. 12.', [{ page: 12, sourceUrl: null }]), { pages: [], urls: [] });
});

test('mean of nothing is NaN, not 0', () => {
  assert.ok(Number.isNaN(mean([])));
  assert.equal(mean([1, 2, 3]), 2);
});

import { firstJsonObject, parseJudgment } from './judge';

test('parseJudgment accepts fenced JSON and rejects invalid shapes', () => {
  const ok = parseJudgment('```json\n{"claims":[{"claim":"a","supported":true}],"declined":false,"admitsMissing":false,"correctness":"correct","reason":"ok"}\n```');
  assert.equal(ok.claims.length, 1);
  assert.throws(() => parseJudgment('no json here'));
  assert.throws(() => parseJudgment('{"claims":[],"declined":false,"admitsMissing":false,"correctness":"great","reason":"x"}'));
});

test('firstJsonObject ignores trailing prose, a second object and braces inside strings', () => {
  assert.equal(firstJsonObject('x {"a":"}{"} y {"b":1}'), '{"a":"}{"}');
  assert.deepEqual(JSON.parse(firstJsonObject('```json\n{"a":{"b":2}}\n```\nDone.')), { a: { b: 2 } });
  assert.throws(() => firstJsonObject('{"a":1'));
});

test('parseJudgment defaults the boolean flags a judge may omit', () => {
  const j = parseJudgment('{"claims":[],"correctness":"not_applicable","reason":"r"}');
  assert.equal(j.declined, false);
  assert.equal(j.admitsMissing, false);
});

test('questions that rely on a skipped document are left out, unanswerable ones stay', () => {
  const skipped = skippedDocIds([{ file: 'Guía trámite Programación de cirugía.pdf', skip: true }, { file: 'faq.md' }]);
  assert.deepEqual([...skipped], ['guia-tramite-programacion-de-cirugia-pdf']);
  const guide: EvalQuestion = { ...question, id: 'guide', relevant: [{ doc: 'guia-tramite-programacion-de-cirugia-pdf', mustContain: ['x'] }] };
  const none: EvalQuestion = { ...question, id: 'none', relevant: [] };
  const split = splitByCorpus([question, guide, none], skipped);
  assert.deepEqual(split.runnable.map(q => q.id), ['q', 'none']);
  assert.deepEqual(split.skipped.map(q => q.id), ['guide']);
});
