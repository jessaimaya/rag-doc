# Medical Insurance Assistant - Frontend

Chat interface for the Mexican medical insurance assistant (Spanish UI, light and dark themes).

## Features

- Answers render as real Markdown (section headings, lists, bold, tables, links that open in a new tab). Raw HTML in an answer is never rendered.
- Starter questions that match the indexed documents (IMSS, ISSSTE, GNP, reimbursement, patient rights, the fictional clinic), plus a note that the clinic is fictional.
- Clear states: "searching the documents" while waiting, a plain-language error with a retry button (rate limit, offline, timeout, backend down), and a new-conversation button.
- Composer: Enter sends, Shift+Enter adds a line, the box grows with the text, 2000-character limit with a counter near the end.
- Long answers open at their first line instead of scrolling to the bottom; respects reduced-motion; works at phone width.
- The backend keeps no memory, so every request sends the conversation (last 30 messages). The route accepts user messages up to 2000 characters and assistant messages up to 8000, because answers are often longer than 2000.

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
