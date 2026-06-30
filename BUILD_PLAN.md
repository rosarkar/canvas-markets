# Canvas Protocol — Build Plan & Changelog
**Last updated:** June 29, 2026  
**Repo:** `fweekshow/canvas-ai` · **Branch:** `main`  
**Infrastructure:** Railway (canvas-ai + Postgres) · Base mainnet · `@CanvasProtocolBot`

---

## Changelog

### June 29, 2026

**Verification UX**
- Rewrote initial DM copy for `OPEN_TEXT` tasks — warmer opener, no "quick verification" header, no "In one sentence" constraint that conflicted with re-prompting short answers
- Removed pre-task `RULES_SENT` gate entirely — captcha is now the first message a joining user receives
- Added post-verification rules gate: after Kimi pass, user sees group rules + "I agree ✓" inline button; only unmuted and admitted after tapping
- New states: `RULES_PENDING` (10-min TTL), `ADMITTED` (terminal), `RULES_TIMED_OUT`
- `RULES_PENDING` timeout sweep added to the existing 60s TTL loop
- Fixed critical bug: `state = 'PASSED'` was hardcoded as terminal in `payout-batch.ts`, group owner stats query, and advertiser stats query — all three now match any post-pass state so group owner payments don't silently break

**Group rules**
- Replaced Kimi-powered multi-turn rules drafting flow (`rules-setup.ts`, `rules-assistant.ts`, `/rules` command) with a simple prompt at end of `/register`: owner sends rules as a message or taps Skip
- Rules stored in existing `groups.rules` JSONB column
- Post-verification rules message reads from `groups.rules`; falls back to three hardcoded defaults if null/empty

**Registration flow — moved to DM**
- All registration confirmation messages now sent to group owner via DM only, not group chat
- Group chat receives a single public line after `/register`: `✅ [group name] is now verified by Canvas. New members will be asked to complete a quick verification before joining.`
- Group chat also sends a notification tagging the owner so they know to check their DM
- `/wallet` command now DM-only; if run in group chat returns: "Please set your wallet in our DM to keep it private."
- After wallet confirmation, bot resends portal link to owner DM for easy reference

**Group owner DM menu**
- `/menu` command (DM-only) — 5-button inline keyboard: 📊 My Stats / 🔗 Portal Link / ✏️ Edit Rules / 💰 Update Wallet / ❓ Help
- 📊 My Stats pulls weekly verifications, total pending earnings, top active bid from Postgres; shows `—` for fields not yet in DB
- 🔗 Portal Link resends invite link
- ✏️ Edit Rules reuses registration rules-save flow
- 💰 Update Wallet prompts for new address, writes to `groups.wallet`
- ❓ Help sends command list
- `/start` in DM now shows owner menu for registered group owners instead of advertiser screen

**Dual-identity routing**
- Fixed bug: users who are both a group owner and an advertiser had no way to reach the advertiser flow — `/start` exited early after showing the owner menu
- Fix: explicit mode selector shown if both identities detected — "👋 Welcome back. What would you like to do?" with 🏘️ Manage my groups / 📢 Run campaigns buttons
- Mode stored in-memory (`Map<number, 'owner'|'advertiser'>`), no DB migration needed
- 🔄 Switch mode button in both menus, edits message in-place back to mode selector
- Single-identity users see their menu directly, no mode selector, no switch button

---

### June 28, 2026 (Mateo — commits e43a039 → 644a5f3)

- **`CanvasEscrowV0.sol` deployed to Base mainnet** (`0x262ac1a082fd32c83e9b32ff1912ea070ed55890`) — `depositBudget`, `creditDirectDeposit`, `releasePayout`, `refundUnusedBudget`, `withdrawUnallocated`. Tracks `totalHeld` vs per-campaign balances as an invariant. No `logAttempt` step — payout fires straight from pass.
- **Deposit infrastructure** — `bankr.client.ts`, `deposit-monitor.ts`, `deposit-confirm.ts`, per-advertiser unique deposit wallets feeding the central escrow
- **Bid ladder** — `bid-ladder.ts` promotes next bidder automatically on pause/withdraw; daily batch payouts to group owner wallets via `payout-batch.ts`
- **`/buy` reverted from Kimi conversational agent to guided button flow** (reverses `d901fba`) — Kimi buy agent no longer in codebase
- **Base Pay credit timing fix** + orphaned USDC recovery
- **Top-up flow** for adding budget to existing campaigns
- **Withdraw/refund** surfaced as inline buttons on `/start` and `/campaigns`
- Advertiser dashboard built (web portal) — wallet-address login gate, four summary tiles, My Campaigns / Available Groups tabs, bid position bar, status chips, action buttons. Gracefully handles missing `/api/groups` endpoint.

