# Canvas AI — Build Plan

> Migrated from basemate-v2 (Telegram infra + bidding patterns). Product spec: `matthewmeakin-unknown-design-20260531-224711.md`.

## What Canvas Is

A two-sided marketplace on Telegram: **group owners** earn USDC per verified join; **advertisers** pay for verified, intent-signalled users entering DeFi communities. The join-verification moment (replacing Rose bot gating) is the monetisation surface.

**Platform:** Telegram bot + Mini App for rich captchas; web dashboard planned (see `docs/DASHBOARD_MVP.md`).  
**Telegram API reference:** [`docs/TELEGRAM_API.md`](docs/TELEGRAM_API.md) — maps Canvas features to the [official Bot API](https://core.telegram.org/bots/api).

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
│   ├── schema.ts                    # Postgres DDL + task_templates
│   ├── groups.adapter.ts
│   ├── bidding.ts                   # placeBid, getTopBidForGroup
│   └── verification.adapter.ts      # State machine + task_type/payload
├── services/
│   ├── verification-states.ts
│   ├── verification-tasks.ts        # Task resolver + types
│   ├── captcha-questions.ts         # Trivia fallback (10 questions)
│   └── scoring.ts                   # Kimi + keyword fallback
├── telegram/
│   ├── bot.ts                       # Webhook + Mini App static serve
│   ├── handlers/
│   │   ├── join.ts, join-request.ts
│   │   ├── start.ts                 # verify_<uuid> deep links
│   │   ├── register.ts              # /register, /wallet, /invite
│   │   ├── buy.ts                   # Advertiser /buy conversation
│   │   ├── captcha-callback.ts      # MC button answers
│   │   ├── message.ts               # DM text → Kimi; web_app_data
│   │   └── webapp-data.ts
│   └── services/
│       ├── begin-verification.ts    # Task resolver at join
│       ├── captcha-dm.ts            # Send task by type
│       └── process-text-response.ts # Kimi scoring path
public/mini-app/preference.html        # Telegram Mini App spike
scripts/seed-advertiser.ts             # Seed sample campaign
scripts/e2e-smoke.ts                   # Automated smoke checks
docs/DASHBOARD_MVP.md                  # Web dashboard plan
```

**Working today:**

| Flow | Status |
|------|--------|
| Join → welcome gate → DM verification | ✅ |
| Trivia MC fallback (apple question, etc.) | ✅ |
| Advertiser `task_text` → preference MC task | ✅ |
| Group `verification_task_text` → open-text + Kimi | ✅ |
| `/buy` → group → qty → bid → task → placeBid | ✅ |
| Mini App preference template (`preference_webapp`) | ✅ Spike |
| Outbid DM notification on placeBid | ✅ Basic |
| Railway deploy + Postgres | ✅ |

**Still stubbed:**

- Onchain step ①/②, Bankr deposit, escrow contract
- Full 4-step `/register` conversation
- Daily advertiser report cron
- Web dashboard UI (planned — `docs/DASHBOARD_MVP.md`)
- Admin loss handling (Telegram 400 pause)

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

## Gap Analysis vs v0.2 Design

### P0 — Must ship before first real group

1. ~~Group owner `/register`~~ — partial (commands work; full 4-step conversation TODO)
2. ~~Advertiser `/buy` conversation~~ — ✅ thin flow shipped
3. **Kimi spike** — scoring wired; calibrate threshold on real responses
4. ~~Deploy to Railway~~ — ✅ live
5. **BotFather admin checklist** — Ban, Restrict, Delete Messages, Invite via Link

### P1 — Before first paid campaign

6. Base escrow contract
7. Relayer (step ①/②)
8. Deposit monitoring (Bankr or RPC poll)
9. ~~Outbid notifications~~ — ✅ basic DM on placeBid
10. Admin loss handling

### P2 — Launch polish

11. Kimi calibration (first 50 responses)
12. Daily advertiser report cron
13. Empty-state notifications
14. Contract audit before mainnet USDC

### Hybrid roadmap (new)

| Phase | Deliverable |
|-------|-------------|
| **Now** | Telegram task types + `/buy` + Mini App spike |
| **Week 2** | Web dashboard MVP — template CRUD + preview |
| **Week 3** | Dashboard campaign funding + template_id on campaigns |

### Explicitly deferred

- Full drag-and-drop template editor (forms first)
- Platform fee (0% at launch)
- Multisig relayer
- XMTP / Base App cross-listing
- PPH / keyword marketplace from basemate

---

## Environment Setup

```bash
cp .env.example .env
# Fill: DATABASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_URL, TELEGRAM_WEBHOOK_SECRET
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

See [`docs/TELEGRAM_API.md`](docs/TELEGRAM_API.md) for Bot API limits, webhook setup, and Bot API 10.1 upgrade paths (join request queries, rich messages).

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

## Key Design Decisions

- **First-price auction** — highest bid wins each join; bid locks at `TASK_SENT`.
- **No float in payout path** — all amounts as USDC microunits (`BIGINT`).
- **Anonymous captcha** — humans never see advertiser name in verification DM.
- **Hybrid UX** — chat-native tasks now; Mini App + web dashboard for rich templates next.

---

## basemate-v2 Files Still Worth Reading (not copied)

- `/Users/matthewmeakin/basemate-v2/.cursor/plans/telegram_bot_pph_a55e60f5.plan.md` — join/mute/verify flow spec
- `/Users/matthewmeakin/basemate-v2/src/discovery/adapters/keyword.adapter.ts` — atomic budget pattern for step ②
- `/Users/matthewmeakin/basemate-v2/src/api/keywords.router.ts` — wallet signature auth if HTTP API needed later
