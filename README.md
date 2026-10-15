# rag-doc

A Spanish-language RAG assistant that helps patients with medical insurance paperwork in Mexico (IMSS, ISSSTE and private insurers). It answers from a document knowledge base and is meant to stay away from clinical advice.

> **Status: proof of concept, being extended into a portfolio project.**
> There are no real users. All documents are public, and the clinic used in demos is fictional. No patient data is used or stored.

## What it does today

- Chat web UI (Next.js, light and dark themes) that talks to a Mastra agent and renders its Markdown answers. See [frontend/README.md](frontend/README.md).
- The agent searches a knowledge base with **hybrid retrieval**: pgvector similarity (Voyage `voyage-3`) and BM25, merged with Reciprocal Rank Fusion and reranked with Voyage `rerank-2.5`. It answers in Spanish with steps, requirements and citations (document, section, page, source URL).
- Documents are described in `documents/manifest.json` and can be PDF, DOCX, HTML, Markdown or TXT, local or remote. Ingestion uses structure-aware + semantic chunking. See [KNOWLEDGE_BASE_SETUP.md](KNOWLEDGE_BASE_SETUP.md).
- A relevance cutoff: when nothing retrieved is relevant enough, the assistant says so instead of improvising, and its instructions tell it to state only what the retrieved passages say.
- Retrieval and answer-quality evals with a browsable dashboard ([evals/README.md](evals/README.md), `evals/dashboard/standalone.html`).
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
npm run eval:generation # answer-quality evals through the real agent (spends Anthropic credits)
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
| `RAG_MIN_RELEVANCE` | Minimum rerank score of the best result before the tool answers "no relevant documents" (default `0.6`, `0` disables) |
| `EVAL_JUDGE_MODEL` | Judge for `npm run eval:generation` (default `claude-haiku-5-5`, cheap) |
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

Done:

- Single ingestion path driven by `documents/manifest.json` (PDF, DOCX, HTML, Markdown, TXT), with structure-aware + semantic chunking.
- Hybrid retrieval (vector + BM25, rank fusion) with a reranker, a relevance cutoff, and citations.
- Retrieval evals (hit rate, MRR for six setups) and generation evals (correctness, faithfulness, refusals), a stricter grounding prompt measured on all 63 questions, and an eval dashboard.
- Chat UI redesign: rendered Markdown, document-matched starter questions, error and retry states.

Next, in the order I would do them:

1. **Source cards in the chat**: show each answer's passages (document, section, page, link, relevance) as checkable cards. The backend already returns this data.
2. **Streaming answers**, so long answers appear as they are written.
3. **Stronger evals**: a larger question set that includes real users' questions, and a Sonnet-judged run of the final prompt so the headline numbers do not depend on the cheap judge.
4. **Validated config at startup** (one `config.ts` for the backend and the RAG module).
5. **A larger public corpus**, and OCR for scanned PDFs. Move BM25 into Postgres if the corpus grows past tens of thousands of chunks.
6. **Public demo** deployed with the fictional clinic: run `check-db` and `ingest` against the deployed database, then record the demo.

Later:

- Appointment booking tools with guardrails.
- WhatsApp channel and conversation memory.

Known quality gaps: the assistant occasionally adds details the passages do not state (reduced, not eliminated, by the grounding prompt), and near-miss questions (on topic, answer absent) cannot be rejected by the relevance cutoff, so they rely on the assistant's instructions.

## Limitations

- The evals are small (63 hand-written questions), use one sample per question, and some runs use a cheap judge, so treat the numbers as a regression check, not a benchmark. Scanned PDFs (no text layer) are not supported. BM25 is in memory, which is fine for thousands of chunks, not millions.
- Not a medical product and not a production system. It must not be used for clinical decisions.
