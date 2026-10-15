# Generation eval — 2026-10-15

30 questions through the real agent (retrieval → tool → answer), judged by claude-haiku-5-5. Cutoff = minimum rerank score of the best result; below it the tool returns "no relevant documents".

### Answerable questions (n=22)

| metric | cutoff 0.6 |
|---|---|
| agent called the tool | 100% |
| relevant passage retrieved | 95% |
| **answer correct** | 95% |
| answer partial | 5% |
| answer incorrect | 0% |
| false refusal (declined but answerable) | 0% |
| **faithfulness** (supported claims / claims) | 98% |
| answers with ≥1 unsupported claim | 18% |
| answers citing a page/URL that was not retrieved | 0% |

### Unanswerable questions (n=8: out of scope + near miss)

| metric | cutoff 0.6 |
|---|---|
| **handled correctly** (says it is missing, invents nothing) | 50% |
|   out of scope | 50% |
|   near miss (on topic, answer absent) | 50% |
| admits the information is missing | 100% |
| answers with ≥1 unsupported claim | 50% |

### Problem cases (cutoff 0.6)

- **faq-imss** — 1 unsupported claim(s): “No puedo emitir ni tramitar su incapacidad, ya que soy un asistente de información sobre d” — _The answer clearly states it cannot issue or process the incapacidad and directs the user to the IMSS process, which matches the gold fact that only IMSS's own medical staff issue such incapacidades, though it does not explicitly state it is not an IMSS unit._
- **sura-incapacidad** — partial · 1 unsupported claim(s): “El Informe médico debe llenarlo y firmarlo el médico que atendió al asegurado.” — _La respuesta acierta aviso, último recibo de sueldo y forma IMSS/carta de empleo, pero no identifica el Informe médico como el punto 2 de la lista de incapacidad y declara incompleta esa lista, aunque el pasaje la muestra._
- **sura-defuncion** — 1 unsupported claim(s): “La Declaración 1 debe estar firmada por los beneficiarios o sus representantes legales.” — _La respuesta reproduce con precisión la lista de documentos de SURA del pasaje de referencia, aunque añade la palabra 'firmado' no respaldada, y reconoce explícitamente que no encontró el plazo ni documentos de otras aseguradoras._
- **metlife-rectificacion** — 1 unsupported claim(s): “El plazo para pedir la rectificación es de 30 días naturales desde la recepción de la póli” — _The answer states the key gold fact: the right to request rectification within 30 days of receiving the policy, after which its terms are considered accepted, without contradicting it._
- **oos-francia** — 2 unsupported claim(s): “El asistente solo puede ayudar con trámites y documentación de seguros médicos, trámites h”; “La pregunta sobre la capital de Francia está fuera de ese alcance.” — _The answer declines the out-of-scope question about France's capital, explicitly stating it is outside the assistant's scope, with no retrieved passages supporting any claim._
- **oos-migrana** — 1 unsupported claim(s): “El asistente es especializado en trámites y documentación de seguros médicos en México (IM” — _The answer refuses to recommend a migraine medication, explicitly states the knowledge base lacks this information, and redirects to a doctor and insurer, which matches the empty retrieval and no gold passages._
- **oos-sat** — 1 unsupported claim(s): “La base de conocimiento solo cubre trámites de seguros médicos (IMSS, ISSSTE y aseguradora” — _The answer clearly declines to answer the SAT tax question, stating the information is outside its knowledge base, which is correct given no passages were retrieved and no gold passages exist._
- **nm-sura-dia** — 1 unsupported claim(s): “El monto diario depende de la póliza específica del asegurado.” — _The answer explicitly states it lacks the daily hospitalization amount and provides only related claim requirements and contact details that are supported by the retrieved SURA form, with one unsupported inference about policy dependence._

_Single sample per question at the model's default sampling, judged by one LLM: expect a few points of run-to-run noise._
