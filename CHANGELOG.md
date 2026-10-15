# Changelog

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
