# Canvas Protocol — Build Plan

> Migrated from basemate-v2 (Telegram infra + bidding patterns). Product spec: `matthewmeakin-unknown-design-20260531-224711.md`.
> Last updated: Jun 17, 2026 — post call with Mateo (Jun 16 late night)

## What Canvas Is

A two-sided marketplace on Telegram: **group owners** earn USDC per verified join; **advertisers** pay for verified, intent-signalled users entering DeFi communities. The join-verification moment (replacing Rose bot gating) is the monetisation surface.

**Platform:** Telegram first. Web dashboard next. Advertiser agent via Telegram bot.

---

## Update Log

### Jun 17, 2026 — Post Call with Mateo

**What changed from previous build plan:**

- **Dashboard (web) promoted from "deferred" to active P1 work** — Rohit owns this. Advertiser dashboard + group owner stats dashboard. Pull directly from Postgres.
- **Escrow smart contract chosen over Coinbase CDP server wallets for Phase 1** — Mateo building now. Min bid set to 1 cent (not 35 cents). Mainnet Base but private/internal until audited. Phase 2 will layer in Coinbase CDP headless UI + server wallets for permissionless advertiser onboarding.
- **Decimal bid parsing is broken** — `/buy` flow cannot parse values like `0.35`. Needs a fix before any real campaigns.
- **Wallet UX improvements needed** — confirm wallet on entry, always give option to re-check wallet address, 2FA on wallet changes.
- **Telegram rich markdown confirmed** — Pavle's new agent context docs show full markdown + rich formats are available in Telegram. Expand use of formatting in bot messages.
- **Twitter handle confirmed:** `canvas_protocol`. Logo: palette emoji (top-left variant).
- **Banker account** — needs Twitter first (done). Rohit to create and add Mateo.
- **First customer targets confirmed** — Rohit to find 2 crypto trading groups by Monday. Pay group owners $50 each to test. Avantis (PERPS on Telegram) identified as strong first advertiser candidate — deep link to their trading agent.
- **GitHub collaboration active** — Rohit has push/pull access via PAT. Claude Code connected to repo locally.

---

## What We Brought Over from basemate-v2

| Source (basemate-v2) | Canvas destination | Status |
|----------------------|-------------------|--------|
| `discovery/db.ts`, `load-env.ts`, `utils/logger.ts` | `src/db.ts`, `src/load-env.ts`, `src/utils/logger.ts` | ✅ Migrated |
| `config/config.ts` (Telegram section) | `src/config/config.ts` (Canvas-only) | ✅ Adapted |
| `telegram/bot.ts` (webhook + grammy) | `src/telegram/bot.ts` + webhook secret validation | ✅ Adapted |
| `telegram/handlers/callback.ts` (patterns) | Reference only — Canvas uses DM text flow, not PPH callbacks | 📋 Pattern borrowed |
| `shared/keyword-matcher.ts` + `keyword.adapter.ts` (bid ranking) | `src/adapters/bidding.ts` (first-price auction per group) | ✅ Adapted |
| `telegram/adapters/tg.adapter.ts` (verification codes) | Replaced by `verification.adapter.ts` + UUID deep-link tokens | ✅ New schema |
| `telegram/services/tg-matcher.ts` (PPH ads) | **Not migrated** — different product | ❌ Skip |
| `discovery/ai.ts` (DeFi agent) | **Not migrated** — Canvas uses Kimi scoring + DM flows | ❌ Skip |
| Entire `xmtp/` tree | **Not migrated** | ❌ Skip |

---

## Current Repo State

