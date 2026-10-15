# Retrieval eval — 2026-10-15

50 in-scope questions, 531 chunks. Relevant = right document + all `mustContain` phrases. Rerank pool 30, top 10.

### All in-scope questions (n=50)

| config | Hit@1 | Hit@3 | Hit@5 | MRR@10 | p50 latency |
|---|---|---|---|---|---|
| vector | 76% | 90% | 92% | 0.837 | 4 ms |
| bm25 | 42% | 72% | 76% | 0.568 | 0 ms |
| hybrid | 62% | 78% | 86% | 0.726 | 4 ms |
| vector+rerank | 86% | 98% | 100% | 0.921 | 195 ms |
| bm25+rerank | 78% | 86% | 88% | 0.821 | 173 ms |
| hybrid+rerank | 86% | 98% | 100% | 0.921 | 207 ms |

### Tag: semantic (n=28)

| config | Hit@1 | Hit@3 | Hit@5 | MRR@10 | p50 latency |
|---|---|---|---|---|---|
| vector | 68% | 86% | 89% | 0.777 | 4 ms |
| bm25 | 25% | 54% | 61% | 0.391 | 0 ms |
| hybrid | 46% | 68% | 79% | 0.605 | 4 ms |
| vector+rerank | 79% | 96% | 100% | 0.876 | 195 ms |
| bm25+rerank | 64% | 75% | 79% | 0.698 | 173 ms |
| hybrid+rerank | 79% | 96% | 100% | 0.876 | 207 ms |

### Tag: lexical (n=17)

| config | Hit@1 | Hit@3 | Hit@5 | MRR@10 | p50 latency |
|---|---|---|---|---|---|
| vector | 88% | 100% | 100% | 0.941 | 4 ms |
| bm25 | 76% | 100% | 100% | 0.882 | 0 ms |
| hybrid | 88% | 100% | 100% | 0.941 | 4 ms |
| vector+rerank | 94% | 100% | 100% | 0.971 | 195 ms |
| bm25+rerank | 94% | 100% | 100% | 0.971 | 173 ms |
| hybrid+rerank | 94% | 100% | 100% | 0.971 | 207 ms |

### Tag: exact (n=5)

| config | Hit@1 | Hit@3 | Hit@5 | MRR@10 | p50 latency |
|---|---|---|---|---|---|
| vector | 80% | 80% | 80% | 0.820 | 4 ms |
| bm25 | 20% | 80% | 80% | 0.492 | 0 ms |
| hybrid | 60% | 60% | 80% | 0.669 | 4 ms |
| vector+rerank | 100% | 100% | 100% | 1.000 | 195 ms |
| bm25+rerank | 100% | 100% | 100% | 1.000 | 173 ms |
| hybrid+rerank | 100% | 100% | 100% | 1.000 | 207 ms |

### Questions missed at top 5

- **vector**: guia-quien-llena, imss-subsidio, imss-140bis, conamed-obligaciones
- **bm25**: faq-no-show, faq-imss, guia-quien-llena, sura-defuncion, issste-lic-urgencias, issste-domicilio, imss-citt, imss-subsidio, metlife-rectificacion, metlife-verificar, conamed-segunda-opinion, conamed-rechazar
- **hybrid**: faq-imss, guia-quien-llena, sura-defuncion, imss-subsidio, imss-140bis, metlife-verificar, conamed-rechazar
- **vector+rerank**: none
- **bm25+rerank**: faq-imss, sura-defuncion, imss-subsidio, metlife-verificar, conamed-segunda-opinion, conamed-rechazar
- **hybrid+rerank**: none

### Can the rerank score tell answerable from unanswerable questions?

Top-1 rerank score on in-scope vs out-of-scope questions. AUROC 1.0 = perfect separation, 0.5 = chance.

| config | in-scope min | in-scope median | out-of-scope median | out-of-scope max | AUROC | best cutoff (accuracy) |
|---|---|---|---|---|---|---|
| vector+rerank | 0.695 | 0.861 | 0.445 | 0.512 | 1.000 | 0.695 (100%) |
| bm25+rerank | 0.504 | 0.859 | 0.445 | 0.510 | 0.997 | 0.504 (98%) |
| hybrid+rerank | 0.695 | 0.861 | 0.445 | 0.510 | 1.000 | 0.695 (100%) |

_Small sample: differences of one or two questions are within noise._
