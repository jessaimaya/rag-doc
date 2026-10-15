# Deployment Guide

This guide will help you deploy your Medical Insurance Assistant to Railway.

## Prerequisites

1. **Railway Account**: Sign up at [railway.app](https://railway.app)
2. **GitHub Account**: Your code should be in a GitHub repository
3. **API Keys**: Have your API keys ready:
   - Anthropic API Key
   - Voyage AI API Key
   - Postgres connection string (Railway Postgres with pgvector)

## Why Railway?

### Railway Benefits:
- ✅ **Easy Deployment**: Deploy directly from GitHub
- ✅ **Environment Variables**: Secure configuration management
- ✅ **Auto-scaling**: Handles traffic automatically
- ✅ **Free Credits**: $5/month free credits (enough for testing)

### Pricing:
- **Free**: $5 credit per month (≈500 hours of small instance)
- **Hobby**: $5/month execution time (pay as you go)
- **Pro**: $20/month for more resources

## Deployment Steps

### 1. Prepare Your Repository

Ensure these files are committed to your GitHub repository:
- ✅ `Dockerfile` (created)
- ✅ `railway.json` (created)
- ✅ `.dockerignore` (created)
- ✅ `package.json`
- ✅ All source code

### 2. Push to GitHub

```bash
git add .
git commit -m "Add Railway deployment configuration"
git push origin main
```

### 3. Deploy to Railway

1. **Go to Railway**: Visit [railway.app](https://railway.app)
2. **Login with GitHub**: Click "Login with GitHub"
3. **Create New Project**: Click "+ New Project"
4. **Deploy from GitHub**: Select "Deploy from GitHub repo"
5. **Select Repository**: Choose your `whats-app-doc` repository
6. **Railway will automatically**:
   - Detect the Dockerfile
   - Build the container
   - Deploy the application

### 4. Configure Environment Variables

In Railway dashboard, go to your project > Variables tab and add:

```env
ANTHROPIC_API_KEY=sk-ant-api03-...
VOYAGE_API_KEY=pa-...
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME
DB_PASSWORD=your_db_password
```


### 5. Run Initial Data Ingestion

After deployment, you need to ingest your PDF documents:

**Option A: Using Railway CLI**
```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Link to your project
railway link

# Run ingestion
railway run npm run ingest
```

**Option B: Create a One-Time Job**
In Railway dashboard:
1. Add a new service
2. Select "One-off Job"
3. Use command: `npm run ingest`
4. This will populate your Postgres database

### 6. Test Your Deployment

Once deployed, Railway will provide a URL like:
```
https://your-app.example.com
```

Visit the Mastra UI at that URL to test your agent.

## Alternative Platforms

If you want to explore other options:

### Render.com
- **Pros**: Free tier available, simple deployment
- **Cons**: Free tier sleeps after inactivity
- **IPv6**: ✅ Supported
- **Cost**: Free tier + $7/month for always-on

### Fly.io
- **Pros**: Free tier, global edge deployment, IPv6 support
- **Cons**: More complex configuration
- **IPv6**: ✅ Supported
- **Cost**: Free tier (limited resources)

### Vercel
- **Pros**: Excellent for Next.js/frontend, free tier
- **Cons**: Serverless (not ideal for long-running agents)
- **IPv6**: ✅ Supported
- **Cost**: Free tier available

### Railway (Recommended)
- **Pros**: Easy setup, great DX, IPv6, Docker support
- **Cons**: No completely free tier
- **IPv6**: ✅ Supported
- **Cost**: $5 free credits/month

## Platform Comparison

| Platform | Free Tier | IPv6 | Ease | Docker | Best For |
|----------|-----------|------|------|--------|----------|
| Railway  | $5 credit | ✅   | ⭐⭐⭐ | ✅     | Production |
| Render   | Yes*      | ✅   | ⭐⭐⭐ | ✅     | Side projects |
| Fly.io   | Limited   | ✅   | ⭐⭐   | ✅     | Global apps |
| Vercel   | Yes       | ✅   | ⭐⭐⭐ | ❌     | Frontends |

*Free tier sleeps after 15 min inactivity

## Post-Deployment Checklist

- [ ] Application deployed successfully
- [ ] Environment variables configured
- [ ] Postgres connection working
- [ ] Documents ingested into Postgres
- [ ] Agent responding to queries
- [ ] Test with real medical insurance questions

## Monitoring

Railway provides:
- **Logs**: Real-time application logs
- **Metrics**: CPU, memory, bandwidth usage
- **Alerts**: Get notified of issues

## Troubleshooting

### Connection to Postgres fails
- ✅ Railway has IPv6, so this should work
- Check environment variables are set correctly
- Verify DATABASE_URL string is correct

### Out of memory
- Increase Railway instance size (costs more)
- Optimize document chunking size
- Reduce concurrent embeddings

### Build fails
- Check Dockerfile syntax
- Ensure all dependencies in package.json
- Review Railway build logs

## Cost Estimation

### Railway Monthly Cost:
```
Base instance: $5-10/month
+ Bandwidth: ~$0.10/GB
+ Build time: Usually free
────────────────────────
Estimated: $5-15/month for small usage
```

### API Costs:
```
Anthropic (Claude Haiku): $0.25/M input, $1.25/M output
Voyage AI: $0.12/M tokens
────────────────────────
Estimated: $5-20/month depending on usage
```

### Total Estimated Cost: $10-35/month

## Next Steps

1. Deploy to Railway
2. Test the connection to Postgres
3. Ingest your PDF documents
4. Test the agent with real queries
5. Monitor usage and costs

## Support

- **Railway Docs**: https://docs.railway.app
- **Railway Discord**: https://discord.gg/railway
- **This Project**: Check VECTOR_STORE_EXPLANATION.md for architecture details
