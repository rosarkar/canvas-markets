# Canvas Protocol — Build Plan

> Migrated from basemate-v2 (Telegram infra + bidding patterns). Product spec: `matthewmeakin-unknown-design-20260531-224711.md`.
> Last updated: Jun 24, 2026 — captcha template system (advertiser-selectable formats)

## What Canvas Is

A two-sided marketplace on Telegram: **group owners** earn USDC per verified join; **advertisers** pay for verified, intent-signalled users entering DeFi communities. The join-verification moment (replacing Rose bot gating) is the monetisation surface.

**Platform:** Telegram bot + Mini App for rich captchas; web dashboard in progress (see `docs/DASHBOARD_MVP.md`).
**Telegram API reference:** [`docs/TELEGRAM_API.md`](docs/TELEGRAM_API.md) — maps Canvas features to the [official Bot API](https://core.telegram.org/bots/api).

---

## Update Log

### Jun 25, 2026 — Kimi Integration + Conversational Agent Flows

- **`callKimi` extracted as shared low-level client in `scoring.ts`** — reused by `scoreWithKimi`, `rules-assistant.ts`, and `buy-assistant.ts`. Do not create a new Kimi client anywhere.
- **`KIMI_BASE_URL` confirmed as `https://api.moonshot.ai/v1`** — set in both local `.env` and Railway canvas-ai variables. `api.moonshot.cn` and `platform.moonshot.cn` are wrong endpoints for this key.
- **AI-assisted rules configuration added to group owner registration flow** — triggers after wallet confirmation. Bot has a multi-turn Kimi conversation with the owner to design community rules. Confirmed rules saved as JSONB to `groups.rules` column (new, default `[]`).
- **`RULES_SENT` state added to verification state machine** — shown before `TASK_SENT` when group has rules. Human must type 'I agree' to advance. Groups with no rules skip this state.
- **`/buy` rebuilt as Kimi-powered conversational agent** — replaces linear button/field-collector. Agent walks advertiser through goal → template recommendation → task design. All financial validation stays in TypeScript (`MIN_QUANTITY`, `MIN_BID_MICROUNITS`, top-bid check). `placeBid` + `createTemplate` only fire on explicit 'confirm'.
- **45 tests passing** as of commit `d901fba`.

### Jun 24, 2026 — Captcha Template System

**Completed this session:**

- **Two new advertiser formats** — `rank_reasoning` (rank N items + one sentence on the top pick, one-shot re-prompt if reasoning is missing) and `binary_reasoning` (A/B + reasoning in one reply, with an optional USDC quality bonus added on top of the payout for a thoughtful answer).
- **`preference_mc` extended** — optional `sponsorName` tag ("Sponsored by X · no wrong answer") and a post-pass "agent offer" follow-up (CTA button + skip), matching the ad-style mockups (Moonwell/Ticketmaster/Coinbase examples).
- **`/buy` rebuilt as a template conversation** — after group → quantity → bid, advertisers either reuse a saved template or pick a format and get walked field-by-field through customizing it (prompt, then options/items via "send one per message, then `done`", then optional sponsor/offer/bonus). Saved as a named, reusable row in `task_templates`.
- **Completed Mateo's dormant template infra** — `task_templates` table and `advertiser_budgets.template_id` column already existed in the schema but had zero application code using them; now fully wired through the resolver → DM rendering → scoring pipeline.
- **One-shot re-prompt mechanic** — reused the previously-unused `verifications.attempt_count` column to gate exactly one re-prompt per verification when a reply is too thin (`open_text`) or missing required structure (ranking / reasoning).
- **Schema simplification** — removed the DB-level `CHECK` constraint on `task_templates.task_type` (it required a migration every time a new template type shipped). Validation now lives in `templates.adapter.ts` against the `TaskType` union instead — adding a future format no longer needs a migration.
- **Verified against a real (in-memory) Postgres engine** — confirmed an advertiser with zero prior signup (no `/link`, no row in `advertisers`) can complete the full flow end-to-end, and that `templateId` round-trips correctly from bid placement through join-time task resolution.
- **Scope note:** the source mockup (`canvas_captcha_examples.html`) showed 6 formats; rules-acceptance and auto-kick enforcement were intentionally not built here — the mockup itself tags them "no advertiser required" (group-owner moderation features, not something an advertiser picks/pays for), and auto-kick would need spam-detection infra that doesn't exist yet.
- **Payments still not wired into this flow** — `/buy` writes `remaining_budget` as a ledger number in Postgres only; no USDC moves at bid time. Confirms the existing P1 financial-rail gap below, doesn't change it.

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
│   ├── schema.ts                    # Postgres DDL (groups, advertisers, verifications, bids, templates)
│   ├── groups.adapter.ts            # GroupRow + getGroupOwnerStats
│   ├── advertisers.adapter.ts       # linkAdvertiserWallet, getCampaignsForWallet
│   ├── templates.adapter.ts         # createTemplate, getTemplateById, listTemplatesForAdvertiser
│   ├── bidding.ts                   # placeBid (+ templateId), getTopBidForGroup
│   └── verification.adapter.ts      # State machine + task_type/payload, bumpAttemptCount
├── services/
│   ├── verification-states.ts
│   ├── verification-tasks.ts        # Task resolver + types (incl. rank/binary reasoning)
│   ├── text-response-parser.ts      # Ranking/option + reasoning extraction
│   ├── captcha-questions.ts         # Trivia fallback (10 questions)
│   ├── scoring.ts                   # Kimi + keyword fallback
│   ├── buy-assistant.ts             # Kimi buy agent logic, intent extraction, live context builder
│   ├── buy-assistant.test.ts        # 13 tests for buy agent
│   ├── rules-assistant.ts           # Kimi rules config logic, isOffTopicRulesDraft guardrail
│   └── rules-assistant.test.ts      # Tests for rules assistant
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
│   │   ├── buy.ts                   # Advertiser /buy: template picker + field collection + reuse
│   │   ├── captcha-callback.ts      # MC button answers + agent-offer follow-up
│   │   ├── message.ts               # DM text → Kimi; web_app_data
│   │   ├── webapp-data.ts
│   │   ├── buy-agent.ts             # Advertiser buy agent handler, hasActiveBuyAgentSession()
│   │   └── rules-setup.ts           # Group owner rules config handler, hasActiveRulesSession()
│   └── services/
│       ├── begin-verification.ts    # Task resolver at join (incl. saved templates)
│       ├── captcha-dm.ts            # Send task DM by type, sponsor tag, agent offer
│       ├── welcome-gate.ts          # Welcome gate message (polished copy)
│       ├── verification-complete.ts # Pass/fail/timeout actions + timeout DM
│       └── process-text-response.ts # open_text/rank/binary scoring + one-shot re-prompt
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
| `/buy` → group → qty → bid → template → placeBid | ✅ | Reuse a saved template or author one of 4 formats; `/link` prompt added after buy |
| Captcha template system (`task_templates` reuse) | ✅ | 4 advertiser formats: preference_mc, rank_reasoning, binary_reasoning, open_text |
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
| AI-assisted rules configuration for group owners | ✅ | Multi-turn Kimi conversation → confirmed rules saved to `groups.rules` |
| `RULES_SENT` join-time rules gate | ✅ | Shown before captcha if group has rules; 'I agree' advances to captcha |
| Kimi-powered conversational buy agent | ✅ | Goal → template → task design; TypeScript validates all financial fields |

**Still stubbed:** Onchain step ①/②, escrow contract, deposit monitoring, daily report cron, admin loss handling.

---

## Task Types

| Type | When served | User UX | Scoring |
|------|-------------|---------|---------|
| `trivia_mc` | No advertiser, default group text | 2-button inline keyboard | Exact match |
| `open_text` | Group/advertiser open-ended template | DM text reply (1 re-prompt if too thin) | Kimi + keywords |
| `preference_mc` | Advertiser `task_text` or saved template | 2–4 inline buttons; optional sponsor tag + post-pass agent offer | Any selection passes (intent signal) |
| `rank_reasoning` | Advertiser saved template | DM text: rank 3–6 items + one sentence on top pick (1 re-prompt if reasoning missing) | Kimi (genuineness, not ranking correctness) |
| `binary_reasoning` | Advertiser saved template | DM text: A/B + reasoning in one reply (1 re-prompt if option/reasoning missing) | Kimi; optional USDC bonus for reasoned replies |
| `preference_webapp` | Future / template flag | Mini App button → rich cards ([WebAppInfo](https://core.telegram.org/bots/api#webappinfo)) | Selection via sendData |

**Resolver priority:** `topBid.templateId` (saved template) → `topBid.taskText` → `group.verificationTaskText` → random trivia.

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
| 12 | **Captcha template picker** | ✅ Done (chat) | Built into `/buy` conversation, not the web dashboard — 4 formats (preference_mc, rank_reasoning, binary_reasoning, open_text), saved/reusable via `task_templates`. A visual web picker for browsing/editing templates is still open; see "drag-and-drop template editor" under deferred. Long-term: prompt → AI generates captcha (#28). |
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
KIMI_BASE_URL=https://api.moonshot.ai/v1
npm install
npm run dev
npm run smoke          # automated checks
npm run seed:advertiser # optional sample campaign
```

Note: `KIMI_BASE_URL` must also be set in Railway canvas-ai service Variables tab.

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

---

## Known Gaps & Next Steps

### To fix — rules content guardrail (low priority)

`isOffTopicRulesDraft` in `rules-assistant.ts` is too aggressive. Real communities bond by discussing things outside their main topic. Remove the hard guardrail. Replace with an optional setting during group owner onboarding: if the owner wants to restrict conversations to on-topic only, Kimi adds a rule for it. Otherwise no restriction by default.

### To fix — keyword/intent targeting system (next feature)

Group owner registration and advertiser buy flow both need keyword/intent classification. Two targeting dimensions: (1) vertical match — DeFi protocol advertising to a DeFi group; (2) demographic match — luxury/lifestyle brand advertising to any crypto-native audience regardless of topic (crypto-native users skew high-net-worth, tech-forward, international). Kimi should infer demographic tags from group topic description during registration. Advertisers should be able to target on either axis or both.

### Mateo — Phase 2 blockers

- **Smart contract** — escrow deposit function, step 1 completion log onchain, step 2 USDC payout to group owner wallet gated on Kimi pass, budget tracking per group per advertiser, refund function for unused budgets. Deploy to Base mainnet.
- **Coinbase CDP** — invite sent to Mateo, not yet configured.
- **Bankr agent skill** — buy flow and register flow as natural language Bankr agent conversations. Reporting: completion counts, budget remaining, response data.
- **x402 payment rails** — wire advertiser USDC to escrow contract through Bankr.

### Phase 1 completion blocker

DM half of the verification loop not yet confirmed end-to-end. Need a second Telegram account (not the group owner) to test the full flow: join Canvas Test group (`-5145298837`) → receive captcha in DM → reply → Kimi scores → admit or re-prompt. Virtual number services had availability issues — this is still the active next step before Phase 1 is declared done.

### Architecture Decisions (Jun 25, 2026 — Mateo + Rohit planning session)

#### Per-advertiser deposit wallets (not yet built)

Each advertiser gets a unique deposit wallet address for tracking purposes. Funds flow into the central escrow smart contract but are tracked per advertiser via their unique wallet. This allows Canvas to attribute funds, track spend over time, and issue refunds cleanly. Mateo to design wallet derivation strategy (CDP server wallets or deterministic derivation from advertiser ID).

#### Batch payouts to group owners (not yet built)

Group owner payouts are batched and sent once daily to their registered wallet. Not per-verification in real time — that comes later as volume grows. Daily batch keeps gas costs manageable at early scale. Eventually move to more frequent settlement as protocol matures.

#### Outbid flow — wait your turn (not yet built)

When an advertiser is outbid, Canvas bot DMs them with three options:

- Cancel and get refund of unused budget
- Rebid higher to reclaim top slot immediately
- Wait your turn — stay in queue, your campaign activates automatically when all higher bids for that group are exhausted

Queue is ordered by bid price descending. When the top bidder's budget runs out, the next in line activates automatically with no action required. This is meaningfully different from the current outbid flow (which just notifies and asks to rebid) — it makes Canvas a passive income set-and-forget for advertisers who are willing to wait.

#### No-advertiser verification fallback (partially wired, needs polish)

Groups with no active advertiser budget still run a verification — humans complete a generic task and are admitted, but no USDC payout is triggered and no completion is logged onchain. This keeps the bot useful for group owners even before advertisers arrive. The trivia MC fallback is already partially wired for this case — confirm it covers the no-advertiser path cleanly and the group owner UX is clear (bot should indicate 'unsponsored verification' so owners know they aren't earning on this join).

### Commit history (recent)

- `235a3ba` — Fix P0 bugs, polish bot messages, add timeout DM, fix bid queue
- `fdbf461` — feat: advertiser captcha template system + escrow payout wiring
- `3914c2d` — feat: AI-assisted rules configuration and join-time rules gate
- `d901fba` — feat: Kimi-powered conversational buy agent + rules content guardrail
