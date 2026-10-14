import 'dotenv/config';
import { insuranceVectorStore } from '../knowledge/insurance-kb';
import { MDocument } from '@mastra/rag';
import { extractTextFromPDF } from '../lib/util';
import { VoyageAIClient } from 'voyageai';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Ingests PDF documents into the insurance vector store
 *
 * Usage:
 * 1. Place your PDF files in the 'documents' folder at the project root
 * 2. Run: npm run ingest
 */

// Initialize Voyage AI client
const voyageClient = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY });

interface DocumentMetadata {
  fileName: string;
  fileType: string;
  uploadDate: string;
  category?: string; // e.g., 'IMSS', 'ISSSTE', 'Private', 'Hospital Procedures'
}

async function ingestPDFFromFile(filePath: string, metadata?: Partial<DocumentMetadata>) {
  try {
    console.log(`\n📄 Processing: ${filePath}`);

    // Read the PDF file
    const pdfBuffer = fs.readFileSync(filePath);

    // Extract text from PDF
    console.log('📝 Extracting text from PDF...');
    const { extractedText, pagesCount } = await extractTextFromPDF(pdfBuffer);

    console.log(`✅ Extracted ${extractedText.length} characters from ${pagesCount} pages`);

    // Prepare metadata
    const fileName = path.basename(filePath);
    const fullMetadata: DocumentMetadata = {
      fileName,
      fileType: 'PDF',
      uploadDate: new Date().toISOString(),
      category: metadata?.category || 'General',
      ...metadata,
    };

    // Create MDocument and chunk it
    console.log('🔄 Chunking document...');
    const doc = MDocument.fromText(extractedText, fullMetadata);
    const chunks = await doc.chunk({
      strategy: 'recursive',
      size: 1000,
      overlap: 200,
    });

    console.log(`✅ Created ${chunks.length} chunks`);

    // Add to vector store with embeddings
    console.log('🔄 Generating embeddings and storing...');

    const documents = chunks.map(chunk => chunk.getText());
    const ids = chunks.map((chunk, i) => chunk.id_ || `${fileName}-chunk-${i}`);
    const metadatas = chunks.map(chunk => chunk.metadata || {});

    console.log(`Debug: documents count=${documents.length}, ids count=${ids.length}, metadatas count=${metadatas.length}`);

    // Ensure index exists before upserting
    try {
      await insuranceVectorStore.createIndex({
        indexName: 'insurance_embeddings',
        dimension: 1024, // voyage-3 dimension
        metric: 'cosine',
      });
      console.log('✅ Index created or already exists');
    } catch (e) {
      // Index might already exist, that's okay
      console.log('ℹ️  Index creation skipped (may already exist)');
    }

    // Generate embeddings for the documents using Voyage AI
    const embeddingResult = await voyageClient.embed({
      input: documents,
      model: 'voyage-3',
    });
    const vectors = embeddingResult.data.map(item => item.embedding);

    await insuranceVectorStore.upsert({
      indexName: 'insurance_embeddings',
      vectors: vectors,
      ids: ids,
      metadata: metadatas,
    });

    console.log(`✅ Successfully ingested: ${fileName}`);
    return { success: true, fileName };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ Error processing ${filePath}:`, errorMessage);
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
    return { success: false, fileName: path.basename(filePath), error: errorMessage };
  }
}

async function ingestPDFFromURL(url: string, metadata?: Partial<DocumentMetadata>) {
  try {
    console.log(`\n🌐 Downloading PDF from: ${url}`);

    // Download the PDF
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download PDF: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    console.log(`✅ Downloaded ${pdfBuffer.length} bytes`);

    // Extract text from PDF
    console.log('📝 Extracting text from PDF...');
    const { extractedText, pagesCount } = await extractTextFromPDF(pdfBuffer);

    console.log(`✅ Extracted ${extractedText.length} characters from ${pagesCount} pages`);

    // Prepare metadata
    const fileName = url.split('/').pop() || 'unknown.pdf';
    const fullMetadata: DocumentMetadata = {
      fileName,
      fileType: 'PDF',
      uploadDate: new Date().toISOString(),
      category: metadata?.category || 'General',
      ...metadata,
    };

    // Create MDocument and chunk it
    console.log('🔄 Chunking document...');
    const doc = MDocument.fromText(extractedText, fullMetadata);
    const chunks = await doc.chunk({
      strategy: 'recursive',
      size: 1000,
      overlap: 200,
    });

    console.log(`✅ Created ${chunks.length} chunks`);

    // Add to vector store with embeddings
    console.log('🔄 Generating embeddings and storing...');

    const documents = chunks.map(chunk => chunk.getText());
    const ids = chunks.map((chunk, i) => chunk.id_ || `${fileName}-chunk-${i}`);
    const metadatas = chunks.map(chunk => chunk.metadata || {});

    console.log(`Debug: documents count=${documents.length}, ids count=${ids.length}, metadatas count=${metadatas.length}`);

    // Ensure index exists before upserting
    try {
      await insuranceVectorStore.createIndex({
        indexName: 'insurance_embeddings',
        dimension: 1024, // voyage-3 dimension
        metric: 'cosine',
      });
      console.log('✅ Index created or already exists');
    } catch (e) {
      // Index might already exist, that's okay
      console.log('ℹ️  Index creation skipped (may already exist)');
    }

    // Generate embeddings for the documents using Voyage AI
    const embeddingResult = await voyageClient.embed({
      input: documents,
      model: 'voyage-3',
    });
    const vectors = embeddingResult.data.map(item => item.embedding);

    await insuranceVectorStore.upsert({
      indexName: 'insurance_embeddings',
      vectors: vectors,
      ids: ids,
      metadata: metadatas,
    });

    console.log(`✅ Successfully ingested: ${fileName}`);
    return { success: true, fileName };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ Error processing ${url}:`, errorMessage);
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
    return { success: false, fileName: url, error: errorMessage };
  }
}

