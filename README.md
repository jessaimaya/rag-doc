# rag-doc

A Spanish-language RAG assistant that helps patients with medical insurance paperwork in Mexico (IMSS, ISSSTE and private insurers). It answers from a document knowledge base and is meant to stay away from clinical advice.

> **Status: proof of concept, being extended into a portfolio project.**
> There are no real users. All documents are public, and the clinic used in demos is fictional. No patient data is used or stored.

## What it does today

- Chat web UI (Next.js) that talks to a Mastra agent.
- The agent searches a knowledge base with **hybrid retrieval**: pgvector similarity (Voyage `voyage-3`) and BM25, merged with Reciprocal Rank Fusion and reranked with Voyage `rerank-2.5`. It answers in Spanish with steps, requirements and citations (document, section, page, source URL).
- Documents are described in `documents/manifest.json` and can be PDF, DOCX, HTML, Markdown or TXT, local or remote. Ingestion uses structure-aware + semantic chunking. See [KNOWLEDGE_BASE_SETUP.md](KNOWLEDGE_BASE_SETUP.md).
- API key protection on the backend (fail-closed, constant-time comparison) and per-IP rate limiting on backend and chat route.

## Stack

| Part | Tech |
|---|---|
| Agent framework | [Mastra](https://mastra.ai) |
| LLM | Anthropic Claude (Haiku) |
| Embeddings + rerank | Voyage AI `voyage-3`, `rerank-2.5` |
| Vector store | PostgreSQL + pgvector (BM25 in memory) |
| Frontend | Next.js |
| Hosting | Railway |

## Run it locally

You need Node 20.9+, a Postgres database with the `vector` extension, and API keys for Anthropic and Voyage.

```bash
npm install
cp .env.example .env   # then fill in the values
npm run check-db       # enables pgvector and creates the tables
npm run ingest         # ingests everything in documents/manifest.json
npm run search -- "¿qué necesito para una incapacidad?"   # inspect retrieval
NODE_ENV=development npm run dev   # backend on http://localhost:4111, open API allowed in dev
npm test               # unit tests
npm run eval           # retrieval evals (needs the database and the Voyage key)
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

### Environment variables

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key |
| `VOYAGE_API_KEY` | Voyage embeddings key |
| `DATABASE_URL` | Postgres connection string (needs the `vector` extension) |
| `VOYAGE_RPM`, `VOYAGE_TPM` | Optional client-side throttle for rate-limited Voyage keys (free tier without billing: `3` and `10000`) |
| `ANTHROPIC_MODEL` | Optional agent model, default `claude-haiku-5-5` |
| `MASTRA_API_KEY` | Key clients must send in `x-api-key`. Required unless `NODE_ENV=development`; the server refuses to start without it |
| `RATE_LIMIT_PER_MIN` | Max requests per minute per client IP (backend default 30, frontend default 10) |
| `NEXT_PUBLIC_API_URL` | Backend URL used by the frontend |

## Documents

The knowledge base is built only from public documents plus one fictional clinic FAQ. Titles, source URLs, categories and retrieval dates are in [`documents/manifest.json`](documents/manifest.json).

- IMSS procedure for temporary work disability (incapacidad).
- ISSSTE medical services regulation.
- CONAMED patient rights decalogues.
- Insurer forms and policy terms from GNP, SURA and MetLife. Some are old versions, which is fine for a proof of concept.
- A GNP guide for scheduling a surgery.
- *Consultorio Médico Valle Verde* FAQ: a **fictional** clinic with made-up hours, prices, bank details and RFC.

## Roadmap

- Validated config at startup (one `config.ts`; ingestion is already a single path).
- A larger public corpus.
- ~~Retrieval evals~~ done: hit rate and MRR for vector, BM25, hybrid and reranked search, see [evals/README.md](evals/README.md). Still to do: generation evals (faithfulness, refusals) and using the rerank score as a "no relevant documents" cutoff.
- Appointment booking tools with guardrails.
- WhatsApp channel and conversation memory.
- Public demo with a fictional clinic.

## Limitations

- Retrieval evals exist, but there are no generation evals yet. Scanned PDFs (no text layer) are not supported. BM25 is in memory, which is fine for thousands of chunks, not millions.
- Not a medical product and not a production system. It must not be used for clinical decisions.