---

### June 25, 2026

- **Kimi API endpoint fixed** — `api.moonshot.cn` → `api.moonshot.ai/v1`; `KIMI_BASE_URL` updated in Railway env
- **Kimi-powered conversational buy agent** added for advertisers (commit `d901fba`) — later reverted by Mateo in favour of guided button flow
- **Off-topic content guardrail** added to rules assistant — later decided to defer as optional mod setting
- `COMPANY_WALLET=0x199390C2C6Af11b8938c6fCd86208b370D43C61F` added to Railway env
- `BUILD_PLAN.md` created and committed to repo

---

### June 24, 2026

- **Captcha template system integrated** into live repo (13 files touched) — six task formats across three categories: advertising tasks (preference/acquisition), data collection tasks (RLHF ranking, open text, binary signal), community management (rules acceptance)
- Key design decision locked: users must type all responses, not tap buttons — distinguishes genuine human engagement from automated replies; re-prompt mechanic when responses are too thin
- `canvas_captcha_examples.html` static mockup produced for Bankr pitch deck
- Kimi-assisted rules configuration conversation added to group owner DM registration flow
- `user_activity_log` table identified as near-term useful for cross-group velocity tracking — deferred but noted

---

### June 21, 2026

- **Domain registered:** `canvas-protocol.com` on Cloudflare
- **Vercel account** confirmed (existing)
- **Coinbase CDP** invite sent to Mateo
- Test run: 50 verifications at $0.01/verification, $0.50 USDC paid out on Base across daily / every-other-day / weekly cadence settings
- Fee model locked: $0.025 to group owners, $0.025 to Canvas per verification ($0.05 total from advertisers)
- **Pitch deck** produced (14 slides, dark theme, green accent, PPTX)
- **Four-page static HTML website** produced (index, group-owners, advertisers, team) — copywriting complete, not yet deployed to Vercel
- Early group owner tester: Ant (gave permission to use his group, re-verification pitch resonated)

---

### June 8, 2026 (initial deployment)

- Railway services live: canvas-ai + Postgres
- Telegram webhook registered at `canvas-ai-production.up.railway.app`
- `@CanvasProtocolBot` live
- Canvas Test group seeded (`tg_group_id -5145298837`)
- Join interception confirmed; `DEEP_LINK_SENT` state writing to Postgres verified
- Kimi API key loaded in Railway env
- State machine established: `DEEP_LINK_SENT` → `TASK_SENT` → `PASSED` / `FAILED` / `EXPIRED`

---

### Pre-deployment (late May / early June 2026)

- Canvas Protocol founded; 50/50 equity split with Mateo (@0xteo) confirmed before any code written
- New repo `fweekshow/canvas-ai` created as clean slate — not forked from Basemate
- Postgres schema designed: five tables (groups, verifications, advertiser_budgets, templates, user_activity_log)
- 13-state verification machine specced
- Auction mechanics designed: BIGINT microunits throughout, winner-takes-all per join, outbid queue, bid ladder fallback
- Three-stage rollout planned: internal POC → subsidized stress test → real-money launch
- Introduced to Mateo via Igor (Bankr DevRel) — Mateo built Basemate, Base Batches 002 alumnus
- DevConnect 2025 finalist: ETH Foundation × EigenLayer Vault hacker house, one of five featured projects from fifteen teams

---

## Current State — What's Live

### Core verification loop
- Join interception via Telegram webhook ✅
- User muted on join, captcha task sent via DM ✅
- Kimi AI scoring of responses ✅
- Re-prompt on thin responses ✅
- Post-verification rules gate with "I agree ✓" button ✅
- Admit on pass ✅
- USDC payout fires on verification pass ✅
- State machine: `DEEP_LINK_SENT` → `TASK_SENT` → `PASSED` → `RULES_PENDING` → `ADMITTED` ✅