```
src/
├── index.ts                    # Boot: DB, schema, bot, TTL sweeper
├── config/                     # Env + constants
├── adapters/
│   ├── schema.ts               # Canvas Postgres DDL (design doc §3)
│   ├── groups.adapter.ts       # Group registry
│   ├── bidding.ts              # First-price auction
│   └── verification.adapter.ts # State machine + cooldowns
├── services/
│   ├── verification-states.ts  # State enum
│   └── scoring.ts              # Kimi + keyword fallback
└── telegram/
    ├── bot.ts                  # Webhook server
    └── handlers/
        ├── join.ts             # chat_member → welcome + deep link
        ├── start.ts            # verify_<uuid> → send task
        └── message.ts          # DM response → score → admit/kick
```

---

## What's Working Right Now ✅

| Feature | Status | Notes |
|---------|--------|-------|
| Join intercept → deep link → captcha DM | ✅ Working | Core flow confirmed in call |
| `/register` group owner flow | ✅ Working | 4-step: group link → wallet → task → confirm. Bot admin permissions prompt working. |
| `/buy` advertiser campaign flow | ⚠️ Partial | Campaign creation works. Bid parsing broken for decimal values (e.g. 0.35, 0.36). |
| Kimi/keyword scoring → admit or kick | ✅ Working | Kimi API key added to Railway |
| Verification stored in Postgres | ✅ Working | Confirmed during call |
| Outbid notification | ✅ Working | "You've been outbid" DM fires correctly |
| Railway + Postgres deployed | ✅ Live | Rohit has Can Edit access on Railway |
| GitHub collaboration | ✅ Done | Rohit has push/pull via PAT |

---

## What Needs to Get Built

### P0 — Fix before any real group test (Rohit + Mateo)

