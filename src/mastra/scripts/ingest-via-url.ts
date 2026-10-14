import 'dotenv/config';
import { ingestPDFFromURL } from './ingest-documents';

/**
 * Ingest a PDF from a URL
 * This can be called from Railway where IPv6 works
 *
 * Usage:
 * NODE_ENV=production tsx src/mastra/scripts/ingest-via-url.ts <pdf-url>
 */

async function main() {
  const pdfUrl = process.argv[2];

  if (!pdfUrl) {
    console.error('❌ Please provide a PDF URL');
    console.log('Usage: npm run ingest-url <pdf-url>');
    process.exit(1);
  }

  console.log('🚀 Starting PDF ingestion from URL...');
  console.log('📄 URL:', pdfUrl);

  const result = await ingestPDFFromURL(pdfUrl, {
    category: 'General'
  });

  if (result.success) {
    console.log('\n✅ Ingestion completed successfully!');
  } else {
    console.log('\n❌ Ingestion failed:', result.error);
    process.exit(1);
  }
}

main().catch(console.error);
