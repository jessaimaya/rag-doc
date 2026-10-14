import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { insuranceAgent } from './agents/insurance-agent';
import { insuranceVectorStore } from './knowledge/insurance-kb';

export const mastra = new Mastra({
  agents: { insuranceAgent },
  vectors: {
    insuranceVectorStore,
  },
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
        // Protect all API endpoints with API key authentication
        handler: async (c, next) => {
          const apiKey = c.req.header('x-api-key') || c.req.header('authorization')?.replace('Bearer ', '');
          const validApiKey = process.env.MASTRA_API_KEY;

          // If no API key is configured, allow all requests (development mode)
          if (!validApiKey) {
            console.warn('⚠️  MASTRA_API_KEY not set - API is unprotected!');
            return await next();
          }

          // Check if API key matches
          if (!apiKey || apiKey !== validApiKey) {
            console.warn('🔒 Unauthorized API access attempt from:', c.req.header('user-agent'));
            return new Response(JSON.stringify({ error: 'Unauthorized', message: 'Valid API key required' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          // API key is valid, continue
          return await next();
        },
        path: '/api/*',
      },
    ],
  },
});
