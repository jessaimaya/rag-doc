# Retrieval eval — 2026-10-15

50 in-scope questions, 531 chunks. Relevant = right document + all `mustContain` phrases. Rerank pool 30, top 10.

### All in-scope questions (n=50)

| config | Hit@1 | Hit@3 | Hit@5 | MRR@10 | p50 latency |
|---|---|---|---|---|---|
| hybrid[3:1] | 66% | 82% | 84% | 0.760 | 4 ms |
| hybrid[3:1]+rerank | 88% | 98% | 100% | 0.931 | 210 ms |

### Tag: semantic (n=28)

| config | Hit@1 | Hit@3 | Hit@5 | MRR@10 | p50 latency |
|---|---|---|---|---|---|
| hybrid[3:1] | 54% | 71% | 75% | 0.655 | 4 ms |
| hybrid[3:1]+rerank | 82% | 96% | 100% | 0.894 | 210 ms |

### Tag: lexical (n=17)

| config | Hit@1 | Hit@3 | Hit@5 | MRR@10 | p50 latency |
|---|---|---|---|---|---|
| hybrid[3:1] | 88% | 100% | 100% | 0.941 | 4 ms |
| hybrid[3:1]+rerank | 94% | 100% | 100% | 0.971 | 210 ms |

### Tag: exact (n=5)

| config | Hit@1 | Hit@3 | Hit@5 | MRR@10 | p50 latency |
|---|---|---|---|---|---|
| hybrid[3:1] | 60% | 80% | 80% | 0.729 | 4 ms |
| hybrid[3:1]+rerank | 100% | 100% | 100% | 1.000 | 210 ms |

### Questions missed at top 5

- **hybrid[3:1]**: faq-imss, guia-quien-llena, sura-defuncion, imss-subsidio, imss-140bis, metlife-verificar, conamed-rechazar, conamed-obligaciones
- **hybrid[3:1]+rerank**: none

### Can the rerank score tell answerable from unanswerable questions?

Top-1 rerank score on in-scope vs out-of-scope questions. AUROC 1.0 = perfect separation, 0.5 = chance.

| config | in-scope min | in-scope median | out-of-scope median | out-of-scope max | AUROC | best cutoff (accuracy) |
|---|---|---|---|---|---|---|
| hybrid[3:1]+rerank | 0.695 | 0.861 | 0.446 | 0.512 | 1.000 | 0.695 (100%) |

_Small sample: differences of one or two questions are within noise._
