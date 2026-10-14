# Medical Insurance Assistant - Frontend

Beautiful chat interface for the Mexican Medical Insurance Assistant.

## Features

- 💬 Clean ChatGPT-style interface
- 🇲🇽 Spanish language UI
- 📱 Responsive design
- ⚡ Real-time responses from Mastra API
- 🎨 Tailwind CSS styling

## Getting Started

### Development

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Environment Variables

Create a `.env.local` file:

```bash
NEXT_PUBLIC_API_URL=http://localhost:4111
```

For production (Railway):
```bash
NEXT_PUBLIC_API_URL=https://your-backend.example.com
```

## Deployment to Railway

### Option 1: Deploy as Separate Service (Recommended)

1. In Railway dashboard, click **"+ New"**
2. Select **"GitHub Repo"** → Choose this repository
3. Add environment variable:
   - `NEXT_PUBLIC_API_URL` = `https://your-backend.example.com`
4. Under **Settings** → **Build**:
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`

Railway will auto-detect Next.js and deploy!

### Option 2: Deploy Using Railway CLI

```bash
cd frontend
railway init
railway up
```

## Tech Stack

- **Next.js 15** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **React Hooks** - State management

## Project Structure

```
frontend/
├── app/
│   ├── page.tsx       # Main chat interface
│   ├── layout.tsx     # Root layout
│   └── globals.css    # Global styles
├── public/            # Static assets
└── package.json       # Dependencies
```

## Features

### Chat Interface
- Message history
- Auto-scroll to bottom
- Loading states
- Error handling
- Sample questions for quick start

### API Integration
- Connects to Mastra backend
- Sends conversation history
- Displays assistant responses
- Graceful error handling