### Payment infrastructure
- `CanvasEscrowV0.sol` deployed on Base mainnet ✅
- Deposit monitoring and confirmation ✅
- Daily batch payouts to group owner wallets ✅
- Bid ladder with auto-promotion on budget exhaustion ✅
- Top-up, pause, resume, withdraw flows ✅

### Group owner experience
- `/register` → DM-only confirmation + portal link ✅
- `/menu` with 5-button inline keyboard ✅
- `/wallet` gated to DM ✅
- Custom rules configurable at registration ✅
- Dual-identity mode selector for owner + advertiser accounts ✅

---

## Pending — Needs Testing

**Verification flow**
- [ ] New DM copy appears correctly — warm opener, no "quick verification" header
- [ ] Short answer triggers re-prompt
- [ ] Fuller answer passes Kimi, rules message appears with "I agree ✓" button
- [ ] Tapping agree → unmuted and admitted
- [ ] Not tapping → `RULES_TIMED_OUT` after 10 min, user stays muted
- [ ] `RULES_PENDING` state confirmed in Postgres

**Registration flow**
- [ ] `/register` in group → single public line in chat, full instructions in owner DM
- [ ] `/wallet` in group → redirects to DM
- [ ] `/menu` in DM → all 5 buttons work correctly
- [ ] `/start` as group owner → owner menu (not advertiser screen)
- [ ] `/start` as dual-identity user → mode selector with both buttons
- [ ] Mode switching works in both directions

**Group rules**
- [ ] Rules prompt appears at end of `/register`
- [ ] Custom rules saved and displayed at verification time
- [ ] Skip → defaults used

---

## Pending — Mateo's Side

**Advertiser controls for group owners**
- Accept/decline individual advertisers before campaign goes live in a group
- Bid ladder fallback: auto-accept previous leading advertiser when top bidder's budget runs out

**Verification rate limiting**
- One verification attempt per Telegram handle per 12 hours across all Canvas groups

**Basescan contract verification**
- `forge verify-contract` on `CanvasEscrowV0.sol` at `0x262ac1a082fd32c83e9b32ff1912ea070ed55890`
- Blocking Bankr integration

---

## Known Deferred Issues

- `CanvasEscrowV0.sol` unaudited — marked test-only in NatSpec. Budget for audit before public rollout.
- Read endpoints (`/api/advertiser`, `/api/group-owner`) trust bare wallet strings — information-disclosure risk. Close before public rollout.
- `/api/groups` endpoint does not exist — needed for advertiser dashboard Available Groups tab.
- No-advertiser groups still go through Kimi scoring — TODO in code to bypass Kimi and admit on any non-empty response.
- "Current advertiser" in 📊 My Stats shows `—` — no advertiser name field in DB.
- Dual-identity session mode in-memory only — clears on bot restart. User hits `/start` again.

---

## On the Horizon

- Complete end-to-end test with second Telegram account
- Basescan contract verification (unblocks Bankr)
- Investor meeting: Joshua Howard (Redbeard Ventures) — dry run before Alliance DAO / Base Batches
- Alliance DAO and Base Batches applications — velocity narrative, don't wait for larger revenue
- Bankr informal conversation (Igor) before formal applications
- Group owner and advertiser web pages — deploy to Vercel
- Pitch deck and end-to-end demo loop
- Smart contract audit
- Phase 2: periodic re-verification of existing members (recurring revenue)
- Platform expansion: Farcaster next after Telegram

---

## Infrastructure Reference

| Service | Detail |
|---|---|
| Railway project | `bef22e72-bab1-4682-8495-c534cddedf45` |
| Webhook | `canvas-ai-production.up.railway.app` |
| Bot | `@CanvasProtocolBot` |
| Test group | `tg_group_id -5145298837` |
| Escrow contract | `0x262ac1a082fd32c83e9b32ff1912ea070ed55890` (Base mainnet) |
| Company wallet | `0x199390C2C6Af11b8938c6fCd86208b370D43C61F` |
| Kimi API | `api.moonshot.ai/v1` · `KIMI_API_KEY` in Railway env |
| Local repo | `/Users/rohitsarkar/canvas` |
