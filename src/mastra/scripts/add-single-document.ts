import 'dotenv/config';
import { ingestPDFFromFile, ingestPDFFromURL } from './ingest-documents';

/**
 * Quick script to add a single document to the knowledge base
 *
 * Usage:
 * From file: npx tsx src/mastra/scripts/add-single-document.ts file ./path/to/document.pdf IMSS
 * From URL:  npx tsx src/mastra/scripts/add-single-document.ts url https://example.com/doc.pdf ISSSTE
 */

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('❌ Invalid arguments');
    console.log('\nUsage:');
    console.log('  From file: npx tsx src/mastra/scripts/add-single-document.ts file <path> [category]');
    console.log('  From URL:  npx tsx src/mastra/scripts/add-single-document.ts url <url> [category]');
    console.log('\nCategories: IMSS, ISSSTE, Private, Hospital Procedures, General');
    process.exit(1);
  }

  const [type, source, category] = args;

  if (type === 'file') {
    await ingestPDFFromFile(source, { category });
  } else if (type === 'url') {
    await ingestPDFFromURL(source, { category });
  } else {
    console.log('❌ Invalid type. Use "file" or "url"');
    process.exit(1);
  }
}

main().catch(console.error);
