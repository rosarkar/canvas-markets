# Canvas Cup — Provably-Fair World Cup Prediction Game

**Superteam "World Cup" Hackathon · Track: Consumer & Fan Experiences · TxODDS × Solana**

A consumer-friendly World Cup prediction game where fans pick outcomes, climb a
leaderboard, and earn rewards — with every result **settled provably-fairly against
TxLINE's on-chain Merkle root on Solana**. It ships on **two surfaces**: a polished
web app *and* Telegram (Canvas's native home).

> The trust problem with prediction games is "how do I know the result wasn't fudged?".
> Canvas Cup answers it cryptographically: each settlement cites the on-chain
> `daily_scores_roots` account that anchors the verified result.

## What fans do

- **Predict** — tap a match, pick an outcome (odds from TxLINE StablePrice), stake points.
- **Win** — correct picks pay **points × odds**; winners' profit maps to a claimable
  **USDC reward** via Canvas's existing payout rail / Bankr.
- **Compete** — streaks 🔥, records, and a live **leaderboard** 🏆.
- **Trust it** — every settlement is **on-chain-verified** (TxLINE proof), shown as a badge.

## Two surfaces

- **Web** (`npm run fan` → `http://localhost:4400/fan/`): live match board, one-tap bet slip,
  your card (points/streak/record/reward), leaderboard, provably-fair result badges.
- **Telegram** (`/predict`, `/leaderboard`, `/mypicks`): the same game via inline keyboards,
  running inside the Canvas bot — group-native, zero install. Shares one prediction store, so
  web and Telegram players compete on the same board.

## Run it

```bash
npm install
npm run fan            # web → http://localhost:4400/fan/
```

Enter a name, tap an outcome, stake points, then **Simulate result** to watch settlement +
the on-chain proof badge (a demo trigger — live matches settle automatically from the feed).
The Telegram flow (`/predict`) runs inside the main bot (`npm run dev`).

## Provably fair + real Solana data

Built on the shared TxLINE foundation (`src/services/txline/`): fixtures + StablePrice odds
from TxLINE, and settlement verification against the on-chain `daily_scores_roots` Merkle
root (`src/services/txline/verify.ts`). With `USE_TXLINE=true` + a funded devnet wallet the
game runs on **real on-chain-verified World Cup data**; otherwise it uses clearly-labelled
sample fixtures so the demo always works.

## Architecture

```
resolveOddsFeed() ── TxLineFeed (Solana) | FixtureFeed (labelled)
        │
        ▼
src/services/fan/store.ts   points, streaks, leaderboard, settlement (shared)
        │
        ├── src/api/fan.ts        → public/fan/ web app
        └── src/telegram/handlers/predict.ts  → /predict, /leaderboard, /mypicks
                          │
        settlement ── verifyScore() → daily_scores_roots PDA (on-chain proof)
                          │
        rewards ── existing escrow/payout rail (releaseEscrowPayout) / Bankr
```

## Files

```
src/services/fan/store.ts          predictions, points, streaks, provably-fair settle (+ tests)
src/api/fan.ts                     /api/fan/* (board, predict, me, leaderboard, settle)
src/fan-server.ts                  standalone web server (npm run fan)
public/fan/index.html              the fan web app
src/telegram/handlers/predict.ts   /predict game in Telegram
src/services/txline/*              shared real TxLINE (Solana) foundation + on-chain verify
```

## Honesty

Free-to-play points. On sample fixtures the result is drawn from the fair odds for the demo
and labelled as such; with a funded TxLINE feed the on-chain-verified result settles the game.
Settlement always cites its `daily_scores_roots` proof account. Rewards use Canvas's real Base
USDC payout rail when configured. No fabricated results or traction.
