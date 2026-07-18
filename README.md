# Canvas Markets

Risk-managed World Cup betting copilot. TxLINE StablePrice odds → Kelly sizing → Monte Carlo ruin analysis → conversational AI agent → Bankr settlement.

Built for the Superteam World Cup Hackathon (TxODDS × Solana).

## Setup

```bash
npm install
cp .env.example .env.local
# add ANTHROPIC_API_KEY and CANVAS_RAILWAY_URL to .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy to Vercel

1. Push to GitHub
2. Import repo in Vercel
3. Add environment variables:
   - `ANTHROPIC_API_KEY`
   - `CANVAS_RAILWAY_URL` = `https://canvas-ai-production-eae7.up.railway.app`
4. Deploy

## Architecture

- **Frontend**: Next.js on Vercel
- **AI agent**: `/api/chat` proxies Anthropic API server-side (key never exposed)
- **Market data**: proxied from Canvas Railway backend (`/api/markets`, `/api/agent`, `/api/fan`)
- **Risk math**: Kelly criterion, de-vig, edge calculation in `lib/risk.ts`
- **Settlement**: Bankr cross-chain execution (simulated by default)

## Tracks

- **Trading Tools & Agents**: Canvas Edge autonomous agent (`/agent`)
- **Prediction Markets & Settlement**: Risk desk with Kelly + Monte Carlo + hedging (`/`)
- **Consumer & Fan Experiences**: Canvas Cup prediction game (`/fan`)
