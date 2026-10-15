import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bm25Index, tokenize } from './bm25';
import { boundaryDistances, chunkDocument, detectHeading, parseSections, percentile, splitOversize, splitSentences } from './chunker';
import { reciprocalRankFusion } from './fusion';
import { fixMacRomanMojibake, htmlToMarkdownish, loadMarkdown, removeRepeatedLines } from './loaders';
import { slugify } from './manifest';
import { toBatches } from './voyage';

test('detectHeading recognizes markdown, legal and numbered headings', () => {
  assert.deepEqual(detectHeading('## 2. Horarios'), { level: 2, title: '2. Horarios' });
  assert.equal(detectHeading('ARTICULO 54.- El Instituto, con base en')?.title, 'ARTICULO 54');
  assert.equal(detectHeading('ARTICULO 54.- El Instituto, con base en')?.rest, 'El Instituto, con base en');
  assert.equal(detectHeading('CAPÍTULO III')?.level, 2);
  assert.equal(detectHeading('6.1 Descripción de actividades')?.level, 2);
});

test('detectHeading does not treat ids, steps or prose as headings', () => {
  assert.equal(detectHeading('79483856 Enfermedades pulmonares'), null);
  assert.equal(detectHeading('1. Recibe del área solicitante el oficio, en original y copia.'), null);
  assert.equal(detectHeading('El Instituto otorgará los servicios'), null);
  assert.equal(detectHeading('12. Envío de Información 23'), null); // table-of-contents entry
});

test('splitSentences keeps abbreviations together', () => {
  const out = splitSentences('La Dra. Rivas atiende en Av. Reforma 12. Llama al consultorio. ¿Necesitas cita? Escríbenos.');
  assert.equal(out.length, 4);
  assert.equal(out[0], 'La Dra. Rivas atiende en Av. Reforma 12.');
});

test('parseSections builds heading paths, keeps tables whole and lists as items', () => {
  const md = [
    '# Guía',
    '## Horarios',
    'Atendemos de lunes a viernes en horario extendido para comodidad de los pacientes del consultorio.',
    '| Día | Horario |',
    '|---|---|',
    '| Lunes | 9:00 |',
    '| Martes | 9:00 |',
    '## Requisitos',
    '- Identificación oficial vigente con fotografía y firma del paciente titular',
    '- Póliza o credencial vigente del seguro médico que cubre el procedimiento',
  ].join('\n');
  const sections = parseSections([{ text: md }]);
  const horarios = sections.find(s => s.path.join('/') === 'Guía/Horarios')!;
  assert.ok(horarios.atoms.some(a => a.kind === 'table' && a.text.includes('| Martes | 9:00 |')));
  const req = sections.find(s => s.path.at(-1) === 'Requisitos')!;
  assert.equal(req.atoms.filter(a => a.kind === 'item').length, 2);
});

test('tiny heading-only sections fold into the next section', () => {
  const sections = parseSections([{ text: 'CAPÍTULO I\nARTICULO 1.- ' + 'Texto del artículo con contenido suficiente. '.repeat(8) }]);
  assert.equal(sections.length, 1);
  assert.match(sections[0].atoms[0].text, /CAPÍTULO I/);
});

test('short sibling articles fold together and the label names the whole range', () => {
  const text = [
    'ARTICULO 112.- La Dirección Médica establecerá los criterios de operación.',
    'ARTICULO 113.- ' + 'La Dirección Médica supervisará y vigilará la aplicación de la normatividad. '.repeat(3),
    'ARTICULO 114.- ' + 'Los Directores o responsables llevarán a cabo acciones de supervisión operativa. '.repeat(3),
  ].join('\n');
  const sections = parseSections([{ text }]);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].path[0], 'ARTICULO 112 – ARTICULO 113');
  assert.match(sections[0].atoms.map(a => a.text).join(' '), /supervisará/);
  assert.match(sections[0].atoms.map(a => a.text).join(' '), /criterios de operación/);
  assert.equal(sections[1].path[0], 'ARTICULO 114');
});

