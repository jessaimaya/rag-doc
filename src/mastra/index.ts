import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { insuranceAgent } from './agents/insurance-agent';
import { createApiMiddleware, createRateLimiter, resolveApiKey } from './security';

// Throws at startup when MASTRA_API_KEY is missing outside development
const apiKey = resolveApiKey(process.env);
const limiter = createRateLimiter({
  limit: Number(process.env.RATE_LIMIT_PER_MIN) || 30,
  windowMs: 60_000,
});

export const mastra = new Mastra({
  agents: { insuranceAgent },
  storage: new LibSQLStore({
    // stores observability, scores, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  telemetry: {
    // Telemetry is deprecated and will be removed in the Nov 4th release
    enabled: false,
  },
  observability: {
    // Disabled to prevent PostHog network errors on Railway
    default: { enabled: false },
  },
  server: {
    middleware: [
      {
        handler: createApiMiddleware({ apiKey, limiter }),
        path: '/api/*',
      },
    ],
  },
});
