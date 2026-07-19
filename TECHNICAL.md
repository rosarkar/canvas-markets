# Canvas Markets — Technical Documentation

**Track 01 · Prediction Markets & Settlement** — Superteam World Cup Hackathon (TxODDS × Solana)

Canvas Markets is a risk-managed World Cup betting desk. It reads de-margined fair odds from an on-chain feed, sizes each bet with the Kelly criterion, compares the fair line against Polymarket's price to flag mispricing, and composes a settlement order through Bankr. Every value on the board is labelled with how real it is, so nothing is shown as live that isn't.

Live site: https://canvas-markets.vercel.app · Repo: https://github.com/rosarkar/canvas-markets (branch `worldcup-markets`)

---

## Architecture

```
Solana (devnet/mainnet)                Backend (this repo)                 Frontend (Vercel, Next.js)
┌──────────────────────┐   subscribe   ┌───────────────────────────┐       ┌────────────────────────┐
│ txoracle program     │◀──────────────│ txline/{client,program,   │       │ pages/index.tsx        │
│ daily_scores_merkle  │   apiToken    │   wallet}.ts (on-chain     │──────▶│  World Cup board       │
│ roots                │──────────────▶│   auth)                   │  /api │  + risk copilot        │
└──────────────────────┘               │ txline/feed.ts (StablePrice│       └────────────────────────┘
                                        │   → MatchOdds)            │              │
        Polymarket Gamma API   ────────▶│ odds-feed.ts (live|sample)│              │ /api/chat → Kimi
        (implied price / edge)          │ api/markets.ts (REST)     │
                                        │ markets-settle.ts ───────▶│ Bankr → Polymarket USDC (Polygon)
                                        └───────────────────────────┘
```

The backend is a small Express app (`src/markets-server.ts`) that mounts the markets router and a diagnostics route. It needs no database — odds, math, and settlement only.

## Request / data flow

1. The frontend calls `GET /api/markets`.
2. `resolveOddsFeed()` (`src/services/odds-feed.ts`) picks the feed once per process: the live on-chain `TxLineFeed` when `USE_TXLINE=true` and the subscription succeeds, otherwise a labelled sample feed. The choice is cached for the process.
3. `TxLineFeed` (`src/services/txline/feed.ts`) returns `MatchOdds`: for each fixture, a 1X2 market with a de-margined `fairProb`, decimal `odds`, and an `edge`.
4. The risk layer sizes each outcome with the Kelly criterion against the caller's bankroll and estimates ruin probability.
5. The Polymarket enrichment attaches an implied probability and the resulting edge (`polymarketEdge = fairProb − polymarketProb`) so mispriced outcomes are visible.
6. On settle, `markets-settle.ts` composes the exact Bankr order and (when live settlement is enabled) submits it via `src/services/bankr.client.ts`.

## TxLINE on-chain access (no static API key)

Access is minted per session, on-chain (`src/services/txline/{client,program,wallet}.ts`):

1. `subscribe(serviceLevel, weeks)` on the txoracle Anchor program → a Solana subscription transaction.
2. Request a guest JWT from `/auth/guest/start`.
3. Sign `` `${txSig}:${leagues}:${jwt}` `` with the wallet.
4. `POST /api/token/activate` → an `apiToken` (returned as `text/plain`).
5. Call the REST/SSE feed with `Authorization: Bearer <jwt>` and `X-Api-Token: <apiToken>`.

Free tiers: devnet level 1 is realtime; mainnet level 1 is a 60-second delay, level 12 is realtime.

## Honesty tiers

Every number and settlement carries a tier (`src/services/txline/{merkle,verify}.ts`):

- **verified-on-chain** — a real Merkle inclusion proof checked against the on-chain `daily_scores_merkle_roots` root.
- **root-anchored** — the day's root is on-chain; the proof is recomputed and verified locally.
- **demonstration / sample** — a real Merkle proof computed over sample data, never presented as live.

