# Retrieval evals

> A browsable version of all of this, with every question and answer, is the eval dashboard. Its datasets are built
> by `npm run dashboard:data` into `evals/dashboard-data/`, and its page source is `evals/dashboard/index.html`
> (written for the Claude Dashboard artifact type, so it expects its `dash` runtime and is not a standalone page).

`npm run eval` measures how often the right passage is retrieved, for six configurations: each retriever alone
(vector, BM25) and fused with Reciprocal Rank Fusion (hybrid), each with and without the Voyage reranker.
Latest numbers: [`results/latest.md`](results/latest.md).

```bash
npm run eval                      # all configurations -> evals/results/latest.{md,json}
npm run eval -- --check           # validate the question set against the index (no API calls)
npm run eval -- --only vector,hybrid+rerank
npm run eval -- --rrf-weights 3,1 # weight vector:BM25 in the fusion
```

## The question set (`questions.json`)

57 questions in Spanish over the 8 indexed documents: 50 in scope and 7 out of scope (capital of France, passport
renewal, a clinical question that must be declined, ...). In-scope questions are tagged:

| tag | n | what it tests |
|---|---|---|
| `semantic` | 28 | paraphrases with little word overlap ("Llegué 10 minutos tarde, ¿todavía me atienden?") |
| `lexical` | 17 | the question shares rare words with the answer |
| `exact` | 5 | codes and acronyms (CITT, ST-7, a phone number) |

**Relevance** is judged per chunk and does not depend on how the text was chunked: a chunk is relevant if it comes
from the judged document and its breadcrumb + text contain every `mustContain` phrase (accent- and
case-insensitive). A question may list alternative judgments. `npm run eval -- --check` fails if any in-scope
question has no relevant chunk in the index.

Metrics: **Hit@k** (a relevant chunk in the top k), **MRR@10** (mean of 1/rank of the first relevant chunk).

## What the results say (2026-10-15)

| config | Hit@1 | Hit@5 | MRR@10 |
|---|---|---|---|
| vector | 76% | 92% | 0.837 |
| bm25 | 42% | 76% | 0.568 |
| hybrid (RRF 1:1) | 62% | 86% | 0.726 |
| vector + rerank | 86% | 100% | 0.921 |
| bm25 + rerank | 78% | 88% | 0.821 |
| hybrid + rerank | 86% | 100% | 0.921 |

1. **The reranker is the biggest win**: +10 points of Hit@1 and the last 8% of Hit@5 over vector alone, for about 200 ms.
2. **On this corpus, BM25 adds nothing measurable once the reranker is on.** `vector+rerank` and `hybrid+rerank` are identical (MRR 0.921), and RRF weightings from 1:1 to 3:1 move the reranked result by at most one question (0.921 to 0.931, see `results/latest-rrf-*.md`).
3. **Without the reranker, fusion is worse than vector alone** (MRR 0.726 vs 0.837): BM25 is the weaker ranker here, and equal-weight RRF lets it pull good vector hits down. Weighting the fusion toward vector narrows the gap (0.743 at 2:1, 0.760 at 3:1) but does not close it.
4. **Hybrid stays the default** because it costs nothing measurable (BM25 is in memory, 0 ms) and it protects against failures this small set cannot show, such as a vector miss on a rare identifier. This is a judgement call, not something the data proves.
5. **The rerank score separates answerable from unanswerable questions.** Top-1 rerank score is at least 0.695 for every in-scope question and at most 0.512 for every out-of-scope one (AUROC 1.0 on 7 negatives). A "no relevant documents" cutoff around 0.6 looks safe. The agent does not use it yet.

## Limits (read before trusting the numbers)

- **Small and written by the same person who built the index**: 50 questions, written after reading the documents, so lexical overlap is probably higher than for real users. One or two questions are 2–4 points. Treat differences under ~5 points as noise.
- **Phrase-based judgments undercount valid alternatives.** For "¿Qué es el formato ST-7?" BM25's top hit is a chunk densely about ST-7 that answers the question, but it does not contain the exact definition phrase, so it counts as a miss. This penalises BM25 (which favours term-dense chunks) more than the other retrievers, so its low scores are partly an artifact of the judging.
- **Retrieval only.** It does not measure whether the generated answer is faithful to the retrieved text, or whether the agent refuses correctly. That needs generation evals (an LLM judge over answers).
- The out-of-scope set is only 7 questions. Collect more before hard-coding a refusal threshold.

## Findings that came out of building this

- The first run exposed that `ST-7` was tokenized to `st`, dropping the `7`. Hyphenated codes now also yield a joined token (`st7`).
- Reading chunks to write questions exposed article labels that were off by one when short articles were folded into the next section. Folded articles are now labelled as a range (`ARTICULO 112 – ARTICULO 113`).

