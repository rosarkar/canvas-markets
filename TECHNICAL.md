# Canvas Cup — Technical Documentation

**Track 03 · Consumer & Fan Experiences** — Superteam World Cup Hackathon (TxODDS × Solana)

Canvas Cup is a free-to-play World Cup prediction game. You predict across the full slate for points and climb a live leaderboard with streaks and a personal record. Each result settles from a real Merkle inclusion proof over the day's on-chain scores, so the standings can't be quietly changed, and every settled prediction links to its proof on Solana Explorer whether you win or lose.

Live site: https://canvas-markets.vercel.app/fan · Repo: https://github.com/rosarkar/canvas-markets (branch `track-fan-experience`)

---

## Architecture

```
                     Backend (this repo)                                Frontend (Vercel, Next.js)
┌────────────────────────────────────────────────────────┐             ┌──────────────────────────┐
│ fan-server.ts (Express, in-memory prediction store)     │             │ pages/fan.tsx            │
│   ├─ api/fan.ts        (board, predict, settle, board)  │   /api/fan  │  join · match board      │
│   ├─ odds-feed.ts      (fixtures / live odds)           │◀───────────▶│  leaderboard · streaks   │
│   └─ txline/{merkle,   (proof + honesty tiering)        │             │  your predictions        │
│        verify}.ts                                       │             │  settle → proof banner   │
└────────────────────────────────────────────────────────┘             └──────────────────────────┘
        settlement proof ▲ ▼ checked against
   Solana daily_scores_merkle_roots (on-chain root)
```

`src/fan-server.ts` is a self-contained Express service. Players and predictions live in memory, so it boots with no database or Telegram credentials.

## Game flow

1. A player joins with a handle (persisted client-side in `localStorage`).
2. `GET /api/fan/board` returns the fixtures with decimal odds and fair probabilities; `GET /api/fan/leaderboard` returns ranked players.
3. `POST /api/fan/predict` stakes points on an outcome. Predictions start `open`.
4. `POST /api/fan/settle` resolves a match. It picks the result, then builds a **Merkle inclusion proof** over the day's results and checks it against the on-chain root. Winning predictions pay out at the stored odds; the player's points, streak, and record update immediately.
5. Each settled prediction is tagged with its proof, and the settle response returns the proof reference + a Solana Explorer link.

## Provably-fair settlement

The settlement proof is the core of the track (`src/services/txline/{merkle,verify}.ts`):

- The day's results are hashed into a **Merkle root**.
- Each result carries an **inclusion proof** — the sibling hashes that recompute the root from a single leaf (`txline:v1:<epochDay>:<matchId>:<outcome>:<score>`).
- The proof is verified against the on-chain `daily_scores_merkle_roots` account. The result is labelled **verified-on-chain**, **root-anchored**, or **demonstration** (a real proof over sample scores, never presented as live).

This is what "provably-fair" means here: a player can recompute and check any result, so the leaderboard can't be edited without detection.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/fan/board` | Fixtures with odds, fair prob, settled flag |
| GET | `/api/fan/leaderboard` | Ranked players (points, wins, losses, streak) |
| GET | `/api/fan/me?player=<handle>` | A player's points, record, rank, and predictions |
| POST | `/api/fan/predict` | Stake points on an outcome (`{player, matchId, outcome, stakePoints}`) |
| POST | `/api/fan/settle` | Settle a match → winner, score, payouts, and a Merkle proof |
| GET | `/health` | `{ ok, service: "canvas-cup" }` |

Settlement response includes `proof` with `tier`, `verified`, `rootPda`, `rootPdaExplorerUrl`, `leafPreimage`, and the sibling `steps`.

## TxLINE on-chain access (shared)

Odds and scores come from the same on-chain TxLINE path used across all three tracks (`src/services/txline/{client,program,wallet}.ts`): `subscribe(serviceLevel, weeks)` on the txoracle Anchor program → guest JWT → sign `` `${txSig}:${leagues}:${jwt}` `` → `POST /api/token/activate` (token as `text/plain`) → feed with `Authorization: Bearer <jwt>` + `X-Api-Token: <apiToken>`.

## Key modules

- `src/fan-server.ts` — Express entry; serves the fan router + `/health`.
- `src/api/fan.ts` — board, leaderboard, me, predict, settle.
- `src/services/txline/merkle.ts` — Merkle root + inclusion proof.
- `src/services/txline/verify.ts` — proof verification + honesty tiering.
- `src/services/odds-feed.ts` — fixtures / live odds resolver.
- `src/services/txline/{client,program,wallet}.ts` — on-chain access.

## Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `USE_TXLINE` | `false` | Use the live on-chain TxLINE feed; otherwise labelled sample fixtures |
| `SOLANA_DEVNET_SECRET_KEY` | — | base58/JSON secret for the subscription wallet |
| `SOLANA_NETWORK` | `devnet` | `devnet` or `mainnet` |
| `PORT` / `FAN_PORT` | `4400` | HTTP port |

## Run locally

```bash
npm install
npm run fan                     # → http://localhost:4400
# then, e.g.
curl -XPOST localhost:4400/api/fan/predict -H 'content-type: application/json' \
     -d '{"player":"you","matchId":"wc26-fra-eng","outcome":"HOME","stakePoints":100}'
curl -XPOST localhost:4400/api/fan/settle  -H 'content-type: application/json' \
     -d '{"matchId":"wc26-fra-eng"}'        # returns the Merkle proof
npm test                        # unit tests incl. merkle/verify
```

## Deployment

Railway, Docker build; `railway.toml` start command `node dist/fan-server.js`. Self-contained (in-memory store, no DB/secret needed to boot). The frontend proxies `/api/fan/*` to this service via `CANVAS_FAN_URL`.

## What is real vs simulated

Real: the Merkle proof mechanism, verification, and the honesty tiering. On the demo, match results settle over sample scores and are labelled **demonstration**; with `USE_TXLINE=true` and a funded wallet, scores come from the live on-chain feed and settlements anchor to the real day root.
