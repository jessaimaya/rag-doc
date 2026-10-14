# rag-doc

A Spanish-language RAG assistant that helps patients with medical insurance paperwork in Mexico (IMSS, ISSSTE and private insurers). It answers from a document knowledge base and is meant to stay away from clinical advice.

> **Status: proof of concept, being extended into a portfolio project.**
> There are no real users. All documents are public, and the clinic used in demos is fictional. No patient data is used or stored.

## What it does today

- Chat web UI (Next.js) that talks to a Mastra agent.
- The agent searches a pgvector knowledge base (Voyage `voyage-3` embeddings) and answers in Spanish with steps, requirements and sources.
- API key protection on the backend (fail-closed, constant-time comparison) and per-IP rate limiting on backend and chat route.

## Stack

| Part | Tech |
|---|---|
| Agent framework | [Mastra](https://mastra.ai) |
| LLM | Anthropic Claude (Haiku) |
| Embeddings | Voyage AI `voyage-3` |
| Vector store | PostgreSQL + pgvector |
| Frontend | Next.js |
| Hosting | Railway |

## Run it locally

You need Node 20.9+, a Postgres database with the `vector` extension, and API keys for Anthropic and Voyage.

```bash
npm install
cp .env.example .env   # then fill in the values
npm run ingest         # loads the PDFs in documents/
NODE_ENV=development npm run dev   # backend on http://localhost:4111, open API allowed in dev
npm test               # unit tests
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
| `DATABASE_URL` (or `DB_CONNECTION`) | Postgres connection string |
| `MASTRA_API_KEY` | Key clients must send in `x-api-key`. Required unless `NODE_ENV=development`; the server refuses to start without it |
| `RATE_LIMIT_PER_MIN` | Max requests per minute per client IP (backend default 30, frontend default 10) |
| `NEXT_PUBLIC_API_URL` | Backend URL used by the frontend |

## Documents

The knowledge base is built only from public documents. Current source:

- *Guía trámite Programación de cirugía* (public PDF).

A `documents/manifest.json` with titles, source URLs and retrieval dates is planned.

## Roadmap

- Validated config at startup (one `config.ts`) and a single ingestion path.
- A larger public corpus with structure-aware chunking and citations.
- Retrieval evals (hit rate, MRR, faithfulness, refusals) comparing vector, hybrid and reranked search.
- Appointment booking tools with guardrails.
- WhatsApp channel and conversation memory.
- Public demo with a fictional clinic.

## Limitations

- Single document, no test suite, no evals yet.
- Not a medical product and not a production system. It must not be used for clinical decisions.