The site never labels sample data as on-chain-verified. A `/judges` page lets anyone open the subscription wallet on Solana Explorer and confirm the feed access.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/markets` | Board of fixtures with fair prob, odds, edge, Polymarket edge, provenance + `source` (`txodds-live` / `fixture`) |
| GET | `/api/markets/match/:id` | Single fixture |
| POST | `/api/markets/risk` | Kelly stake + ruin probability for an outcome at a given bankroll |
| POST | `/api/markets/hedge` | Hedge sizing for an open position |
| POST | `/api/markets/intent` | Compose a Bankr settlement order (dry run) |
| POST | `/api/markets/settle` | Settle a position via Bankr |
| GET | `/api/feed-status` | Diagnostics: `useTxline`, wallet pubkey + live SOL balance, how the feed resolved, last error, and a live Polymarket probe |
| GET | `/health` | `{ ok, service: "canvas-markets" }` |

## Key modules

- `src/markets-server.ts` — Express entry; mounts `marketsRouter` + `feedStatusRouter`.
- `src/api/markets.ts` — REST surface above.
- `src/services/odds-feed.ts` — `resolveOddsFeed()` (live-vs-sample gate) + `getFeedStatus()`.
- `src/services/txline/feed.ts` — TxLINE StablePrice → `MatchOdds`.
- `src/services/txline/{client,program,wallet}.ts` — on-chain subscribe/activate + wallet.
- `src/services/txline/{merkle,verify}.ts` — Merkle proofs and the honesty tiering.
- `src/services/markets-settle.ts` — settlement / Bankr order composition.
- `src/services/bankr.client.ts` — Bankr Agent API client.
- `src/services/markets-agent.ts` — the risk copilot (edge, sizing, ruin, hedging advice).
- `src/api/feed-status.ts` — deployment diagnostics.
- `src/services/polymarket.ts` — Polymarket Gamma enrichment. *(Ships on the deployed markets branch `track-trading-agent`; being consolidated onto `worldcup-markets`.)*

## Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `USE_TXLINE` | `false` | Use the live on-chain TxLINE feed; otherwise labelled sample fixtures |
| `SOLANA_DEVNET_SECRET_KEY` | — | base58 or JSON secret for the subscription wallet (needs devnet SOL) |
| `SOLANA_NETWORK` | `devnet` | `devnet` or `mainnet` |
| `POLYMARKET_GAMMA_URL` | `https://gamma-api.polymarket.com` | Polymarket Gamma API (public, no key) |
| `POLYMARKET_WC_TAG` | `world-cup` | Gamma tag for the tournament |
| `BANKR_API_KEY` | — | Bankr execution (settlement stays simulated without it) |
| `MARKETS_LIVE_SETTLEMENT` | `false` | Place real Bankr orders on settle |
| `KIMI_API_KEY` | — | Frontend `/api/chat` copilot (set on Vercel) |

## Run locally

```bash
npm install
npm run markets                 # → http://localhost:4000  (labelled sample fixtures)
# live feed (needs a funded devnet wallet):
USE_TXLINE=true SOLANA_DEVNET_SECRET_KEY=<base58> npm run markets
npm run txline:smoke            # end-to-end TxLINE check (subscribe → token → fetch)
npm test                        # unit tests incl. merkle/verify
```

## Deployment

- **Backend** — Railway, Docker build; `railway.toml` start command `node dist/markets-server.js` (build: `tsc && tsc-alias`). Set `USE_TXLINE=true` + `SOLANA_DEVNET_SECRET_KEY` for live odds. `GET /api/feed-status` reports exactly why the board is live or on fixtures.
- **Frontend** — Next.js on Vercel; `CANVAS_MARKETS_URL` proxies `/api/markets/*` to the Railway service, `KIMI_API_KEY` powers the copilot chat.

## What is real vs simulated

Real: the TxLINE StablePrice odds, the on-chain subscription/access, the Merkle proof mechanism, the Polymarket implied prices. Simulated by default: Bankr settlement (composes the exact order but moves no funds until `MARKETS_LIVE_SETTLEMENT` + `BANKR_API_KEY` are set). Every surface is labelled accordingly.
