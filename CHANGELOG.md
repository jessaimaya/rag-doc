# Changelog

## 2026-10-15 — Frosted-glass UI and preparing the repo to be public

- Chat restyle: one steel-blue hue, Geist + Geist Mono, a frosted frame over a blue photo (tinted veil for light and dark, gradient fallback), pill composer, orb logo. Answers stay on opaque surfaces for readability.
- Fix: on short screens the empty state opened scrolled to the bottom and hid the headline.
- `dev.sh` starts backend and frontend together. Next's workspace root is pinned: stray lockfiles above the repo made Turbopack scan the parent tree and panic.
- Third-party PDFs are no longer committed. `npm run fetch-docs` rebuilds them from each `source_url` (byte-identical to the ingested files). Git history was rewritten to drop them; the repo went from 13 MB to 1 MB.
- The guide without a public source is `skip: true`; the evals skip the 5 questions that need it (58 of 63 run on a fresh clone) and say so. New GNP starter question.
- MIT license. README: Security and Credits sections.
- Dependencies: backend `npm audit fix` (86 to 62 advisories, 0 critical); `next` 16.0.1 to 16.4.2 (frontend 0 advisories). Tests, typecheck, an agent smoke run and `next build` pass.

## 2026-10-15 — Chat UI

- Calm clinical redesign of the frontend chat (light and dark themes, serif headings, one teal accent).
- Assistant answers render as Markdown (`react-markdown` + `remark-gfm`) instead of raw text.
- Starter questions match the indexed documents; fictional-clinic note; "searching the documents" state; per-cause error messages with retry; new-conversation button; growing textarea with Enter to send.
- Fix: the chat route rejected any message over 2000 characters, but about 3 in 10 assistant answers are longer, so the follow-up question after a long answer failed. Assistant messages may now be up to 8000 characters; user messages stay at 2000.

## 2026-10-15 — Standalone dashboard and stricter grounding prompt

- `npm run dashboard:standalone` builds `evals/dashboard/standalone.html`, the eval dashboard as one self-contained page (only d3 loads from a CDN). Verified in a browser: charts, filters, search and answer detail work, and there are no console errors.
- Fixed run labels in the answer-quality legend.
- Agent instructions gain a "fidelidad a las fuentes" section. Re-running all 63 questions: answers with an unsupported claim fell from 44% to 10% and claims supported rose from 93.6% to 98.8%, with correctness 96% to 98%, no false refusals, and answers about a quarter shorter. Details and caveats in `evals/README.md`.
- The eval dashboard gains the stricter-prompt run; the answer-summary logic moved to `src/mastra/rag/gen-summary.ts`, shared by the eval and the dashboard builder.

## 2026-10-15 — Eval dashboard

- `npm run dashboard:data` builds five datasets (corpus, retrieval metrics, fusion sweep, answer-quality metrics, per-question results) from the saved eval results into `evals/dashboard-data/`; `evals/dashboard/index.html` is the dashboard page that reads them.
- Documented that the relevance cutoff does not separate near-miss questions from real answers.

## 2026-10-15 — Generation evals and a relevance cutoff

- `npm run eval:generation`: runs questions through the real agent and has an LLM judge score correctness, claim-level faithfulness and refusals; checks fabricated page/URL citations without an LLM. Judge defaults to Haiku to keep runs cheap.
- 6 near-miss questions (on topic, answer verified absent) added to `evals/questions.json`; the retrieval eval treats all unanswerable questions together.
- The tool returns "no relevant documents" when the best rerank score is below `RAG_MIN_RELEVANCE` (0.6), and the agent instructions say to admit missing information instead of improvising.
- The tool omits absent `page` / `sourceUrl` / `section` instead of sending nulls.

## 2026-10-15 — Retrieval evals

- `npm run eval`: 57 judged questions, six configurations (vector, BM25, hybrid, each with and without rerank), Hit@k, MRR, latency, and an out-of-scope score analysis. Results in `evals/results/`, method and findings in `evals/README.md`.
- Retriever: `mode` (vector / bm25 / hybrid), `rrfWeights`, `queryEmbedding` options; rerank now also runs for a single candidate.
- BM25 tokenizer keeps hyphenated codes (`ST-7` -> `st7`).
- Chunker: short sibling articles folded together are labelled as a range; table-of-contents lines are no longer headings (chunker version v3, re-ingest to apply).

## 2026-10-15 — Hybrid retrieval and manifest-driven ingestion

### Ingestion
- One ingestion path (`npm run ingest`) driven by `documents/manifest.json`. Entries take a local `file` or a remote `url`; format is inferred (PDF, DOCX, HTML, Markdown, TXT). Files missing from the manifest are ingested with defaults and reported. `skip: true` keeps an entry out of the index.
- New flags: `--only`, `--force`, `--dry-run`, `--no-semantic`, `--prune`, `--url`.
- Re-ingesting is idempotent: documents are replaced in one transaction and skipped when bytes, chunking version and embedding model are unchanged.
- Removed `ingest-documents`, `ingest-via-url`, `add-single-document`, `api/ingest-endpoint`, `lib/util` and `knowledge/insurance-kb` (Mastra's graph RAG tool).

### Chunking
- Structure first: headings, `Artículo N`, legal fracciones, numbered sections; tables kept whole; running headers/footers removed.
- Semantic second: sentence embeddings (Voyage) find topic shifts; chunks of 400–1400 characters that never cross a heading.
- Every chunk stores its section path and page, and is embedded with its breadcrumb.

### PDF extraction
- Replaced `pdf2json` (split words into letters) with `pdf-parse`.
- Auto-repair for PDFs whose accents come out as MacRoman mojibake (`DescripciÛn`, IMSS procedures).

### Retrieval
- Vector search (pgvector, HNSW, cosine) + BM25 (in-memory, Spanish tokenization, accent folding, light stemming), merged with Reciprocal Rank Fusion, reranked with Voyage `rerank-2.5`. Falls back to the fused order if rerank fails.
- The agent tool returns title, section, page and source URL; the agent cites only what the tool returned.

### Fixes
- Agent model `claude-3-haiku-20240307` was retired (404). Now `claude-haiku-5-5`, overridable with `ANTHROPIC_MODEL`.
- Current Claude models reject `temperature`; the agent overrides Mastra's `temperature: 0` default.
- Manifest file names are matched NFC/NFD-insensitively (Linux file names are byte-exact).
- Optional `VOYAGE_RPM` / `VOYAGE_TPM` client-side throttle for rate-limited Voyage keys.

### Docs
- `KNOWLEDGE_BASE_SETUP.md` rewritten; README, Railway guides and `.env.example` updated.
