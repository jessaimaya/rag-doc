/** A passage the assistant retrieved while answering, shaped for display. */
export interface Source {
  title: string;
  section?: string;
  page?: number;
  sourceUrl?: string;
  /** Reranker score, 0 to 1. */
  relevance: number;
  excerpt: string;
}

const MAX_SOURCES = 6;
const MAX_EXCERPT = 700;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Only plain web links are shown as links; anything else (javascript:, data:, ...) is dropped. */
function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function toSource(item: unknown): Source | null {
  if (!isRecord(item) || typeof item.title !== 'string' || typeof item.text !== 'string') return null;
  const relevance = typeof item.relevance === 'number' && Number.isFinite(item.relevance) ? Math.min(1, Math.max(0, item.relevance)) : 0;
  return {
    title: item.title,
    ...(typeof item.section === 'string' && item.section ? { section: item.section } : {}),
    ...(typeof item.page === 'number' ? { page: item.page } : {}),
    ...(safeUrl(item.sourceUrl) ? { sourceUrl: safeUrl(item.sourceUrl) } : {}),
    relevance,
    excerpt: item.text.trim().slice(0, MAX_EXCERPT),
  };
}

/**
 * Pulls the retrieved passages out of the backend's agent response (every call to the retrieval tool, across all steps).
 * The route sends only this to the browser: the raw response also carries provider headers, token usage and tool arguments.
 */
export function extractSources(data: unknown): Source[] {
  if (!isRecord(data)) return [];
  const results: unknown[] = [];
  const steps = Array.isArray(data.steps) ? data.steps : [];
  for (const step of steps) {
    const toolResults = isRecord(step) && Array.isArray(step.toolResults) ? step.toolResults : [];
    for (const tr of toolResults) {
      const payload = isRecord(tr) ? tr.payload : undefined;
      const result = isRecord(payload) ? payload.result : undefined;
      if (isRecord(payload) && payload.toolName === 'insuranceRAGTool' && isRecord(result) && Array.isArray(result.results)) {
        results.push(...result.results);
      }
    }
  }

  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const item of results) {
    const source = toSource(item);
    if (!source) continue;
    const key = [source.title, source.section, source.page, source.excerpt.slice(0, 80)].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }
  return sources.sort((a, b) => b.relevance - a.relevance).slice(0, MAX_SOURCES);
}