test('splitOversize repeats the table header and respects the limit', () => {
  const rows = Array.from({ length: 30 }, (_, i) => `| fila ${i} | ${'x'.repeat(30)} |`);
  const atom = { text: ['| a | b |', ...rows].join('\n'), kind: 'table' as const, para: 1 };
  const parts = splitOversize(atom, 300);
  assert.ok(parts.length > 1);
  for (const p of parts) {
    assert.ok(p.text.length <= 340);
    assert.ok(p.text.startsWith('| a | b |'));
  }
});

test('boundaryDistances peaks where the topic changes', () => {
  const a = [1, 0, 0], b = [0, 1, 0];
  const d = boundaryDistances([a, a, a, b, b, b], 2);
  const peak = d.indexOf(Math.max(...d));
  assert.equal(peak, 3);
  assert.ok(percentile(d.slice(1), 0.9) <= d[3]);
});

test('chunkDocument breaks at a semantic shift but never across a heading', async () => {
  const sentence = (topic: string, i: number) => `Esta es la oración número ${i} sobre ${topic} con suficiente longitud para contar como contenido.`;
  const body = [...Array.from({ length: 8 }, (_, i) => sentence('incapacidad', i)), ...Array.from({ length: 8 }, (_, i) => sentence('facturación', i))].join(' ');
  const text = `## Sección A\n${body}\n## Sección B\n${sentence('otra cosa', 99)} ${sentence('otra cosa', 100)} ${sentence('otra cosa', 101)}`;
  // fake embedder: topic decides the direction
  const embed = async (texts: string[]) => texts.map(t => (t.includes('incapacidad') ? [1, 0] : t.includes('facturación') ? [0, 1] : [0.5, 0.5]));
  const chunks = await chunkDocument([{ text }], { title: 'Doc', embed, minChars: 200, maxChars: 2000, breakpointPercentile: 0.8, window: 1 });
  const a = chunks.filter(c => c.section === 'Sección A');
  assert.equal(a.length, 2);
  assert.ok(a[0].text.includes('incapacidad') && !a[0].text.includes('facturación'));
  assert.ok(a[1].text.includes('facturación') && !a[1].text.includes('incapacidad'));
  assert.ok(chunks.every(c => !(c.section === 'Sección B' && c.text.includes('incapacidad'))));
  assert.equal(chunks[0].context, 'Doc › Sección A');
});

test('chunkDocument without embeddings still respects maxChars', async () => {
  const text = Array.from({ length: 60 }, (_, i) => `Oración larga número ${i} que habla de trámites del seguro médico y sus requisitos.`).join(' ');
  const chunks = await chunkDocument([{ text }], { title: 'T', maxChars: 500 });
  assert.ok(chunks.length > 5);
  assert.ok(chunks.every(c => c.text.length <= 620));
});

test('tokenize folds accents, case, plurals and drops stopwords', () => {
  assert.deepEqual(tokenize('Los Trámites de las Incapacidades'), ['tramit', 'incapacidad']);
  assert.ok(tokenize('formato 9220-003-329').includes('9220'));
  assert.deepEqual(tokenize('médico'), tokenize('médicos'));
  assert.deepEqual(tokenize('trámite'), tokenize('trámites'));
});

test('tokenize keeps hyphenated codes as one searchable token', () => {
  assert.ok(tokenize('formato ST-7').includes('st7'));
  assert.ok(tokenize('NOM-004-SSA3-2012').includes('nom004ssa32012'));
  assert.ok(!tokenize('médico-quirúrgico').some(t => t === 'medicoquirurgico')); // words are not compounded
});

test('BM25 finds a code by its joined token', () => {
  const index = new Bm25Index([
    { id: 'st7', text: 'ST-7 aviso de atención médica inicial y calificación de probable accidente de trabajo' },
    { id: 'st8', text: 'ST-8 aviso de atención médica inicial y calificación de probable enfermedad de trabajo' },
    { id: 'x', text: 'formato general de solicitud' },
  ]);
  assert.equal(index.search('ST-7', 2)[0].id, 'st7');
});

