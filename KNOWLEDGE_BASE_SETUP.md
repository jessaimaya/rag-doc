# Insurance Agent - Knowledge Base Setup

This guide explains how to add insurance documents to your agent's knowledge base using RAG (Retrieval-Augmented Generation).

## Overview

Your insurance agent now uses a PostgreSQL vector database to store and retrieve information from your insurance documents. When users ask questions, the agent automatically searches the knowledge base for relevant information.

## Quick Start

### 1. Prepare Your Documents

Create a `documents` folder in your project root:

```bash
mkdir documents
```

Add your PDF files to this folder. Organize them by category if you want:

```
documents/
├── IMSS_formulario_afiliacion.pdf
├── ISSSTE_guia_tramites.pdf
├── hospital_procedimientos.pdf
└── seguro_privado_coberturas.pdf
```

### 2. Ingest All Documents

Run the ingestion script to process all PDFs in the `documents` folder:

```bash
npm run ingest
```

This will:
- Extract text from each PDF
- Split text into chunks
- Generate embeddings
- Store everything in PostgreSQL

The script automatically categorizes documents based on filename keywords (IMSS, ISSSTE, hospital, etc.).

### 3. Add a Single Document

To add one document at a time:

**From a local file:**
```bash
npm run add-doc file ./path/to/document.pdf IMSS
```

**From a URL:**
```bash
npm run add-doc url https://example.com/document.pdf ISSSTE
```

Available categories:
- `IMSS`
- `ISSSTE`
- `Private`
- `Hospital Procedures`
- `General`

## How It Works

### Document Processing Flow

1. **PDF → Text Extraction**: Uses `pdf2json` to extract text from PDFs
2. **Text → Chunks**: Splits text into 1000-character chunks with 200-character overlap
3. **Chunks → Embeddings**: Uses OpenAI's `text-embedding-3-small` model
4. **Embeddings → Database**: Stores in PostgreSQL with pgvector extension

### When the Agent is Asked a Question

1. User asks: "¿Cómo registro a mi hijo en el IMSS?"
2. Agent converts question to embedding
3. Searches knowledge base for similar content
4. Retrieves top relevant chunks
5. Uses chunks as context to answer in Spanish

## Database Setup

Your knowledge base uses PostgreSQL with the pgvector extension. The connection is configured in `.env`:

```env
DB_CONNECTION=postgresql://postgres:password@host:5432/postgres
```

The embeddings are stored in the `insurance_embeddings` table, which is automatically created when you first ingest documents.

## Knowledge Base Configuration

The knowledge base is configured in `src/mastra/knowledge/insurance-kb.ts`:

- **Vector Store**: PostgreSQL with pgvector
- **Embedding Model**: OpenAI text-embedding-3-small
- **Chunk Size**: 1000 characters
- **Chunk Overlap**: 200 characters

## Advanced Usage

### Manual Document Addition

You can programmatically add documents in your code:

```typescript
import { insuranceKnowledgeBase } from './src/mastra/knowledge/insurance-kb';

await insuranceKnowledgeBase.addDocuments([
  {
    content: "Your document text here...",
    metadata: {
      fileName: "custom-doc.pdf",
      fileType: "PDF",
      category: "IMSS",
      uploadDate: new Date().toISOString(),
    },
  },
]);
```

### Querying the Knowledge Base

The agent automatically queries the knowledge base, but you can also query it directly:

```typescript
const results = await insuranceKnowledgeBase.query({
  query: "¿Cómo registro a mi hijo en el IMSS?",
  topK: 5, // Number of results to return
});
```

## Best Practices

1. **Organize by Category**: Use clear filenames with keywords (IMSS, ISSSTE, hospital)
2. **Regular Updates**: Re-ingest documents when they're updated
3. **Clean PDFs**: Ensure PDFs have selectable text (not just images)
4. **Metadata**: Add custom metadata to help with filtering and organization

## Troubleshooting

### No text extracted from PDF

- Make sure the PDF contains selectable text (not scanned images)
- Try opening the PDF and copying text to verify it's extractable

### Database connection errors

- Verify your `DB_CONNECTION` string in `.env`
- Ensure PostgreSQL has the pgvector extension installed
- Check database permissions

### Embeddings not being generated

- Verify your `OPENAI_API_KEY` in `.env`
- Check your OpenAI account has credits
- Look for rate limiting errors in console output

## Example Workflow

```bash
# 1. Add your documents
mkdir documents
cp ~/Desktop/insurance_forms/*.pdf documents/

# 2. Ingest all documents
npm run ingest

# 3. Start the agent
npm run dev

# 4. Test in the playground at http://localhost:4111
# Ask: "¿Qué documentos necesito para registrar a mi hijo en el IMSS?"
```

## File Structure

```
src/mastra/
├── knowledge/
│   └── insurance-kb.ts          # Knowledge base configuration
├── scripts/
│   ├── ingest-documents.ts      # Batch ingestion script
│   └── add-single-document.ts   # Single document script
├── agents/
│   └── insureance-agent.ts      # Agent with KB attached
└── lib/
    └── util.ts                  # PDF extraction utilities
```

## Next Steps

- Add your insurance documents to the `documents` folder
- Run `npm run ingest` to process them
- Start testing with `npm run dev`
- Ask questions in Spanish about insurance procedures!
