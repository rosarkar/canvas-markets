# Canvas Edge — Technical Documentation

**Track 02 · Trading Tools & Agents** — Superteam World Cup Hackathon (TxODDS × Solana)

Canvas Edge is an autonomous betting agent. It reads the live World Cup board each tick, bets only positive-EV lines sized with the Kelly criterion, and enforces hard risk limits with a one-click kill switch. It reacts to live goals and trades the dislocation before the market reprices, and every goal-triggered bet carries a real Merkle proof against the on-chain root. The full decision feed and open positions stay on screen.

Live site: https://canvas-markets.vercel.app/agent · Repo: https://github.com/rosarkar/canvas-markets (branch `track-trading-agent`)

---

## Architecture

```
                        Backend (this repo)                              Frontend (Vercel, Next.js)
┌──────────────────────────────────────────────────────────┐            ┌───────────────────────────┐
│ agent-server.ts (Express, in-memory state)                │            │ pages/agent.tsx           │
│   ├─ services/agent/loop.ts     (tick loop / scheduler)   │   /api/    │  stats · risk sliders     │
│   ├─ services/agent/strategy.ts (edge, Kelly, risk gate)  │◀──────────▶│  decision feed · positions│
│   ├─ services/agent/executor.ts (place / settle, proof)   │   agent    │  goal trigger · kill sw.  │
│   └─ services/odds-feed.ts      (live TxLINE | sample)    │            └───────────────────────────┘
└──────────────────────────────────────────────────────────┘
        ▲ StablePrice odds (TxLINE)          ▼ Merkle proof vs on-chain root (goal-trigger settlement)
   Solana txoracle program + daily_scores_merkle_roots
```

`src/agent-server.ts` is a self-contained Express service (in-memory state, no database). It shares the TxLINE feed resolver and the Merkle/verify layer with the other two tracks.

## The agent loop

Each tick (`src/services/agent/loop.ts` → `strategy.ts` → `executor.ts`):

1. Read the live board via `resolveOddsFeed()` (`src/services/odds-feed.ts`).
2. For every outcome, compute the edge against the de-margined fair line and a Kelly stake.
3. Pass each candidate through the **risk gate**: minimum edge, Kelly fraction, max stake, daily loss cap, ruin stop. The decision is `bet`, `skip`, or `blocked`, and it is logged to the decision feed with a reason.
4. Placed bets become positions; they resolve to `won` / `lost` with realized P&L.
5. **Goal-event trigger**: an injected goal creates a `goal-trigger` decision. It settles on the true probability (not an inflated one), de-dupes against existing holdings, and attaches a real Merkle proof against the on-chain root (`src/services/txline/{merkle,verify}.ts`).
6. The **kill switch** stops the loop and sets max stake to 0, so no further bets can be placed.

## Risk limits

| Limit | Meaning |
|---|---|
| `minEdge` | Skip any outcome below this edge |
| `kellyFraction` | Fraction of full Kelly to stake (e.g. half-Kelly) |
| `maxStakeUsd` | Cap on a single stake |
| `dailyLossCapUsd` | Stop betting once the day's realized loss hits this |
| `ruinStopFraction` | Stop if bankroll falls to this fraction of the start |

All are adjustable live from the UI and via `POST /api/agent/risk`.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/agent/state` | Running flag, mode, source, bankroll, realized P&L, open positions, risk limits, decision feed, positions |
| GET | `/api/agent/matches` | Fixtures available for the goal trigger |
| POST | `/api/agent/start` / `/stop` | Start or stop the tick loop |
| POST | `/api/agent/tick` | Advance one evaluation cycle |
| POST | `/api/agent/reset` | Reset bankroll and state |
| POST | `/api/agent/risk` | Update one or more risk limits |
| POST | `/api/agent/goal` | Inject a live goal event → `goal-trigger` bet + Merkle proof |
| GET | `/api/feed-status` | Diagnostics: `useTxline`, wallet + live SOL balance, feed resolution, Polymarket probe |
| GET | `/health` | `{ ok, service: "canvas-edge" }` |

## TxLINE on-chain access (shared)

Access is minted per session, on-chain (`src/services/txline/{client,program,wallet}.ts`): `subscribe(serviceLevel, weeks)` on the txoracle Anchor program → guest JWT from `/auth/guest/start` → sign `` `${txSig}:${leagues}:${jwt}` `` → `POST /api/token/activate` (token returned as `text/plain`) → call the feed with `Authorization: Bearer <jwt>` + `X-Api-Token: <apiToken>`. Without `USE_TXLINE=true` and a funded wallet the agent runs on labelled sample fixtures.

## Key modules

- `src/agent-server.ts` — Express entry; mounts the agent + feed-status routers.
- `src/services/agent/loop.ts` — tick scheduler and state.
- `src/services/agent/strategy.ts` — edge, Kelly sizing, risk gate.
- `src/services/agent/executor.ts` — place / settle, goal-trigger proof.
- `src/services/agent/types.ts` — decision, position, and risk types.
- `src/services/odds-feed.ts` — live TxLINE vs sample feed + `getFeedStatus()`.
- `src/services/txline/{merkle,verify}.ts` — Merkle proof + honesty tiering.
- `src/services/polymarket.ts` — Polymarket Gamma implied-probability enrichment.
- `src/api/feed-status.ts` — deployment diagnostics.

## Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `USE_TXLINE` | `false` | Use the live on-chain TxLINE feed; otherwise labelled sample fixtures |
| `SOLANA_DEVNET_SECRET_KEY` | — | base58/JSON secret for the subscription wallet (needs devnet SOL) |
| `SOLANA_NETWORK` | `devnet` | `devnet` or `mainnet` |
| `POLYMARKET_GAMMA_URL` | `https://gamma-api.polymarket.com` | Polymarket Gamma API (public, no key) |
| `POLYMARKET_WC_TAG` | `world-cup` | Gamma tag for the tournament |
| `PORT` | `4000` | HTTP port |

## Run locally

```bash
npm install
npm run agent                   # → http://localhost:4000  (sample fixtures)
USE_TXLINE=true SOLANA_DEVNET_SECRET_KEY=<base58> npm run agent   # live feed
npm test                        # unit tests incl. agent strategy + merkle/verify
```

Seed a session: `POST /api/agent/reset` → several `POST /api/agent/tick` → `POST /api/agent/goal` for a verified goal-trigger.

## Deployment

Railway, Docker build; `railway.toml` start command `node dist/agent-server.js`. The service is self-contained (in-memory state, no DB/secret needed to boot). Set `USE_TXLINE=true` + `SOLANA_DEVNET_SECRET_KEY` for live odds. The frontend proxies `/api/agent/*` to this service via `CANVAS_AGENT_URL`.

## What is real vs simulated

Real: the StablePrice odds, the on-chain access, and the Merkle proof on each goal-trigger. Simulated: order execution (the agent composes and records trades; it does not move real funds). Settlement outcomes on the demo run over sample scores and are labelled as such.
