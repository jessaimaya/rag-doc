import { ingestPDFFromURL } from '../scripts/ingest-documents';

/**
 * Simple API endpoint to trigger document ingestion
 * This runs in the background to avoid timeouts
 */
export async function handleIngestRequest(url: string) {
  // Start ingestion in background (don't await)
  ingestPDFFromURL(url, { category: 'General' })
    .then(result => {
      if (result.success) {
        console.log('✅ Ingestion completed:', result.fileName);
      } else {
        console.error('❌ Ingestion failed:', result.error);
      }
    })
    .catch(err => {
      console.error('❌ Ingestion error:', err);
    });

  // Return immediately
  return {
    status: 'started',
    message: 'Ingestion started in background. Check logs for progress.',
  };
}
