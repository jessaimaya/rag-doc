# Knowledge base

How documents get into the knowledge base and how the agent finds them.

## 1. Describe the documents: `documents/manifest.json`

The manifest is the source of truth. Each entry points at a local `file` (relative to `documents/`) or a remote `url`:

```json
[
  {
    "file": "imss-incapacidad-9220-003-329.pdf",
    "title": "IMSS procedimiento 9220-003-329",
    "category": "IMSS",
    "language": "es",
    "source_url": "https://www.imss.gob.mx/.../9220-003-329.pdf",
    "retrieved": "2026-10-14"
  },
  { "url": "https://example.com/guia.docx", "title": "Guía de ejemplo", "category": "Private" },
  { "file": "old-copy.pdf", "skip": true, "notes": "duplicate of the .md" }
]
```

- **Formats:** PDF, DOCX, HTML, Markdown and TXT. The format comes from the extension or the response content-type; set `"type"` to override it. Scanned PDFs (no text layer) are not supported yet.
- `title`, `category`, `source_url` are shown in citations. Any extra keys you add are stored as metadata.
- Supported files in `documents/` that are not in the manifest are still ingested (title from the file name, category `General`) and a warning is printed.
- `"skip": true` keeps an entry documented but out of the index.

## 2. Ingest

```bash
npm run check-db                       # connects, enables pgvector, creates tables
npm run ingest                         # everything that changed
npm run ingest -- --only imss          # documents whose id or title contains "imss"
npm run ingest -- --url https://.../x.pdf --category IMSS   # one remote file, no manifest edit
npm run ingest -- --dry-run            # parse + chunk only: no API calls, no database writes
npm run ingest -- --force              # re-ingest even if nothing changed
npm run ingest -- --no-semantic        # structure-only chunking (skips the sentence-embedding pass)
npm run ingest -- --prune              # delete documents that are no longer in the manifest
```

Re-running is safe: each document is replaced in one transaction, and unchanged files (same bytes, same chunking settings and embedding model) are skipped.

### Chunking

1. **Structure:** text is split into sections by headings (`#`, `CAPÍTULO`, `Artículo N`, `6.1 Título`). Tables stay whole, list items and legal *fracciones* stay separate. Running headers/footers are removed from PDFs. Each chunk keeps its section path and page.
2. **Semantic:** every sentence is embedded with Voyage. The cosine distance between the windows of sentences on each side of a boundary marks topic shifts; boundaries above the 85th percentile become breakpoints.
3. **Packing:** chunks are 400–1400 characters, break at breakpoints, never cross a heading. Each chunk is embedded together with its breadcrumb (`Document › Section › Subsection`).

## 3. Retrieval (`src/mastra/rag/retriever.ts`)

1. **Vector search** (pgvector, cosine) and **BM25** (in-memory, Spanish tokenization with accent folding and light stemming) each return 25 candidates.
2. **Reciprocal Rank Fusion** merges the two ranked lists (`score = Σ 1/(60 + rank)`), which works without normalizing cosine and BM25 scores.
3. The top 30 fused candidates go to Voyage **rerank** (`rerank-2.5`), and the best 5 are returned. If the rerank call fails, the fused order is used.

Inspect any query, including where each hit ranked in each list:

```bash
npm run search -- "¿qué necesito para una incapacidad temporal?" [--no-rerank] [--category IMSS] [--top 5]
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `VOYAGE_API_KEY`, `DATABASE_URL` | required | |
| `VOYAGE_EMBED_MODEL` | `voyage-3` | embedding model (must output 1024 dimensions) |
| `VOYAGE_RERANK_MODEL` | `rerank-2.5` | reranker |
| `VOYAGE_RPM`, `VOYAGE_TPM` | unset | client-side throttle for rate-limited keys. Voyage's free tier without a payment method is 3 RPM / 10K TPM: set `VOYAGE_RPM=3 VOYAGE_TPM=10000` |
| `ANTHROPIC_MODEL` | `claude-haiku-5-5` | the agent's model |

If you change the embedding model, re-ingest with `--force`.

## Layout

```
documents/manifest.json        what to ingest
src/mastra/rag/                loaders, manifest, chunker, bm25, fusion, voyage client, store, retriever, tool
src/mastra/scripts/            ingest.ts, search.ts, check-db.ts
src/mastra/agents/             the agent (uses the rag tool and cites its results)
```
