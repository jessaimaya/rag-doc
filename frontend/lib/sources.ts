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

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

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
 * Turns the retrieval tool's raw `results` arrays (one per search) into the cards shown under an answer: deduplicated across
 * searches, sorted by relevance, at most MAX_SOURCES. The browser only ever gets this; the raw agent output also carries
 * provider details, token usage and tool arguments.
 */
export function collectSources(resultArrays: unknown[]): Source[] {
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const item of resultArrays.flatMap((r) => (Array.isArray(r) ? r : []))) {
    const source = toSource(item);
    if (!source) continue;
    const key = [source.title, source.section, source.page, source.excerpt.slice(0, 80)].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }
  return sources.sort((a, b) => b.relevance - a.relevance).slice(0, MAX_SOURCES);
}
