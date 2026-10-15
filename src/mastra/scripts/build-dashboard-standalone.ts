import * as fs from 'fs';
import * as path from 'path';

/**
 * Builds evals/dashboard/standalone.html: the eval dashboard as one self-contained page you can host anywhere
 * (portfolio site, GitHub Pages) or open from disk. It inlines the datasets from evals/dashboard-data/ and a small
 * stand-in for the `dash` runtime that the Claude Dashboard artifact provides. The only external request is d3.
 *
 *   npm run dashboard:data && npm run dashboard:standalone
 */

const D3_URL = 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js';
const dir = path.resolve('evals');
const page = fs.readFileSync(path.join(dir, 'dashboard/index.html'), 'utf8');
const names = ['corpus', 'retrieval_summary', 'fusion_sweep', 'generation_summary', 'question_results'];
const data = Object.fromEntries(names.map(n => [n, JSON.parse(fs.readFileSync(path.join(dir, `dashboard-data/${n}.json`), 'utf8'))]));
// "</" inside inline JSON would end the script element early
const dataJson = JSON.stringify(data).replace(/</g, '\\u003c');

const TOKENS = `
:root {
  --font-anthropic-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-anthropic-serif: ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --color-bg: #fbfaf8; --color-panel: #ffffff; --color-fg: #1d1c1a; --color-fg-muted: #6a665f; --color-border-line: #e3dfd8;
  --color-ok: #1f7a4d; --color-warn: #a35b00; --color-bad: #b3261e;
  --cds-font-size-caption: 0.8125rem; --cds-font-size-body: 0.9375rem; --cds-font-size-heading: 1.0625rem; --cds-font-size-title: 1.5rem;
  --cds-font-weight-medium: 500; --cds-radius: 8px; --cds-pad-xs: 0.35rem; --cds-pad-sm: 0.6rem; --cds-pad-lg: 1.1rem; --cds-gap-md: 1rem; --cds-dur-slow: 200ms;
  --cds-chart-muted: #c9c4ba; --cds-chart-grid: #ebe7e0; --cds-chart-reference: #6a665f;
  --cds-surface-popover: #ffffff; --cds-border: #d6d1c7; --cds-shadow-popover: 0 6px 20px rgba(0,0,0,.12); --cds-text-secondary: #6a665f;
  --series-1: #2f5d8a; --series-2: #c2571a; --series-3: #7a5ea8; --series-4: #2a8a7a; --series-5: #b08a1d; --series-6: #a33a5b; --series-7: #5b7a2e; --series-8: #6b6b6b;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-bg: #151412; --color-panel: #1e1d1a; --color-fg: #efece6; --color-fg-muted: #a39e94; --color-border-line: #34322d;
    --color-ok: #6cc28f; --color-warn: #e0a24a; --color-bad: #ef8a82;
    --cds-chart-muted: #4a473f; --cds-chart-grid: #2a2825; --cds-chart-reference: #a39e94;
    --cds-surface-popover: #26241f; --cds-border: #3d3a34; --cds-shadow-popover: 0 6px 20px rgba(0,0,0,.5); --cds-text-secondary: #a39e94;
    --series-1: #7fb0e0; --series-2: #f0a070; --series-3: #b9a2e0; --series-4: #6cc7b6; --series-5: #e0c060; --series-6: #e08aa8; --series-7: #a3c46a; --series-8: #a8a8a8;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --color-bg: #151412; --color-panel: #1e1d1a; --color-fg: #efece6; --color-fg-muted: #a39e94; --color-border-line: #34322d;
  --color-ok: #6cc28f; --color-warn: #e0a24a; --color-bad: #ef8a82;
  --cds-chart-muted: #4a473f; --cds-chart-grid: #2a2825; --cds-chart-reference: #a39e94;
  --cds-surface-popover: #26241f; --cds-border: #3d3a34; --cds-shadow-popover: 0 6px 20px rgba(0,0,0,.5); --cds-text-secondary: #a39e94;
  --series-1: #7fb0e0; --series-2: #f0a070; --series-3: #b9a2e0; --series-4: #6cc7b6; --series-5: #e0c060; --series-6: #e08aa8; --series-7: #a3c46a; --series-8: #a8a8a8;
  color-scheme: dark;
}
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--color-bg); color: var(--color-fg); font-family: var(--font-anthropic-sans); font-size: var(--cds-font-size-body);
  padding-block: 1.25rem; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
[hidden] { display: none !important; }
a { color: inherit; }
`;

// Stand-in for the artifact's `dash` runtime: datasets are embedded, so every source is always "ok".
const SHIM = `
(function () {
  var raw = JSON.parse(document.getElementById('ev-data').textContent);
  var computed = {};
  var listeners = [];
  window.dash = {
    colors: [1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return 'var(--series-' + i + ')'; }),
    data: function (id) {
      var rows = id in computed ? computed[id] : raw[id];
      return rows ? { status: 'ok', data: rows, columns: rows[0] ? Object.keys(rows[0]) : [] } : { status: 'missing', data: [] };
    },
    calc: function (id, spec) { computed[id] = spec.fn.apply(null, spec.inputs.map(function (i) { return raw[i]; })); },
    onData: function (fn) {
      listeners.push(fn);
      var run = function () { fn(); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
    },
    setLink: function (name) { try { history.replaceState(null, '', '#' + name); } catch (e) {} },
    refresh: function () {}, params: function () { return {}; }, setParams: function () {}, resetParams: function () {}
  };
  // charts are sized from clientWidth, so redraw when the width changes
  var last = window.innerWidth, timer;
  window.addEventListener('resize', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { if (window.innerWidth !== last) { last = window.innerWidth; listeners.forEach(function (f) { f(); }); } }, 120);
  });
})();
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Insurance RAG Evals</title>
<meta name="description" content="Evaluation of a Spanish-language RAG assistant for medical insurance paperwork in Mexico: retrieval techniques compared, answer quality, and every question and answer.">
<style>${TOKENS}</style>
</head>
<body>
${page.replace(/<script>[\s\S]*<\/script>\s*$/, '')}
<script type="application/json" id="ev-data">${dataJson}</script>
<script>${SHIM}</script>
<script src="${D3_URL}"></script>
${page.match(/<script>[\s\S]*<\/script>\s*$/)![0]}
</body>
</html>
`;

fs.writeFileSync(path.join(dir, 'dashboard/standalone.html'), html);
console.log(`evals/dashboard/standalone.html: ${(html.length / 1024).toFixed(0)} KB`);