# Generation evals

`npm run eval:generation` sends every question through the real agent (retrieval → tool → answer) and has an LLM
judge the answer. Flags: `--compare` (cutoff off vs on), `--cutoff 0.6`, `--only id,id`, `--out name`, `--concurrency N`.

**It costs real API credits**: each question is one agent run (Haiku, with one or two tool calls) plus one judge call.
A full single pass of 63 questions is cheap with the default Haiku judge; `--compare` doubles it, and a Sonnet judge
(`EVAL_JUDGE_MODEL=claude-sonnet-5-5`) costs several times more. Prefer `--only` while iterating.

What is measured, per answer:

| metric | how |
|---|---|
| tool called / relevant passage retrieved | from the agent's tool results, judged with the same `mustContain` rules as the retrieval eval |
| **correct** / partial / incorrect | judge compares the answer with the gold passage |
| **faithfulness** | judge lists the answer's factual claims and marks each supported or not by the *retrieved* passages (text, page and URL) |
| false refusal | the agent declined although the corpus had the answer |
| fabricated citation | a page number or URL in the answer that the tool never returned (regex, no LLM) |
| **handled correctly** (unanswerable) | the answer says the information is missing **and** invents nothing |

Unanswerable questions are 7 out of scope plus 6 near misses: on topic, but I verified by search that the documents do
not contain the answer (dental care at the clinic, SURA's daily hospitalization amount, ...).

## Relevance cutoff

The retrieval eval showed the best rerank score separates answerable from unanswerable questions, so the tool now
returns "no relevant documents" when the best score is below `RAG_MIN_RELEVANCE` (default 0.6, `0` disables) and the
agent is told to say so instead of improvising.

Result of an A/B run, cutoff 0 vs 0.6 (Sonnet judge, 63 questions, one sample each; run before the judge was fixed to
see page/URL metadata, and the output file was later overwritten, so these numbers are from the run log):

| | cutoff 0 | cutoff 0.6 |
|---|---|---|
| answerable: answer correct | 96% | 98% |
| answerable: false refusal | 0% | 0% |
| unanswerable: handled correctly | 69% | 92% |
| unanswerable: near miss handled | 50% | 80% |
| unanswerable: answers with an unsupported claim | 31% | 8% |

The cutoff removed most invented answers on unanswerable questions at no measurable cost on answerable ones.

**Caveat found while building the dashboard:** the cutoff separates *unrelated* questions cleanly (best score at most
0.51, against at least 0.695 for answerable ones) but not *near misses*. Five of the six near-miss questions still
scored 0.605 to 0.844, inside the range of real answers, so only one of them was cut off. For near misses the
assistant relies on its instructions to admit the gap, and the generation eval checks that it does. Part of the
near-miss improvement in the A/B table above is therefore sampling noise (one question is 17 points of that column).

## Latest run (`results/generation.md`): Haiku judge, cutoff 0.6, one pass

| | |
|---|---|
| answerable: correct / partial / incorrect | 96% / 4% / 0% |
| answerable: false refusal | 0% |
| answerable: faithfulness (claims supported) | 94%, but 44% of answers contain at least one unsupported claim |
| unanswerable: admits the information is missing | 100% |
| unanswerable: handled correctly (admits **and** invents nothing) | 38% |

How to read this:

- The agent is **correct** on almost every answerable question, never refuses wrongly, and **admits missing information in all 13 unanswerable cases**.
- **The 38% is a judge artifact, not agent behaviour.** Reading the verdicts, the Haiku judge marks the assistant's own boilerplate ("solo puedo ayudar con trámites de seguros", "realicé dos búsquedas") and generic pointers ("la SRE se encarga de los pasaportes") as unsupported claims. The Sonnet judge in the A/B run did not. Use the Sonnet judge before quoting a "handled correctly" number.
- **A real tendency to pad**: many answerable answers add small details the passages do not state ("debe estar firmado", "los requisitos varían según la aseguradora"). Mostly harmless, occasionally wrong. A stricter "only state what the results say" instruction is the obvious next experiment.
- `faq-imss` stays *partial*: asked whether the clinic can issue an IMSS incapacidad, the agent answers from the IMSS procedure instead of saying plainly that the clinic is private and does not serve IMSS patients (the FAQ passage was retrieved). A genuine quality gap.

## Limits

One sample per question, one judge, and judges disagree: Haiku vs Sonnet changed one headline number from 92% to 38%.
Treat the numbers as a smoke test that catches regressions and obvious failures, not as a benchmark.
