# Canvas AI — Build Plan

> Migrated from basemate-v2 (Telegram infra + bidding patterns). Product spec: `matthewmeakin-unknown-design-20260531-224711.md`.

## What Canvas Is

A two-sided marketplace on Telegram: **group owners** earn USDC per verified join; **advertisers** pay for verified, intent-signalled users entering DeFi communities. The join-verification moment (replacing Rose bot gating) is the monetisation surface.

**Platform:** Telegram only (webhook bot, DM flows, group admin).

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

**Working today (local):** join intercept → deep link → captcha DM → Kimi/keyword score → admit or kick + cooldown.

**Stubbed (TODO):** onchain step ①/②, Bankr deposit, `/register` and `/buy` DM conversations, outbid notifications, daily reports.

---

## Gap Analysis vs v0.2 Design

### P0 — Must ship before first real group

1. **Group owner `/register` conversation** — 4-step flow (group link → wallet → fallback task → confirm). Port conversation-state pattern from basemate `handlers/start.ts` plan (never shipped there).
2. **Advertiser `/buy` conversation** — group picker, quantity, bid parsing (`parseBidInput` exists), confirm → pending campaign.
3. **Kimi + Bankr spikes** (design doc step 1) — validate APIs before escrow work.
4. **Deploy to Railway** — webhook URL, `TELEGRAM_WEBHOOK_SECRET`, Postgres.
5. **BotFather admin checklist** — Ban, Restrict, Delete Messages, Invite via Link.

### P1 — Before first paid campaign

6. **Base escrow contract** — `depositBudget`, `logAttempt`, `releasePayout`, `refund`. USDC microunits only.
7. **Relayer service** — step ① on response, step ② on Kimi pass. Rate limits per design doc.
8. **Deposit monitoring** — Bankr webhook OR RPC poll every 30s (direct Base fallback).
9. **Outbid notifications** — when `placeBid` displaces leader, DM previous advertiser.
10. **Admin loss handling** — pause group on Telegram 400 "not enough rights", DM owner.

### P2 — Launch polish

11. **Kimi calibration** — manual review first 50 responses, set `KIMI_PASS_THRESHOLD`.
12. **Daily advertiser report** — cron 09:00 UTC via Telegram DM.
13. **Empty states** — budget exhausted vs no advertiser (generic task fallback already partially wired).
14. **Contract audit** — before mainnet USDC.

### Explicitly deferred

- Web dashboard
- Platform fee (0% at launch)
- Multisig relayer
- XMTP / Base App cross-listing
- PPH / keyword marketplace from basemate

---

## First Steps (Recommended Order)

### This week (parallel with founder DMs)

| # | Task | Est. | Owner |
|---|------|------|-------|
| 1 | Run Kimi spike: score 10 sample DeFi sentences, measure latency/cost | 2h | Eng |
| 2 | Run Bankr spike OR confirm direct Base fallback | 2h | Eng |
| 3 | DM Moonwell + Lennox (design doc assignment) | 1h | Founder |
| 4 | Implement `/register` DM flow + wallet validation | 1 day | Eng |
| 5 | Deploy bot to Railway + register test group | 0.5 day | Eng |

### Next week

| # | Task | Est. |
|---|------|------|
| 6 | Implement `/buy` DM flow + `placeBid` integration | 1 day |
| 7 | Write + audit escrow contract (testnet) | 2–3 days |
| 8 | Wire step ①/② in `message.ts` | 1 day |
| 9 | End-to-end test: join → verify → score → payout (testnet USDC) | 1 day |

### First production milestone

**One group (Lennox), one advertiser (Moonwell), testnet then mainnet USDC** — matches design doc success criteria.

---

## Environment Setup

```bash
cp .env.example .env
# Fill: DATABASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_URL, TELEGRAM_WEBHOOK_SECRET
npm install
npm run dev
```

---

## Key Design Decisions (from office hours doc)

- **First-price auction** — highest bid wins each join; bid locks at `TASK_SENT`.
- **No float in payout path** — all amounts as USDC microunits (`BIGINT`).
- **Anonymous captcha** — humans never see advertiser name; advertisers see competitor names in buy flow only.
- **Rose replacement pitch** — "same gating, now you earn per verified join."

---

## basemate-v2 Files Still Worth Reading (not copied)

- `/Users/matthewmeakin/basemate-v2/.cursor/plans/telegram_bot_pph_a55e60f5.plan.md` — join/mute/verify flow spec (adapt mute→kick for Canvas)
- `/Users/matthewmeakin/basemate-v2/src/discovery/adapters/keyword.adapter.ts` — `tryConsumeImpression()` atomic budget pattern for step ②
- `/Users/matthewmeakin/basemate-v2/src/api/keywords.router.ts` — wallet signature auth if HTTP API needed later
