# Canvas Protocol — Build Plan

> Migrated from basemate-v2 (Telegram infra + bidding patterns). Product spec: `matthewmeakin-unknown-design-20260531-224711.md`.
> Last updated: Jun 17, 2026 — implementation sprint (P0 complete, dashboards live)

## What Canvas Is

A two-sided marketplace on Telegram: **group owners** earn USDC per verified join; **advertisers** pay for verified, intent-signalled users entering DeFi communities. The join-verification moment (replacing Rose bot gating) is the monetisation surface.

**Platform:** Telegram bot + Mini App for rich captchas; web dashboard in progress (see `docs/DASHBOARD_MVP.md`).
**Telegram API reference:** [`docs/TELEGRAM_API.md`](docs/TELEGRAM_API.md) — maps Canvas features to the [official Bot API](https://core.telegram.org/bots/api).

---

## Update Log

### Jun 17, 2026 — Implementation Sprint (P0 complete, dashboards live)

**Completed this session:**

- **Fixed decimal bid parsing** — `parseBidInput` regex now handles leading-dot floats (`.36`, `.5`). `MIN_BID_MICROUNITS` corrected from `100_000n` ($0.10) to `10_000n` ($0.01).
- **Wallet confirmation UX** — `/wallet 0x...` now shows current → new address with inline Confirm/Cancel keyboard before saving. `/wallet` with no arg shows current wallet.
- **Group titles stored in DB** — `group_title TEXT` column added to `groups` table. `registerGroup` and `autoRegisterGroupOnBotAdd` both persist the chat title. Dashboards and bot messages now show real group names.
- **Advertiser dashboard (v1)** — `GET /advertiser` (wallet login → campaign cards with bid, budget, verifications, status, task text). Backed by `advertisers` table + `/link` bot command. `/buy` prompts `/link` after campaign creation if wallet not set.
- **Group owner dashboard (v1)** — `GET /group-owner` (wallet login → group cards with verifications, top bid, pending earnings, portal link). Post-`/register` DM links owner to dashboard.
- **Polished bot messages** — welcome gate, captcha DM header, open-text/trivia/MC/webapp prompts, pass/fail/timeout messages all updated with consistent copy and emoji. Score (`X/100`) removed from fail message.
- **Timeout DM** — `completeVerificationTimeout` now sends user a DM explaining the timeout for both `open_join` and `join_request` entry types.
- **Bid queue fix** — removed immediate `campaign_status = 'paused'` on outbid. `getTopBidForGroup` picks highest active bid naturally; old bidder auto-recovers if new top bidder runs out of budget.
- **Dockerfile fix** — `COPY public ./public` added to production stage; `/advertiser` and `/group-owner` dashboards now load in Railway.
- **`/start` message** — rewritten to be crypto-native, shows both group owner and advertiser commands + dashboard URLs + `@canvas_protocol`.

### Jun 17, 2026 — Post Call with Mateo (Jun 16)

**What changed / was decided:**

- **Dashboard promoted from "deferred" to active P1** — Rohit owns. Advertiser dashboard + group owner stats. Pull directly from Postgres.
- **Escrow smart contract chosen over Coinbase CDP server wallets for Phase 1** — Mateo building now. Min bid = 1 cent. Base mainnet but private/internal until audited. Phase 2 layers in Coinbase CDP headless UI + server wallets for permissionless onboarding.
- **Decimal bid parsing is broken** — `/buy` flow can't parse `0.35` or `0.36`. Fix before any real test.
- **Wallet UX improvements needed** — confirm on entry, option to re-check address, 2FA gate on wallet changes.
- **Telegram rich markdown confirmed** — Pavle's new agent context docs show full markdown + rich formats available. Expand bot message formatting.
- **Twitter handle live:** `canvas_protocol`. Logo: palette emoji (top-left variant).
- **Banker account** — needs Twitter (now done). Rohit to create, add Mateo.
- **First customers** — Rohit finds 2 crypto trading groups by Mon Jun 23. Pay group owners $50 each for 2-day test. Avantis (PERPS on Telegram) identified as strong first advertiser.
- **GitHub + Claude Code** — Rohit has push/pull via PAT. Claude Code connected locally.

---

## What We Brought Over from basemate-v2

| Source (basemate-v2) | Canvas destination | Status |
|----------------------|-------------------|--------|
| `discovery/db.ts`, `load-env.ts`, `utils/logger.ts` | `src/db.ts`, `src/load-env.ts`, `src/utils/logger.ts` | ✅ Migrated |
| `config/config.ts` (Telegram section) | `src/config/config.ts` (Canvas-only) | ✅ Adapted |
| `telegram/bot.ts` (webhook + grammy) | `src/telegram/bot.ts` + webhook secret validation | ✅ Adapted |
| `telegram/handlers/callback.ts` (patterns) | Reference only — Canvas uses DM flows | 📋 Pattern borrowed |
| `shared/keyword-matcher.ts` + `keyword.adapter.ts` (bid ranking) | `src/adapters/bidding.ts` (first-price auction per group) | ✅ Adapted |
| `telegram/adapters/tg.adapter.ts` (verification codes) | Replaced by `verification.adapter.ts` + UUID deep-link tokens | ✅ New schema |
| `telegram/services/tg-matcher.ts` (PPH ads) | **Not migrated** — different product | ❌ Skip |
| `discovery/ai.ts` (DeFi agent) | **Not migrated** — Canvas uses Kimi scoring + DM flows | ❌ Skip |
| Entire `xmtp/` tree | **Not migrated** | ❌ Skip |

---

## Current Repo State

```
src/
├── index.ts                         # Boot: DB, schema, bot, TTL sweeper
├── config/
├── adapters/
│   ├── schema.ts                    # Postgres DDL (groups, advertisers, verifications, bids)
│   ├── groups.adapter.ts            # GroupRow + getGroupOwnerStats
│   ├── advertisers.adapter.ts       # linkAdvertiserWallet, getCampaignsForWallet
│   ├── bidding.ts                   # placeBid (no outbid pause), getTopBidForGroup
│   └── verification.adapter.ts      # State machine + task_type/payload
├── services/
│   ├── verification-states.ts
│   ├── verification-tasks.ts        # Task resolver + types
│   ├── captcha-questions.ts         # Trivia fallback (10 questions)
│   └── scoring.ts                   # Kimi + keyword fallback
├── api/
│   ├── advertiser.ts                # GET /api/advertiser?wallet=
│   └── group-owner.ts               # GET /api/group-owner?wallet=
├── telegram/
│   ├── bot.ts                       # Webhook + static serve (/advertiser, /group-owner, /mini-app)
│   ├── handlers/
│   │   ├── join.ts, join-request.ts
│   │   ├── start.ts                 # Crypto-native welcome + verify_<uuid> deep links
│   │   ├── register.ts              # /register, /wallet (confirm UX), /invite
│   │   ├── link.ts                  # /link — advertiser wallet
│   │   ├── buy.ts                   # Advertiser /buy conversation + wallet prompt
│   │   ├── captcha-callback.ts      # MC button answers
│   │   ├── message.ts               # DM text → Kimi; web_app_data
│   │   └── webapp-data.ts
│   └── services/
│       ├── begin-verification.ts    # Task resolver at join
│       ├── captcha-dm.ts            # Send task DM by type (polished copy)
│       ├── welcome-gate.ts          # Welcome gate message (polished copy)
│       ├── verification-complete.ts # Pass/fail/timeout actions + timeout DM
│       └── process-text-response.ts # Kimi scoring path
public/
├── advertiser/index.html            # Advertiser dashboard (wallet login → campaigns)
├── group-owner/index.html           # Group owner dashboard (wallet login → stats)
└── mini-app/preference.html         # Telegram Mini App spike
scripts/seed-advertiser.ts           # Seed sample campaign
scripts/e2e-smoke.ts                 # Automated smoke checks
docs/DASHBOARD_MVP.md                # Web dashboard plan
```

---

## What's Working

| Flow | Status | Notes |
|------|--------|-------|
| Join → welcome gate → DM verification | ✅ | |
| Trivia MC fallback | ✅ | |
| Advertiser `task_text` → preference MC task | ✅ | |
| Group `verification_task_text` → open-text + Kimi | ✅ | |
| `/buy` → group → qty → bid → task → placeBid | ✅ | Decimal parsing fixed; `/link` prompt added after buy |
| `/register` + `/wallet` (confirm UX) + `/invite` | ✅ | Wallet confirm keyboard; post-register owner DM |
| `/link` — advertiser wallet | ✅ | Upsert into `advertisers` table |
| Outbid DM notification | ✅ | Outbid campaigns stay active (no forced pause) |
| Timeout DM to user | ✅ | Both entry types; graceful if user blocked bot |
| Advertiser dashboard (`/advertiser`) | ✅ | Wallet login → campaign cards with spend/status |
| Group owner dashboard (`/group-owner`) | ✅ | Wallet login → group cards with earnings/top bid |
| Group titles in DB + dashboards | ✅ | Stored on `/register` and bot-add |
| Mini App preference template (`preference_webapp`) | ✅ Spike | |
| Railway deploy + Postgres | ✅ | `public/` now copied in Dockerfile prod stage |
| Kimi API key | ✅ | Added to Railway variables |

**Still stubbed:** Onchain step ①/②, escrow contract, deposit monitoring, daily report cron, admin loss handling.

---

## Task Types

| Type | When served | User UX | Scoring |
|------|-------------|---------|---------|
| `trivia_mc` | No advertiser, default group text | 2-button inline keyboard | Exact match |
| `open_text` | Group fallback task | DM text reply | Kimi + keywords |
| `preference_mc` | Advertiser `task_text` | 2–4 inline buttons with descriptions | Any selection passes (intent signal) |
| `preference_webapp` | Future / template flag | Mini App button → rich cards ([WebAppInfo](https://core.telegram.org/bots/api#webappinfo)) | Selection via sendData |

**Resolver priority:** `topBid.taskText` → `group.verificationTaskText` → random trivia.

---

## What Needs to Get Built

### P0 — Fix before any real group test

| # | Task | Owner | Status | Notes |
|---|------|-------|--------|-------|
| 1 | **Fix decimal bid parsing** | Rohit | ✅ Done | Regex + min bid ($0.01) fixed in `usdc.ts` + `config.ts`. |
| 2 | **Wallet confirmation UX** | Rohit | ✅ Done | `/wallet` shows confirm/cancel keyboard; post-register DM links owner to dashboard. |
| 3 | **Polish bot messages** | Rohit | ✅ Done | Welcome gate, captcha DM, pass/fail/timeout all updated. Score removed from fail msg. |
| 4 | **Bid queue logic** | Rohit | ✅ Done | Outbid campaigns stay active; `getTopBidForGroup` picks highest bid naturally. |
| 5 | **BotFather admin checklist** | Rohit | ⬜ Manual | Verify: Ban, Restrict Members, Delete Messages, Invite via Link all enabled. |
| 6 | **Kimi calibration** | Rohit | ⬜ Pending | Score first real responses, tune `KIMI_PASS_THRESHOLD`. |

### P1 — Financial rail (Mateo building now)

| # | Task | Owner | Notes |
|---|------|-------|-------|
| 7 | **Escrow smart contract** | Mateo | `depositBudget`, `logAttempt`, `releasePayout`, `refund`. USDC on Base mainnet. Min = 1 cent. Private until audited. |
| 8 | **Wire escrow into verification flow** | Mateo + Rohit | Step ① on response sent, step ② on Kimi pass. |
| 9 | **Deposit monitoring** | Mateo | RPC poll every 30s or Bankr webhook. |
| 10 | **Admin loss handling** | Mateo | Pause group on Telegram 400 "not enough rights", DM owner. |

> **Phase 2 (later):** Coinbase CDP server wallets + headless UI for permissionless advertiser onboarding. Mateo to implement Privy (sign in with Google, link ETH) at that point. No smart contract needed in Phase 2.

### P1 — Web Dashboard (Rohit owns)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 11 | **Advertiser sign-up + account creation** | ⚠️ Partial | Wallet-based login done (`/link` + `/advertiser` dashboard). Full account creation (Privy) deferred to Phase 2. |
| 12 | **Captcha template picker** | ⬜ Pending | Start with 5 crypto-native templates. Long-term: prompt → AI generates captcha. |
| 13 | **Campaign management UI** | ✅ Done | `/advertiser` dashboard: wallet login → campaign cards with bid, budget, verifications, status. |
| 14 | **Group owner stats dashboard** | ✅ Done | `/group-owner` dashboard: wallet login → group cards with earnings, top bid, portal link. |
| 15 | **Flow GIF / Loom on site** | ⬜ Pending | Record full advertiser flow end-to-end. Embed on advertiser landing page. |

See `docs/DASHBOARD_MVP.md` for detailed dashboard plan.

### P1 — Accounts + Infrastructure (Rohit owns)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16 | Twitter `canvas_protocol` | ✅ Done | Palette emoji logo (top-left). |
| 17 | Domain name | ⬜ | Purchase and configure. |
| 18 | Website (Vercel) | ⬜ | Advertiser page, group owner page, embedded flow GIF. |
| 19 | Coinbase CDP account | ⬜ | Create team account. Add Mateo. Needed for Phase 2 server wallets. Free. |
| 20 | Banker account | ⬜ | Twitter done — create Canvas Protocol Banker account. Add Mateo. |

### P1 — First customers (Rohit owns, target Mon Jun 23)

| # | Task | Notes |
|---|------|-------|
| 21 | **Find 2 crypto trading groups** | Pay group owners $50 each for 2-day test. |
| 22 | **Avantis outreach** | First advertiser pitch: deep link users to their PERPS trading bot on Telegram. Crypto-native, already on Telegram — natural fit. |
| 23 | **Permissionless group discovery via agent** | When advertisers talk to Canvas Protocol bot, surface underserved groups by niche. Early groups = cheaper CPV. |

### P2 — Launch polish

| # | Task | Notes |
|---|------|-------|
| 24 | **Daily advertiser report** | Cron 09:00 UTC via Telegram DM. |
| 25 | **Empty states** | Budget exhausted vs no advertiser (generic task fallback partially wired). |
| 26 | **Smart contract audit** | Before any public mainnet USDC. |
| 27 | **Privy auth** | Sign in with Google, link ETH wallet. Mateo implements when CDP phase begins. |
| 28 | **Prompt-to-captcha** | Advertiser gives a prompt, AI generates a custom captcha. Post-launch. |

---

## Hybrid Roadmap

| Phase | Deliverable |
|-------|-------------|
| ~~**Now**~~ ✅ | ~~Fix bid parsing + wallet UX. Bot polish.~~ Done. Dashboards live. |
| **Week 2 (Now)** | Find 2 test groups (by Mon Jun 23). Captcha template picker. Avantis outreach. Kimi calibration. |
| **Week 3** | Escrow contract wired (Mateo). End-to-end paid verification in real group. |
| **Phase 2** | Coinbase CDP server wallets + Privy. Permissionless advertiser onboarding. |

---

## What's Explicitly Deferred

- Full drag-and-drop template editor (forms first)
- Platform fee (0% at launch)
- Multisig relayer
- XMTP / Base App cross-listing
- PPH / keyword marketplace from basemate
- Binance / major exchange listing
- Formal company emails (using personal Gmails until funded)
- Move off Railway (stay until traffic demands Google/AWS)

---

## First Production Milestone

**Two groups (found by Rohit by Mon Jun 23), one advertiser (Avantis or equivalent)** — escrow deployed by Mateo, dashboard live, end-to-end verified in a real group chat.

---

## E2E Test Checklist (Telegram)

1. Add bot to test group as admin
2. `/register` + `/wallet 0x...`
3. `/invite` → share portal link
4. New account joins → captcha DM
5. Correct answer / thoughtful text → admitted
6. Wrong trivia answer → kick + 24h cooldown
7. Run `npm run smoke` for automated DB/scoring checks

---

## Environment Setup

```bash
cp .env.example .env
# Fill: DATABASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_URL, TELEGRAM_WEBHOOK_SECRET, KIMI_API_KEY
npm install
npm run dev
npm run smoke          # automated checks
npm run seed:advertiser # optional sample campaign
```

**Local dev notes:**

- Set `NODE_ENV=development` in `.env`
- Use Railway `DATABASE_PUBLIC_URL` for local Postgres access
- Webhook points at Railway by default — test on deployed bot or use ngrok for local
- Optional: `MINI_APP_BASE_URL` for Mini App button URLs (defaults to webhook origin)

See [`docs/TELEGRAM_API.md`](docs/TELEGRAM_API.md) for Bot API limits, webhook setup, and Bot API 10.1 upgrade paths.

---

## Key Design Decisions

- **First-price auction** — highest bid wins each join; bid locks at `TASK_SENT`.
- **No float in payout path** — all amounts as USDC microunits (`BIGINT`).
- **Anonymous captcha** — humans never see advertiser name in verification DM. Advertisers see competitor names in buy flow only.
- **Hybrid UX** — chat-native tasks now; Mini App + web dashboard for rich templates next.
- **Rose replacement pitch** — "same gating, now you earn per verified join."
- **Min bid = 1 cent** — decided Jun 16. Enables cheap internal testing without testnet USDC friction.
- **Mainnet for internal testing** — Mateo prefers $5 real USDC over chasing testnet faucets.
- **No smart contract for Phase 2** — Coinbase CDP server wallets remove need for on-chain escrow once permissionless onboarding is live.

---

## basemate-v2 Files Still Worth Reading (not copied)

- `/Users/matthewmeakin/basemate-v2/.cursor/plans/telegram_bot_pph_a55e60f5.plan.md` — join/mute/verify flow spec
- `/Users/matthewmeakin/basemate-v2/src/discovery/adapters/keyword.adapter.ts` — atomic budget pattern for step ②
- `/Users/matthewmeakin/basemate-v2/src/api/keywords.router.ts` — wallet signature auth if HTTP API needed later
