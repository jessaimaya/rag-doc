# How to Ingest Documents on Railway

Since your local machine doesn't have IPv6, you can't connect to the remote Postgres locally. You need to run ingestion **on Railway** where IPv6 works.

## Method 1: One-Off Command (Easiest) ⭐

### Step 1: Upload PDFs to a Public URL
Upload your PDF to:
- Google Drive (make it public)
- Dropbox (public link)
- GitHub (raw file URL)
- Any file hosting service

### Step 2: Run on Railway Dashboard
1. Go to your Railway project
2. Click on your service
3. Go to **Settings** → **One-off Commands**
4. Enter this command:
   ```bash
   npm run ingest -- --url https://your-pdf-url.pdf
   ```
5. Click "Run"

The ingestion will run inside Railway's container (with IPv6) and populate Postgres!

## Method 2: Railway CLI with Shell Access

### Step 1: Install Railway CLI
```bash
npm install -g @railway/cli
railway login
railway link
```

### Step 2: Open Shell on Railway
```bash
railway shell
```

This opens a shell **inside** your Railway container (with IPv6).

### Step 3: Upload and Ingest
Inside the Railway shell:
```bash
# Option A: If you have PDFs in documents folder (already in container)
npm run ingest

# Option B: Ingest from URL
npm run ingest -- --url https://your-pdf-url.pdf
```

## Method 3: Create Ingestion Service

Create a second Railway service just for ingestion:

### Step 1: In Railway Dashboard
1. Add new service
2. Select "Deploy from GitHub repo"
3. Choose same repository
4. Override Dockerfile: Use `Dockerfile.ingest`

### Step 2: Configure
This service will:
- Run once
- Ingest all PDFs from documents folder
- Exit when done

## Method 4: Temporary Workaround (Use Local SQLite)

If you need to ingest immediately while testing:

### Step 1: Temporarily Switch Back to SQLite
```typescript
// In src/mastra/knowledge/insurance-kb.ts
import { LibSQLVector } from '@mastra/libsql';

export const insuranceVectorStore = new LibSQLVector({
  connectionUrl: 'file:./insurance-kb.db',
});
```

### Step 2: Run Ingestion Locally
```bash
npm run ingest
```

### Step 3: Upload Database to Railway
```bash
railway shell
# Then upload the .db file or use Postgres later
```

## Recommended Approach

**For Production**: Use Method 1 (One-Off Command with URL)

**Why?**
- ✅ Simplest
- ✅ No local IPv6 needed
- ✅ Runs on Railway infrastructure
- ✅ Works with public PDFs

## Example: Ingest from Google Drive

1. Upload PDF to Google Drive
2. Make it public (Anyone with link can view)
3. Get the direct download link:
   ```
   https://drive.google.com/uc?export=download&id=FILE_ID
   ```
4. Run on Railway:
   ```bash
   npm run ingest -- --url "https://drive.google.com/uc?export=download&id=FILE_ID"
   ```

## Example: Ingest from GitHub

1. Push PDF to your repository (in documents folder)
2. Get raw file URL:
   ```
   https://raw.githubusercontent.com/username/repo/main/documents/file.pdf
   ```
3. Run on Railway:
   ```bash
   npm run ingest -- --url "https://raw.githubusercontent.com/username/repo/main/documents/file.pdf"
   ```

## Troubleshooting

### "railway run" gives IPv6 error
- ❌ Don't use `railway run` (runs locally)
- ✅ Use Railway dashboard "One-off Commands" (runs on Railway)
- ✅ Or use `railway shell` then commands inside

### Can't access Railway shell
```bash
railway login
railway link
railway shell
```

### PDF not found
- Check the URL is publicly accessible
- Try opening the URL in incognito browser
- Verify URL points to PDF, not a preview page

## Next Steps

1. **Push your updated code to GitHub**:
   ```bash
   git add .
   git commit -m "Add URL-based ingestion for Railway"
   git push
   ```

2. **Wait for Railway to redeploy**

3. **Upload your PDF to a public URL**

4. **Run ingestion via Railway dashboard**

5. **Test your agent!**

Your documents will be in Postgres and accessible from Railway! 🎉
