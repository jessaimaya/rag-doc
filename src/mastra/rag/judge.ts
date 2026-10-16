import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { z } from 'zod';

/**
 * LLM judge for answer quality. It sees the question, the passages the agent retrieved, the gold passages (when the
 * corpus has an answer) and the final answer, and returns structured judgments. Default judge is Haiku to keep test runs cheap (noisier than a stronger judge);
 * set EVAL_JUDGE_MODEL=claude-sonnet-5-5 for a more reliable verdict.
 */

/**
 * What the judge must return for each answer. `claims` is the heart: each factual statement is checked against the
 * RETRIEVED passages (not against the judge's own knowledge), which measures faithfulness. `declined` and `admitsMissing`
 * tell refusals apart from honest "I don't have that" answers, `correctness` compares with the gold passages, and
 * `reason` makes a verdict auditable. The zod schema validates the model's JSON and fills defaults.
 *
 * Further reading:
 * - Es et al., "Ragas: Automated Evaluation of Retrieval Augmented Generation" (faithfulness): https://arxiv.org/abs/2309.15217
 */
export const judgmentSchema = z.object({
  claims: z
    .array(z.object({ claim: z.string(), supported: z.boolean() }))
    .describe('Specific factual claims in the answer and whether the RETRIEVED passages support each one'),
  declined: z.boolean().default(false).describe('The answer says it cannot help or lacks the information, and gives no substantive answer'),
  admitsMissing: z
    .boolean()
    .default(false)
    .describe('The answer explicitly says that the information asked for is not available or is out of scope, even if it adds other useful information'),
  correctness: z.enum(['correct', 'partial', 'incorrect', 'not_applicable']),
  reason: z.string().describe('One sentence explaining the verdict'),
});

export type Judgment = z.infer<typeof judgmentSchema>;

/**
 * The judge's instructions. The key choices: it is "strict", outside knowledge does not count as support (a true but
 * ungrounded claim is still a RAG failure), boilerplate such as disclaimers is not listed as a claim (it would inflate
 * the score), and it must answer with bare JSON so the output can be parsed without a structured-output feature.
 */
const SYSTEM = `You are a strict evaluator of a Spanish-language assistant that answers questions about medical insurance paperwork in Mexico using a knowledge base. You are given the user's question, the passages the assistant RETRIEVED, optionally GOLD passages known to contain the answer, and the assistant's ANSWER.

Return:
- claims: every specific factual claim in the answer (numbers, prices, deadlines, requirements, documents, steps, names, conditions). Mark supported=true only if the RETRIEVED passages state it or clearly imply it; knowledge from outside the passages is NOT support, even if true. Do NOT list: headings and formatting, generic disclaimers (e.g. "esto no es consejo médico"), suggestions to contact an institution, and statements that the information is unavailable.
- declined: true if the answer says it cannot help, is outside its scope, or does not have the information, and gives no substantive answer to what was asked. A partial answer with caveats is NOT declined.
- admitsMissing: true if the answer explicitly says that the specific information asked for is not available in its knowledge base or is outside what it can help with, even if it also offers other related information. (declined implies admitsMissing.)
- correctness: if GOLD passages are given: "correct" when the answer states the key fact(s) in the gold passages without contradicting them; "partial" when it is vague, incomplete or mixes correct and unsupported content; "incorrect" when it contradicts the gold, answers something else, or declines although the answer was available. If there are no gold passages, use "not_applicable".
- reason: one sentence.

Respond with ONLY a JSON object, no prose and no code fences, exactly in this shape:
{"claims":[{"claim":"...","supported":true}],"declined":false,"admitsMissing":false,"correctness":"correct","reason":"..."}`;

/**
 * Everything the judge sees: the question, what the agent retrieved, the gold passages (empty when the corpus has no answer) and the final answer.
 */
export interface JudgeInput {
  question: string;
  retrieved: string[];
  gold: string[];
  answer: string;
}

/**
 * Formats passages as a numbered list so the judge can refer to them; '(none)' when there are none.
 */
const numbered = (items: string[]) => (items.length ? items.map((t, i) => `[${i + 1}] ${t}`).join('\n\n') : '(none)');

/**
 * Returns the first balanced {...} object in the text. Models sometimes wrap the JSON in code fences or add prose
 * before or after it, so instead of JSON.parse on the whole reply this scans for the first '{' and walks to its matching
 * '}', ignoring braces inside strings (and escaped quotes).
 */
export function firstJsonObject(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) throw new Error(`Judge returned no JSON: ${text.slice(0, 120)}`);
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`Judge JSON is not closed: ${text.slice(0, 120)}`);
}

/**
 * Extracts the JSON object and validates it with the schema. Throws if it is missing or malformed.
 */
export function parseJudgment(text: string): Judgment {
  return judgmentSchema.parse(JSON.parse(firstJsonObject(text)));
}

/**
 * Asks the judge model to grade one answer.
 *
 * The prompt lists the question, the retrieved passages, the gold passages (or states that the corpus has no answer) and
 * the answer. LLM output is not always valid JSON, so a parse or validation failure retries up to 3 times before the
 * last error is thrown. The default judge is Haiku to keep eval runs cheap; EVAL_JUDGE_MODEL switches to a stronger one.
 *
 * Further reading:
 * - Zheng et al., "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena": https://arxiv.org/abs/2306.05685
 */
export async function judgeAnswer(input: JudgeInput): Promise<Judgment> {
  const prompt = [
    `QUESTION:\n${input.question}`,
    `RETRIEVED PASSAGES:\n${numbered(input.retrieved)}`,
    input.gold.length ? `GOLD PASSAGES (the corpus contains the answer here):\n${numbered(input.gold)}` : 'GOLD PASSAGES: none. The corpus does NOT contain an answer to this question.',
    `ANSWER:\n${input.answer}`,
  ].join('\n\n');

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    // No temperature: current Claude models reject it.
    const { text } = await generateText({ model: anthropic(process.env.EVAL_JUDGE_MODEL || 'claude-haiku-5-5'), system: SYSTEM, prompt });
    try {
      return parseJudgment(text);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
