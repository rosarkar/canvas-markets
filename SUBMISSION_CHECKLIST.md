# Canvas Markets — Submission Checklist

Everything below is dashboard/config only (no code changes). The frontend
(`canvas-markets.vercel.app`) already deploys from `main`. This wires up the
live on-chain data and finalizes the submission.

Hackathon: Superteam × TxODDS × Solana "World Cup" — deadline **19 July 2026**.

---

## A) Railway — deploy the 3 backends

All from this repo (`rosarkar/canvas-markets`) at <https://railway.app/new> →
*Deploy from GitHub repo*. For each service: **Settings → Source → Branch** =
the branch below → **Variables → Raw Editor** → paste the env block → wait for
green → **Settings → Networking → Generate Domain** → copy the URL.

| Service            | Branch                 | Start command (auto via railway.toml) | Copy URL as |
| ------------------ | ---------------------- | ------------------------------------- | ----------- |
| ☐ Edge Agent       | `track-trading-agent`  | `node dist/agent-server.js`           | AGENT_URL   |
| ☐ Canvas Cup       | `track-fan-experience` | `node dist/fan-server.js`             | FAN_URL     |
| ☐ Risk Desk (Mkts) | `worldcup-markets`     | `node dist/markets-server.js`         | MARKETS_URL |

**Env block — the same for all three services:**

```
USE_TXLINE=true
SOLANA_NETWORK=devnet
TXLINE_SERVICE_LEVEL=1
SOLANA_DEVNET_SECRET_KEY=<devnet secret for wallet EKRgJifhv4xsfRNFnSLY93NDoLVa39udENVQLC59s4sg>
```

> The wallet already holds ~1 devnet SOL (enough for all three to `subscribe`).
> No database or other secrets are required — the servers stub what they don't use.
> Keep the secret key OUT of git — set it only in the Railway dashboard.

## B) Vercel — point the frontend at the backends

<https://vercel.com/dashboard> → **canvas-markets** project →
**Settings → Environment Variables**:

```
CANVAS_AGENT_URL   = <AGENT_URL>
CANVAS_FAN_URL     = <FAN_URL>
CANVAS_MARKETS_URL = <MARKETS_URL>
KIMI_API_KEY       = <clean, rotated Moonshot key — single line, no duplicate>
```

Then **Deployments → ⋯ → Redeploy** (env changes require a redeploy).

## C) Optional — Bankr live settlement

Only if you want real bet execution. On the **Markets** Railway service add:

```
BANKR_API_KEY=<your bankr key>
MARKETS_LIVE_SETTLEMENT=true
```

Leave these off to keep the honest "composes the order, no funds move" demo.

## D) Verify (~2 min)

- ☐ `AGENT_URL/health`, `FAN_URL/health`, `MARKETS_URL/health` each return `{"ok":true,...}`
- ☐ Risk Desk shows **● Live · TxLINE StablePrice** + the **on-chain ✓** chip
- ☐ `/agent` and `/fan` load state (no red "Backend unreachable")
- ☐ Chat replies; **Verify on-chain → /judges** works; light/dark toggle works

## E) Submission (due 19 July)

- ☐ Record a short **demo video per track** (judged heavily on clarity)
- ☐ Submit to each Superteam listing:
  - Prediction Markets & Settlement — <https://superteam.fun/earn/listing/prediction-markets-and-settlement/>
  - Trading Tools & Agents — <https://superteam.fun/earn/listing/trading-tools-and-agents/>
  - Consumer & Fan Experiences — <https://superteam.fun/earn/listing/consumer-and-fan-experiences/>

---

### Notes

- **Devnet** carries only a small demo slate (~8 fixtures, ~2 priced). For a
  fuller live board, set `SOLANA_NETWORK=mainnet` + `TXLINE_SERVICE_LEVEL=12`
  on a service and fund the wallet with a little real SOL. Devnet is free and fine otherwise.
- **Honesty posture:** live TxLINE StablePrice is the de-margined fair line, so
  live edges sit near 0% by design; sample fixtures appear only when the feed has
  no line and are always labelled. See `/judges`.
- Every claim's tier (verified-on-chain / root-anchored / simulated) is documented
  on the in-app **Judges** page.