async function ingestFromDirectory(directoryPath: string) {
  console.log(`\n📁 Scanning directory: ${directoryPath}`);

  if (!fs.existsSync(directoryPath)) {
    console.error(`❌ Directory does not exist: ${directoryPath}`);
    return;
  }

  const files = fs.readdirSync(directoryPath);
  const pdfFiles = files.filter(file => file.toLowerCase().endsWith('.pdf'));

  console.log(`Found ${pdfFiles.length} PDF file(s)\n`);

  const results = [];

  for (const file of pdfFiles) {
    const filePath = path.join(directoryPath, file);

    // Try to infer category from filename or directory structure
    let category = 'General';
    if (file.toLowerCase().includes('imss')) category = 'IMSS';
    else if (file.toLowerCase().includes('issste')) category = 'ISSSTE';
    else if (file.toLowerCase().includes('hospital')) category = 'Hospital Procedures';
    else if (file.toLowerCase().includes('privado') || file.toLowerCase().includes('private')) category = 'Private';

    const result = await ingestPDFFromFile(filePath, { category });
    results.push(result);
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 INGESTION SUMMARY');
  console.log('='.repeat(50));
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  console.log(`✅ Successfully ingested: ${successful}`);
  console.log(`❌ Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFailed files:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.fileName}: ${r.error}`);
    });
  }
}

// Main execution
async function main() {
  console.log('🚀 Starting document ingestion...\n');

  // Check if documents directory exists
  const documentsDir = path.join(process.cwd(), 'documents');

  if (fs.existsSync(documentsDir)) {
    await ingestFromDirectory(documentsDir);
  } else {
    console.log('📝 No "documents" directory found.');
    console.log('\nTo use this script:');
    console.log('1. Create a "documents" folder in your project root');
    console.log('2. Place your PDF files in that folder');
    console.log('3. Run this script again\n');

    console.log('Or use the functions directly in your code:');
    console.log('- ingestPDFFromFile(filePath, metadata)');
    console.log('- ingestPDFFromURL(url, metadata)');
  }

  console.log('\n✅ Ingestion process completed!');
}

// Export functions for use in other scripts
export { ingestPDFFromFile, ingestPDFFromURL, ingestFromDirectory };

// Run if called directly (ES module way)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch(console.error);
}