test('BM25 ranks the chunk with the rare matching term first', () => {
  const index = new Bm25Index([
    { id: 'a', text: 'requisitos generales para cualquier trámite del seguro' },
    { id: 'b', text: 'la incapacidad temporal para el trabajo requiere certificado ST-7' },
    { id: 'c', text: 'horarios de atención del consultorio y datos de contacto' },
  ]);
  const hits = index.search('certificado de incapacidad', 3);
  assert.equal(hits[0].id, 'b');
  assert.deepEqual(index.search('zzzz', 3), []);
});

test('RRF rewards agreement between lists and keeps ranks for debugging', () => {
  const fused = reciprocalRankFusion([[{ id: 'x' }, { id: 'y' }, { id: 'z' }], [{ id: 'w' }, { id: 'y' }, { id: 'v' }]]);
  assert.equal(fused[0].id, 'y'); // rank 2 in both lists beats rank 1 in only one
  const y = fused.find(f => f.id === 'y')!;
  assert.deepEqual(y.ranks, [2, 2]);
  assert.equal(fused.find(f => f.id === 'w')!.ranks[0], undefined);
  // convexity: ranks (3, 1) edge out (2, 2)
  const close = reciprocalRankFusion([[{ id: 'a' }, { id: 'y' }, { id: 'z' }], [{ id: 'z' }, { id: 'y' }]]);
  assert.equal(close[0].id, 'z');
});

test('RRF weights shift the balance', () => {
  const lists = [[{ id: 'a' }], [{ id: 'b' }]];
  assert.equal(reciprocalRankFusion(lists, { weights: [1, 3] })[0].id, 'b');
});

test('fixMacRomanMojibake repairs accents but leaves clean text alone', () => {
  const garbled = 'DescripciÛn de actividades. CertificaciÛn del derecho. InformaciÛn seg˙n sea el caso. AcompaÒada de la informaciÛn. TramitaciÛn y notificaciÛn. ObservaciÛn de la actividad. SituaciÛn actual. ResoluciÛn. ComunicaciÛn. AdministraciÛn. “Oficio”.';
  const fixed = fixMacRomanMojibake(garbled);
  assert.match(fixed, /Descripción de actividades/);
  assert.match(fixed, /según/);
  assert.match(fixed, /Acompañada/);
  assert.match(fixed, /“Oficio”/);
  const clean = 'Descripción de actividades según el trámite';
  assert.equal(fixMacRomanMojibake(clean), clean);
});

test('removeRepeatedLines drops running headers and page numbers only', () => {
  const pages = Array.from({ length: 6 }, (_, i) => ({ page: i + 1, text: `Instituto Mexicano\nPágina ${i + 1}\n${['alfa', 'beta', 'gamma', 'delta', 'épsilon', 'zeta'][i]} es el contenido único de esta página` }));
  const out = removeRepeatedLines(pages);
  assert.ok(out.every(p => !p.text.includes('Instituto Mexicano') && !p.text.includes('Página')));
  assert.ok(out.every(p => p.text.includes('contenido único')));
});

test('markdown front matter becomes the detected title; html headings survive', () => {
  assert.equal(loadMarkdown('---\ntitle: "Mi guía"\nlang: es\n---\n# Otro\ntexto').detectedTitle, 'Mi guía');
  const text = htmlToMarkdownish('<h2>Requisitos</h2><p>Credencial vigente.</p><script>x()</script>');
  assert.match(text, /## Requisitos/);
  assert.doesNotMatch(text, /x\(\)/);
});

test('slugify keeps the extension so .md and .pdf of the same name do not collide', () => {
  assert.equal(slugify('Guía trámite.pdf'), 'guia-tramite-pdf');
  assert.notEqual(slugify('faq.md'), slugify('faq.pdf'));
});

test('toBatches caps inputs per request and preserves order', () => {
  const batches = toBatches(Array.from({ length: 300 }, (_, i) => String(i)));
  assert.deepEqual(batches.map(b => b.length), [128, 128, 44]);
  assert.equal(batches.flat()[299], '299');
});

test('toBatches honours a char budget so one request fits a token-per-minute cap', () => {
  const batches = toBatches(Array.from({ length: 10 }, () => 'x'.repeat(100)), 350);
  assert.deepEqual(batches.map(b => b.length), [3, 3, 3, 1]);
});
