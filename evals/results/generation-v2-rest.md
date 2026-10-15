# Generation eval — 2026-10-15

33 questions through the real agent (retrieval → tool → answer), judged by claude-haiku-5-5. Cutoff = minimum rerank score of the best result; below it the tool returns "no relevant documents".

### Answerable questions (n=28)

| metric | cutoff 0.6 |
|---|---|
| agent called the tool | 100% |
| relevant passage retrieved | 100% |
| **answer correct** | 100% |
| answer partial | 0% |
| answer incorrect | 0% |
| false refusal (declined but answerable) | 0% |
| **faithfulness** (supported claims / claims) | 100% |
| answers with ≥1 unsupported claim | 4% |
| answers citing a page/URL that was not retrieved | 0% |

### Unanswerable questions (n=5: out of scope + near miss)

| metric | cutoff 0.6 |
|---|---|
| **handled correctly** (says it is missing, invents nothing) | 60% |
|   out of scope | 0% |
|   near miss (on topic, answer absent) | 75% |
| admits the information is missing | 100% |
| answers with ≥1 unsupported claim | 40% |

### Problem cases (cutoff 0.6)

- **faq-factura-datos** — 1 unsupported claim(s): “La constancia de situación fiscal contiene la mayoría de los datos requeridos.” — _The answer states the key gold facts: the seven required data items, the email to send them to, and the constancia de situación fiscal option, without contradicting the passage; only the 'mayoría' softening of the passage's 'todos estos datos' is unsupported._
- **oos-pozole** — 1 unsupported claim(s): “El asistente solo puede ayudar con temas de trámites de seguros médicos, documentación del” — _The assistant clearly declines the cooking recipe request as outside its scope and states it has no information on recipes, with no retrieved passages or gold passages to contradict it._
- **nm-rodilla** — 1 unsupported claim(s): “No hay requisitos específicos para la consulta de información.” — _La respuesta reconoce explícitamente que no hay información sobre cirugías de rodilla y ofrece datos relacionados del consultorio, que están respaldados por los pasos, precios y horarios recuperados, salvo la afirmación sin soporte sobre requisitos para consultar información._

_Single sample per question at the model's default sampling, judged by one LLM: expect a few points of run-to-run noise._
