import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

async function checkDatabase() {
  console.log('🔍 Checking database connection and pgvector support...\n');

  // Parse connection string to force IPv4
  const connectionString = process.env.DB_CONNECTION;
  if (!connectionString) {
    throw new Error('DB_CONNECTION environment variable is not set');
  }

  const client = new Client({
    connectionString,
    options: '-c search_path=public',
  });

  try {
    // Connect to database
    console.log('📡 Connecting to Postgres...');
    await client.connect();
    console.log('✅ Connected successfully!\n');

    // Check if pgvector extension exists
    console.log('🔍 Checking for pgvector extension...');
    const extensionCheck = await client.query(`
      SELECT * FROM pg_extension WHERE extname = 'vector';
    `);

    if (extensionCheck.rows.length > 0) {
      console.log('✅ pgvector extension is already enabled!');
      console.log(`   Version: ${extensionCheck.rows[0].extversion || 'N/A'}\n`);
    } else {
      console.log('❌ pgvector extension is NOT enabled.\n');
      console.log('🔧 Attempting to enable pgvector...');

      try {
        await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
        console.log('✅ pgvector extension enabled successfully!\n');
      } catch (error) {
        console.log('❌ Failed to enable pgvector automatically.\n');
        console.log('📝 Manual steps required:');
        console.log('   1. Check your Postgres provider dashboard');
        console.log('   2. Navigate to Database > Extensions');
        console.log('   3. Search for "vector" and enable it');
        console.log('   4. Run this script again to verify\n');
        throw error;
      }
    }

    // Check if embeddings table exists
    console.log('🔍 Checking for embeddings table...');
    const tableCheck = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'insurance_embeddings';
    `);

    if (tableCheck.rows.length > 0) {
      console.log('✅ insurance_embeddings table already exists');

      // Count existing embeddings
      const countResult = await client.query('SELECT COUNT(*) FROM insurance_embeddings;');
      console.log(`   Documents in knowledge base: ${countResult.rows[0].count}\n`);
    } else {
      console.log('ℹ️  insurance_embeddings table does not exist yet');
      console.log('   (It will be created automatically when you ingest your first document)\n');
    }

    console.log('='.repeat(50));
    console.log('✅ DATABASE IS READY FOR RAG!');
    console.log('='.repeat(50));
    console.log('\nNext steps:');
    console.log('1. Create a "documents" folder in your project root');
    console.log('2. Add your PDF files to it');
    console.log('3. Run: npm run ingest\n');

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error);
    console.log('\nPlease check:');
    console.log('- Your DB_CONNECTION string in .env');
    console.log('- Network connectivity to Postgres');
    console.log('- Database permissions\n');
    process.exit(1);
  } finally {
    await client.end();
  }
}

checkDatabase();
