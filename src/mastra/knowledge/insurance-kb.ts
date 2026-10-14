import { createGraphRAGTool } from '@mastra/rag';
import { PgVector } from '@mastra/pg';
import { VoyageAIClient } from 'voyageai';

// Initialize Voyage AI client
const voyageClient = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });

// Create an AI SDK v1-compatible embedder wrapper for Voyage AI
const voyageEmbedder = {
  specificationVersion: 'v1',
  modelId: 'voyage-3',
  provider: 'voyageai',
  maxEmbeddingsPerCall: 128,
  supportsParallelCalls: true,

  async doEmbed({ values }: { values: string[] }) {
    const result = await voyageClient.embed({
      input: values,
      model: 'voyage-3',
    });
    return {
      embeddings: result.data.map(item => item.embedding),
    };
  },
};

// Create the vector store using PostgreSQL with pgvector
// Works with both Railway's DATABASE_URL and custom DB_CONNECTION
export const insuranceVectorStore = new PgVector({
  connectionString: process.env.DATABASE_URL || process.env.DB_CONNECTION || '',
});

// Create the RAG tool that the agent will use
export const insuranceRAGTool = createGraphRAGTool({
  model: voyageEmbedder as any,
  vectorStoreName: 'insuranceVectorStore',
  indexName: 'insurance_embeddings',
  description: 'Search through Mexican medical insurance documentation including IMSS, ISSSTE, private insurance forms, procedures, and hospital information',
  topK: 5, // Return top 5 most relevant chunks
  graphOptions: {
    dimension: 1024, // Voyage-3 embedding dimension
  },
});
