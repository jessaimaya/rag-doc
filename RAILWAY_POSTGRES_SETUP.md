# Railway PostgreSQL Setup Guide

This guide walks you through setting up PostgreSQL with pgvector on Railway.

## Benefits of Railway PostgreSQL

**No IPv6 issues** - Everything runs in Railway's internal network
**Lower latency** - Database and app in same infrastructure
**Simpler setup** - No external connection configuration needed

## Step-by-Step Setup

### 1. Deploy pgvector Template in Railway

**Important:** Railway's standard PostgreSQL doesn't include pgvector. You must use a pre-configured template.

**Option A: Deploy pgvector Template (Recommended)**

1. Go to Railway templates: https://railway.com/deploy/pgvector-latest
2. Click **"Deploy Now"**
3. Select your existing project: `02b3ef29-8a8c-42f6-abea-835d824c7adb`
4. Railway deploys PostgreSQL with pgvector pre-installed (~1 minute)

**Option B: Add to Existing Project via Dashboard**

1. Go to your Railway project (https://railway.app/dashboard)
2. Click **"+ New"** button
3. Select **"Template"**
4. Search for **"pgvector"**
5. Select **"Deploy PgVector [Updated Nov '25]"**
6. Click **"Deploy"**

### 2. Remove Old PostgreSQL (If You Created One)

If you created a standard PostgreSQL database earlier:

1. Click on the standard PostgreSQL service
2. Go to **Settings** → **Danger Zone**
3. Click **"Remove Service"**

We'll use the pgvector-enabled one instead.

### 3. Configure Environment Variables

Railway automatically creates `DATABASE_URL` when you deploy the pgvector template.

**Configure Your App Service:**

1. Go to your **app service** (whats-app-doc, NOT the database)
2. Go to **Variables** tab
3. The pgvector service will be named something like "Postgres" or "pgvector"
4. You have two options:

**Option A: Use DATABASE_URL** (Code already supports this)
- Your code will automatically pick up `DATABASE_URL` from Railway
- No changes needed if the pgvector service provides `DATABASE_URL`

**Option B: Reference the pgvector Database**
- Click **"+ New Variable"**
- Name: `DATABASE_URL`
- Value: `${{Postgres.DATABASE_URL}}` (or `${{pgvector.DATABASE_URL}}` depending on the service name)


### 4. Add Telemetry Disable Flag

While you're in Variables, add:

- **Name**: `MASTRA_TELEMETRY_DISABLED`
- **Value**: `1`

This prevents PostHog timeout errors.

### 5. Deploy Updated Code

```bash
git add .
git commit -m "Switch to Railway PostgreSQL"
git push
```

Railway will automatically redeploy.

### 6. Run Database Migration (Create Tables)

After deployment, you need to create the pgvector tables:

**Using Railway One-off Command:**

1. Go to Railway dashboard → Your app service
2. **Settings** → **One-off Commands**
3. Run: `npm run check-db`

This creates the necessary tables and indexes.

### 7. Ingest Your Documents

Now you can ingest documents without IPv6 issues:

**Option A: From URL**
```bash
# In Railway One-off Command:
npm run ingest -- --url https://your-pdf-url.pdf
```

**Option B: From documents folder**
```bash
# In Railway One-off Command:
npm run ingest
```

### 8. Test Your Agent

```bash
./test-agent.sh
```

Should now return proper responses instead of 502 errors!

## Troubleshooting

### "Extension vector does not exist"

You need to enable the pgvector extension:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### "Could not connect to database"

1. Check that PostgreSQL service is running in Railway
2. Verify `DATABASE_URL` exists in your app's environment variables
3. Check that both services are in the same Railway project

### "Table does not exist"

Run the check-db script to create tables:
```bash
railway run npm run check-db
```

### Application still showing 502

1. Check Railway runtime logs for actual error
2. Verify pgvector extension is enabled
3. Ensure `MASTRA_TELEMETRY_DISABLED=1` is set

## Cost Considerations

Railway PostgreSQL pricing:
- **Starter plan**: ~$5-10/month for small databases
- **Scales with usage**: Pay for what you use

- Free tier is IPv6 only (causing your issues)
- IPv4 add-on costs extra
- External network latency

**Railway PostgreSQL is likely cheaper and more reliable for your use case.**

## Migration Complete Checklist

- [ ] PostgreSQL database added to Railway project
- [ ] pgvector extension enabled (`CREATE EXTENSION vector;`)
- [ ] Environment variables configured (DATABASE_URL or DATABASE_URL)
- [ ] MASTRA_TELEMETRY_DISABLED=1 added
- [ ] Code updated and pushed to GitHub
- [ ] Railway redeployed successfully
- [ ] Database tables created (npm run check-db)
- [ ] Documents ingested (`npm run ingest`, or `npm run ingest -- --url <url>`)
- [ ] Agent API tested and working

## Next Steps

Once everything is working:

4. Update your documentation to reflect Railway PostgreSQL setup

Your application should now work smoothly without IPv6 issues!