| # | Task | Owner | Notes |
|---|------|-------|-------|
| 1 | **Fix decimal bid parsing** | Rohit | `/buy` can't parse `0.35` or `0.36`. `parseBidInput` needs to handle floats. Min bid will be 1 cent. |
| 2 | **Wallet confirmation UX** | Rohit | On `/register`, confirm wallet address entered. Always show option to re-check. Add 2FA gate on wallet changes. |
| 3 | **Polish bot messages** | Rohit | Improve copy throughout. Use Telegram markdown/rich formatting where possible (confirmed available via Pavle's agent docs). |
| 4 | **Bid queue logic** | Rohit | When outbid, deprioritise previous bidder after current campaign ends (not immediately). |

### P1 — Financial rail (Mateo building now)

| # | Task | Owner | Notes |
|---|------|-------|-------|
| 5 | **Escrow smart contract** | Mateo | Simple: `depositBudget`, `logAttempt`, `releasePayout`, `refund`. USDC on Base mainnet. Min = 1 cent. Private/internal until audited. Mateo writing now with Cursor 2.5. |
| 6 | **Wire escrow into verification flow** | Mateo + Rohit | Step ① on response sent, step ② on Kimi pass. |
| 7 | **Deposit monitoring** | Mateo | RPC poll every 30s or Bankr webhook. |

> **Phase 2 (later):** Coinbase CDP server wallets + headless UI for permissionless advertiser onboarding. Mateo to implement Privy (sign in with Google, link ETH) at that point. No smart contract needed in Phase 2 — server wallet controls budget.

### P1 — Advertiser + Group Owner Dashboard (Rohit owns)

| # | Task | Notes |
|---|------|-------|
| 8 | **Advertiser dashboard** — sign up, create account, pick captcha template | Start with 5 templates to choose from. Pulls from Postgres. |
| 9 | **Captcha template library** | 5 crypto-native templates to begin. Long-term: prompt → AI generates captcha. |
| 10 | **Campaign management UI** | Live campaigns, spend, verification count, bid status. |
| 11 | **Group owner stats dashboard** | Earnings, verifications, active campaigns in their group. Accessible via web and Telegram agent. |
| 12 | **Loom/GIF of advertiser flow** | Record full flow end-to-end. Embed on site advertiser page so prospects can follow along. |

### P1 — Accounts + Infrastructure (Rohit owns)

| # | Task | Notes |
|---|------|-------|
| 13 | **Coinbase CDP account** | Make team account. Add Mateo. Needed for Phase 2 server wallets. Free. |
| 14 | **Domain name** | Purchase and configure. |
| 15 | **Website (Vercel)** | Formal site with advertiser page, group owner page, embedded flow GIF. |
| 16 | **Twitter/X: `canvas_protocol`** | ✅ Done. Logo: palette emoji (top-left). |
| 17 | **Banker account** | Create now that Twitter is live. Add Mateo to team account. |
| 18 | **Telegram deck/pitch** | One-pager for first group chat outreach. |

### P1 — First customers (Rohit owns)

| # | Task | Notes |
|---|------|-------|
| 19 | **Find 2 crypto trading groups to test** | Target by Monday Jun 23. Offer group owners $50 each for 2-day test. |
| 20 | **Avantis outreach** | First advertiser pitch. Deep link users to their PERPS trading bot on Telegram. Natural fit — crypto-native audience, already on Telegram. |
| 21 | **Permissionless group discovery via agent** | When advertisers talk to Canvas Protocol bot, surface underserved groups by niche. Early groups = cheaper CPV. |

### P2 — Launch polish

| # | Task | Notes |
|---|------|-------|
| 22 | **Kimi calibration** | Manual review first 50 responses. Set `KIMI_PASS_THRESHOLD`. |
| 23 | **Daily advertiser report** | Cron 09:00 UTC via Telegram DM. |
| 24 | **Empty states** | Budget exhausted vs no advertiser (generic task fallback already partially wired). |
| 25 | **Smart contract audit** | Before any public mainnet USDC. |
| 26 | **Privy auth** | Sign in with Google, link ETH wallet. Mateo implements when CDP phase begins. |
| 27 | **Prompt-to-captcha** | Advertiser gives a prompt, AI generates a custom captcha. Post-launch feature. |

---

## What's Explicitly Deferred

- Platform fee (0% at launch)
- Multisig relayer
- XMTP / Base App cross-listing
- PPH / keyword marketplace from basemate
- Binance / major exchange listing
- Formal company emails (using personal Gmails until funded)
- Move off Railway (stay until traffic demands Google/AWS)

---

## First Production Milestone

**Two groups (found by Rohit), one advertiser (Avantis or equivalent), testnet then mainnet USDC** — escrow contract deployed by Mateo, dashboard live, end-to-end verified in real group chat.

---

## Environment

```bash
cp .env.example .env
# Fill: DATABASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_URL, TELEGRAM_WEBHOOK_SECRET, KIMI_API_KEY
npm install
npm run dev
```

Infrastructure: Railway (bot + Postgres). Rohit has Can Edit on Railway. Mateo owns deployment.

---

## Key Design Decisions

- **First-price auction** — highest bid wins each join; bid locks at `TASK_SENT`.
- **No float in payout path** — all amounts as USDC microunits (`BIGINT`).
- **Anonymous captcha** — humans never see advertiser name; advertisers see competitor names in buy flow only.
- **Rose replacement pitch** — "same gating, now you earn per verified join."
- **Min bid = 1 cent** — decided Jun 16. Enables cheap internal testing without testnet USDC friction.
- **Mainnet for internal testing** — Mateo prefers spending $5 real USDC over chasing testnet faucets.
- **No smart contract for Phase 2** — Coinbase CDP server wallets remove need for on-chain escrow once we move to permissionless advertiser onboarding.

---

## basemate-v2 Files Still Worth Reading (not copied)

- `/Users/matthewmeakin/basemate-v2/.cursor/plans/telegram_bot_pph_a55e60f5.plan.md` — join/mute/verify flow spec (adapt mute→kick for Canvas)
- `/Users/matthewmeakin/basemate-v2/src/discovery/adapters/keyword.adapter.ts` — `tryConsumeImpression()` atomic budget pattern for step ②
- `/Users/matthewmeakin/basemate-v2/src/api/keywords.router.ts` — wallet signature auth if HTTP API needed later
