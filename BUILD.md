# Canvas Protocol — Build Log
**Last updated:** July 2, 2026  
**Repo:** `fweekshow/canvas-ai` · **Branch:** `main`  
**Infrastructure:** Railway (canvas-ai + Postgres) · Base mainnet · `@CanvasProtocolBot`  
**Smart contract:** `CanvasEscrowV0.sol` at `0x262ac1a082fd32c83e9b32ff1912ea070ed55890`

---

## Changelog

### July 2, 2026 (evening)

**Fix: Kimi fallback URL corrected** (commit `23584ed` part 1)
- `src/config/config.ts` — hardcoded fallback for `KIMI_BASE_URL` changed from `"https://api.moonshot.cn/v1"` to `"https://api.moonshot.ai/v1"`
- Production was already correct via Railway env var but any new environment (local dev, staging, env reset) would have silently routed all Kimi calls to the wrong domain

**Fix: No-advertiser groups bypass Kimi** (commit `23584ed`)
- `src/telegram/services/process-text-response.ts` — `finalize()` now checks `verification.advertiserId == null` before calling Kimi
- If null, synthesizes `{ score: 100, method: "manual" }` and sets `passed = true` directly — no Kimi HTTP call made
- `src/telegram/services/captcha-dm.ts` — TODO comment removed (issue resolved)

### July 2, 2026 (afternoon)

**Group picker for multi-group owners**
- `/start` owner path now detects how many groups an owner has registered
- 1 group → proceeds directly to 5-button owner menu as before
- 2+ groups → shows inline keyboard listing each group by `group_title` with callback `select_group:{tg_group_id}`
- Selected group stored as `activeTgGroupId` in session Map
- Session Map type changed from `Map<number, 'owner' | 'advertiser'>` to `Map<number, { mode: 'owner' | 'advertiser', activeTgGroupId?: number }>`

**Scoped menu actions**
- All owner menu actions (Portal Link, My Stats, Edit Rules, Update Wallet) now call `resolveActiveGroup(fromId)` first and scope queries to `WHERE tg_group_id = $1` instead of iterating all groups for the owner
- If `activeTgGroupId` is missing from session (bot restart, session cleared), action re-shows group picker inline via `editMessageText`
- `updateGroupWallet` scoped to active group's `tg_group_id` rather than owner-wide wallet update

**6-button owner menu**
- Added "🔄 Switch group" button (clears `activeTgGroupId`, re-shows picker)
- "🔄 Switch mode" button retained for dual-identity users

**"Type /start to return to the main menu" footer**
- Added to every handler that sends a flow screen or multi-step prompt and has no natural back button
- Added in: `process-text-response.ts` (all 4 re-prompt constants), `captcha-callback.ts` (wrong answer message), `campaigns.ts` (campaigns list), `buy.ts` (all buy flow steps), `register.ts` (all registration steps), `menu.ts` (group picker and wallet prompt)
- Intentionally excluded from: success confirmations, the owner menu itself, the mode selector, admission rules DM (has "I agree ✓" exit), timeout notifications, all group chat messages

**Database cleanup**
- Old test groups deactivated: `UPDATE groups SET is_active = false WHERE group_id IN (5, 8, 12);`
- Canvas / Bankr (group_id 14) is now the only active group in the picker

---

### June 30, 2026

**Verification UX**
- Rewrote initial DM copy for `OPEN_TEXT` tasks — warmer opener explaining Canvas, removed "quick verification" header and "In one sentence" constraint
- Removed pre-task `RULES_SENT` gate — captcha is now the first message a joining user sees
- Post-verification rules gate added: after Kimi pass, user sees group rules + "I agree ✓" inline button; unmuted and admitted only after tapping
- New states: `RULES_PENDING` (10-min TTL), `ADMITTED` (terminal), `RULES_TIMED_OUT`
- `RULES_PENDING` timeout sweep added to existing 60s TTL loop
- Fixed critical bug: `state = 'PASSED'` was hardcoded as terminal in `payout-batch.ts` and two stats queries — all three now match any post-pass state so group owner payouts don't silently break

**Group rules**
- Replaced Kimi multi-turn rules drafting flow (`rules-setup.ts`, `rules-assistant.ts`, `/rules` command) with simple send-or-skip prompt at end of `/register`
- Rules stored in `groups.rules` JSONB column
- Post-verification rules message reads from `groups.rules`; falls back to three hardcoded defaults if null/empty
- Rules editable anytime via `/menu` → Edit Rules

**Registration flow — moved to DM**
- All registration confirmation messages now sent to group owner via DM only
- Group chat receives one public line: `✅ [group name] is now verified by Canvas. New members will be asked to complete a quick verification before joining.`
- Group chat also sends a notification tagging the owner to check their DM
- `/wallet` command now DM-only; redirects to DM if run in group chat

**Owner menu**
- `/menu` command (DM-only) with 5-button inline keyboard: 📊 My Stats / 🔗 Portal Link / ✏️ Edit Rules / 💰 Update Wallet / ❓ Help
- My Stats: weekly verifications, total pending earnings, top active bid
- Portal Link: resends group invite link
- Edit Rules: reuses registration rules-save flow
- Update Wallet: prompts for new address, writes to `groups.wallet`
- Help: sends command list

**Dual-identity routing**
- `/start` detects if user is both a group owner and an advertiser
- Single-identity users go straight to their menu
- Dual-identity users see mode selector: "🏘️ Manage my groups / 📢 Run campaigns"
- Mode stored in session Map; "🔄 Switch mode" button in both menus

---

### June 28, 2026 (Mateo commits e43a039 → 644a5f3)

- `CanvasEscrowV0.sol` deployed on Base mainnet — deposit, payout, refund functions
- `/buy` flow switched from Kimi conversational agent back to guided button flow (reverses `d901fba`)
- Base Pay credit timing fix + orphaned USDC recovery
- Top-up flow for existing campaigns
- Withdraw/refund surfaced as inline buttons on `/start` and `/campaigns`

---

### June 25, 2026

- Kimi API endpoint corrected: `api.moonshot.cn` → `api.moonshot.ai/v1`
- `callKimi` extracted as shared client in `scoring.ts`, reused by scoring and rules assistant
- `KIMI_BASE_URL` added to Railway environment variables
- `BUILD_PLAN.md` created at repo root

---

### June 7, 2026 (Phase 1 launch)

- Railway deployment live: `canvas-ai` service + Postgres, both Online
- Webhook live at `canvas-ai-production.up.railway.app/telegram/webhook`
- Kimi API key loaded in Railway as `KIMI_API_KEY` ($20 credits)
- Canvas Test group seeded (`tg_group_id -5145298837`)
- Join interception confirmed; `DEEP_LINK_SENT` state writing to Postgres

---

## Current State (as of July 2, 2026)

### Working
- Join interception and mute
- Captcha task delivery via DM
- Kimi scoring of responses (with no-advertiser bypass)
- Re-prompt on thin/short answers
- Post-verification rules gate with "I agree ✓"
- USDC payout on verification pass
- Group owner DM menu (6 buttons, group-scoped)
- Group picker for multi-group owners
- Dual-identity mode selector
- Advertiser buy flow (guided button flow)
- Campaigns list with withdraw/pause/resume/top-up
- `/start` escape hint on all flow screens

### Needs End-to-End Testing
- Full verification loop with a real non-admin account in Canvas / Bankr group
- Confirm USDC payout fires correctly on pass
- Confirm Kimi scoring works on a live response (first real test of Kimi connectivity)
- Confirm rules gate appears and "I agree ✓" admits user
- Confirm group picker routes correctly for multi-group owner

---

## Issues & Pending Work

### Mateo — Fix immediately (blocks live testing)

**`registered_at` not written on group insert**
- **File:** `src/adapters/schema.ts`
- **Root cause:** The `registered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP` column is defined inside the `CREATE TABLE IF NOT EXISTS groups` block, but Postgres skips that entire block because the table already exists. The column was never added to the live database. Every row in the `groups` table has null `registered_at`.
- **Current behaviour:** Group picker ordering works by coincidence — the query falls back to `group_id ASC` which happens to be chronological. Not reliable long-term.
- **Fix:** Run this migration against the live Railway Postgres, then add it to the schema init so it runs on future deploys:
  ```sql
  ALTER TABLE groups ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
  ```
- **Also:** In `src/adapters/groups.adapter.ts`, the `registerGroup` INSERT omits `registered_at` from the column list. After the migration, new rows will pick up the DB-level default, but confirm this is intentional rather than adding an explicit value.

---

**Stuck `PASSED` state**
- **Files:** `src/telegram/services/process-text-response.ts` (the `completeVerificationPass` function), `src/index.ts` (the 60s TTL loop)
- **Root cause:** The verification flow transitions `PASSED → RULES_PENDING` by calling `sendAdmissionRulesDm`. If that Telegram API call throws mid-flight (network error, Telegram outage, rate limit), the row stays in `PASSED` permanently. `getActiveVerificationForUser` in `src/adapters/verification.adapter.ts` excludes `PASSED` from its active set, so the user is muted forever and a duplicate verification can start.
- **Fix:** In `src/index.ts`, add a recovery sweep inside the existing 60s `setInterval` alongside the `RULES_PENDING` sweep:
  1. Find any verification in `PASSED` state where `updated_at < NOW() - INTERVAL '2 minutes'`
  2. Re-attempt `sendAdmissionRulesDm` for each
  3. If it fails again, transition to `RULES_TIMED_OUT` and leave user muted — do not call unmute

---

### Mateo — Fix before approaching advertisers

**Basescan contract verification**
- **Command:** `forge verify-contract 0x262ac1a082fd32c83e9b32ff1912ea070ed55890 CanvasEscrowV0 --chain base --etherscan-api-key $BASESCAN_API_KEY`
- **Why it matters:** Bankr integration requires a verified contract. Unverified contracts show as bytecode on Basescan — advertisers and partners can't inspect what they're depositing into.
- **Note:** Contract is currently marked test-only in NatSpec. Confirm NatSpec comments are updated before verifying publicly.

---

**Coinbase smart wallet fails in Telegram in-app browser**
- **Where it fails:** The payment page at `canvas-ai-production.up.railway.app` served when an advertiser taps the funding link in Telegram
- **Error:** "This app doesn't support smart wallets / window.opener is inaccessible" from `keys.coinbase.com`
- **Root cause:** Telegram's in-app browser sets `Cross-Origin-Opener-Policy: same-origin` which blocks `window.opener`. The Coinbase smart wallet SDK requires `window.opener` to complete its OAuth-style connection flow.
- **Workaround confirmed:** Opening the link in an external browser works — Campaign #9 escrow write succeeded, no funds at risk.
- **Fix option 1 (recommended):** Add this response header to the payment page server response:
  ```
  Cross-Origin-Opener-Policy: same-origin-allow-popups
  ```
- **Fix option 2:** Append `?startapp` to the Telegram link or restructure as a `t.me` deep link so Telegram opens it in an external browser automatically.

---

**Advertiser accept/decline layer for group owners**
- **What it is:** Before a campaign goes live in a group, the group owner should be able to approve or reject the advertiser. Currently any funded campaign immediately becomes active.
- **Proposed flow:** When an advertiser funds a campaign targeting a group, bot DMs the group owner: "New campaign request from [advertiser name] — $X/verification, [task preview]. Accept or Decline?" Inline buttons. If declined, escrow refunded to advertiser. If no response within 48 hours, auto-accept.
- **DB change needed:** Add `status` column to `advertiser_budgets` table: `pending | active | declined`. Payout batch and verification flow must check `status = 'active'` before serving tasks.
- **Bid ladder note:** When top bidder's budget runs out, the next bidder in the ladder should auto-promote to active rather than requiring a new accept — group owner already approved that advertiser category implicitly.

---

**Rate limiting — one verification attempt per Telegram handle per 12 hours across all groups**
- **Current state:** Every table scopes by `(tg_user_id, group_id)` pairs. There is no global user tracking table. A user can attempt verification in unlimited groups simultaneously.
- **Why it matters:** Without rate limiting, a coordinated bot farm can cycle the same handles across many groups quickly.
- **Proposed fix:** Add a `user_cooldowns` table (may already exist in schema — check) with columns `tg_user_id`, `last_attempt_at`, `attempt_count`. On each join intercept in `join.ts`, query this table. If `last_attempt_at > NOW() - INTERVAL '12 hours'`, reject with a message and do not start a verification.
- **Note:** Rate limiting was deliberately deferred to preserve maximum visible verification counts during early investor conversations. Implement before public rollout.

---

**`/api/groups` endpoint**
- **What it is:** A read endpoint that returns the list of registered groups with member count, topic, and current top bid — needed by the advertiser dashboard's Available Groups tab.
- **Current state:** Endpoint does not exist. The advertiser dashboard UI gracefully shows an empty state when it 404s.
- **Shape needed:**
  ```json
  [{ "tg_group_id": -5501340634, "group_title": "Canvas / Bankr", "topic": "...", "member_count": 0, "top_bid": 0.35 }]
  ```
- **Auth:** Same bare wallet pattern as other read endpoints for now — add signature verification before public rollout.

---

### Known — Deferred (not blocking)

**Dual-identity session clears on bot restart**
- **Files:** `src/telegram/handlers/menu.ts` and `src/telegram/handlers/start.ts` — session stored in a `Map<number, { mode, activeTgGroupId? }>` in-memory
- **Symptom:** Railway auto-deploys on every push to main, which restarts the bot process and clears all sessions. Users who were mid-flow hit `/start` again to restore context.
- **Fix:** Persist session to a `user_sessions` table in Postgres or a Redis key with TTL. Deferred until session loss becomes a user complaint.

---

**Read endpoints trust bare wallet strings**
- **Files:** `src/api/advertiser.ts`, `src/api/group-owner.ts`
- **Symptom:** Both endpoints accept a bare wallet address as the identity claim with no cryptographic proof. Anyone who knows a wallet address can read that wallet's campaign or group data.
- **Risk level:** Information disclosure only — no funds at risk. Read-only endpoints.
- **Fix:** Standard wallet signature flow — server issues a nonce, client signs it with their wallet, server verifies signature matches the claimed address. Implement before public rollout when real advertiser data is in the system.

---

## Planned Features

### Group owner abuse detection (Phase 2)
**Goal:** Detect group owners farming payouts with bot accounts and freeze payouts pending manual review.

**Red flags to score per group:**
- High verification volume in a short window relative to group member count
- Unusually high pass rate (near-100% is suspicious — legitimate groups expect some failures)
- Response similarity across verifications in the same group (bots submit near-identical answers)
- New accounts passing at high rates (no prior Telegram history detectable via join date)
- Verification attempts clustered in tight time intervals (e.g. 10 joins in 2 minutes)

**Proposed flow:**
1. After each verification batch, Kimi scores the group's aggregate response patterns against the red flag criteria above
2. If any threshold is exceeded, group owner payouts are frozen — funds remain in escrow, not released
3. Bot sends owner a DM: "Your payouts have been paused for review. Our team will be in touch within 48 hours."
4. Canvas team is notified (Telegram DM or email alert) to review manually
5. Team either clears the group (payouts resume) or confirms fraud (escrow refunded to advertiser, group deregistered)

**Schema additions needed:**
- `groups.payout_frozen` boolean, default false
- `groups.frozen_at` timestamp
- `groups.freeze_reason` text
- Payout batch query must check `payout_frozen = false` before releasing USDC

**Smart contract note:** Freeze enforced at agent server level (skip Step 2 call) — not at contract level. Adding a freeze function to `CanvasEscrowV0.sol` increases audit surface area before the contract is audited.

---

## Deferred

- Smart contract audit (unaudited, marked test-only in NatSpec — budget before public rollout)
- Re-verification cadence (Phase 2)
- Mod/admin payout splits (Phase 2)
- Token issuance decision (deferred until term sheet or funding clarity)
- Incorporation (deferred until term sheet or token decision)
- Mateo relocation to North America (deferred until Canvas has funding — Alliance DAO acceptance would require NYC)

---

## Founding Context (Archive)

### What Canvas Protocol Is

Canvas Protocol is a decentralized verification marketplace that replaces standard Telegram group join checks with meaningful sponsored captcha tasks.

**The one-sentence pitch:** Instead of solving a useless bot-check to join a Telegram group, you complete a short task sponsored by an advertiser or AI lab — the group owner gets paid in USDC, the advertiser gets a verified human completion with audience context, and the human gets access.

**Origin:** Rohit has been building this concept for several years. He presented an MVP at an EigenLayer + ETH Foundation hacker house in Buenos Aires during DevConnect 2024, where it was selected as one of five featured projects. The original design used EigenLayer for trust. The current iteration runs on Base.

---

### Team

**Rohit Sarkar** (@_rosark, Toronto) — product, GTM, copywriting, investor relations. Background in protocol research and content across InfStones, Figment, Caldera, and 0x (Content Manager Jan–Jun 2026, laid off June 5). Statistics education. Can code SQL/Python/R, comfortable in terminal. Now fully focused on Canvas.

**Mateo** (@0xteo, based in Asia) — smart contract development, backend infrastructure, complex state machine work. Builder of Basemate (Base Batches 002 alumnus). Introduced by Igor from the Bankr team. 50/50 equity split.

Canvas was started as a clean separate project from Basemate — new repo, new entity — so both founders have clean ownership with no cap table entanglement.

---

### Business Model

**Protocol fee:** Canvas takes 50% at launch, with a stated trajectory toward a smaller cut as volume scales. (Note: the original spec said 10–15%; the launch number is 50% as an interim marketplace rate while supply and demand are thin. This compresses over time — position as marketplace-comp trajectory when pitching.)

**Moat:** The group registry and quality verification layer. Canvas becomes the trust infrastructure that tells advertisers which groups are legitimate and which completions are genuine.

**Revenue math (Phase 3):** A group with 5,000 members re-verified monthly at $0.10 generates $500/month passively. Canvas keeps its protocol share. Scaled across thousands of groups this is significant recurring protocol revenue.

---

### Captcha Task Design

**Type 1 — RLHF training data (AI lab advertiser)**
Human ranks AI responses from most to least helpful, matched to group topic. A crypto-native human's ranking of DeFi responses is premium training data. Verified contextual humans vs. random Mechanical Turk annotators.

Example (crypto trading group, DeFi AI Lab):
> Rank these 3 responses from most to least helpful. Reply B, A, C.
> A — "To swap tokens, connect your wallet, select the pair, and confirm."
> B — "You need ETH for gas. Approve the token first, then swap. Check slippage."
> C — "Blockchain technology enables decentralised finance through trustless smart contracts."

**Type 2 — Agent acquisition (DeFi protocol advertiser)**
No wrong answer. Human engages with advertiser's product framing, gets offered an agent connection post-verification. Advertiser pays per verified DeFi-native lead, not per impression.

Example (Base DeFi Traders group, Aave):
> You have 10,000 USDC. What would you do?
> A — Supply to Aave at 4.2% APY and borrow against it
> B — Hold in cold wallet
> C — Bridge to another chain for higher yield
> Sponsored by Aave · no wrong answer

---

### Competitive Positioning

**vs. Google reCAPTCHA:** Google keeps all the value. Canvas pays publishers directly.

**vs. Basemate / Mateo's original PPH model:** Basemate has agents paying to reach humans, Basemate taking the fee, and humans receiving only an invite. The human is the product but doesn't get compensated. Canvas is transparent — humans opt in by completing a task, group owners earn directly, advertisers get verified completions not scraped signals.

**vs. Scale AI / Mechanical Turk:** Active opt-in labor markets. Canvas is ambient — humans are already joining a group, the captcha redirects that micro-attention toward valuable tasks. Lower friction, higher scale, better demographic coverage, cryptographically provable provenance.

**vs. World ID:** Proves you're human but generates no useful signal. Canvas combines proof of humanity with productive micro-tasks.

---

### Target Advertisers

**Tier 1 (warm, approach first):** Moonwell, Avantis, Bankr ecosystem agents  
**Tier 2:** Aave, Morpho, Across, Gauntlet  
**Tier 3 (longer sales cycles):** Nous Research, Sentient, Gensyn

**Target group supply side:** Lennox Cartel, Mfers, OCR. First group owner: Ant (gave permission for early testing).

---

### Funding Targets

Alliance DAO, Base Batches, Bankr. Traditional seed VCs deferred until live revenue milestones. Pitch frames Canvas as the foundational missing market — verified human attention priced onchain.

---

### Open Questions (Founding Session — most resolved)

- Equity split → resolved: 50/50
- Smart contract auditor before Phase 2 → deferred, budget before public rollout
- Minimum group size to prevent sybil groups → open
- Escrow lock period and refund trigger → open
- Task types in Phase 1 → resolved: open text, ranking, binary choice all live
- First AI labs to approach → resolved: Tier 1 = Moonwell, Avantis, Bankr agents
- Canvas token vs. USDC only → deferred until term sheet or funding clarity

---

### Key Environment Variables
- `KIMI_BASE_URL=https://api.moonshot.ai/v1`
- `KIMI_API_KEY` — in Railway
- `COMPANY_WALLET=0x199390C2C6Af11b8938c6fCd86208b370D43C61F`

### Key IDs
- Railway project: `bef22e72-bab1-4682-8495-c534cddedf45`
- Canvas Test group: `tg_group_id -5145298837`
- Canvas / Bankr group: `tg_group_id -5501340634` (group_id 14, active)
- Bot: `@CanvasProtocolBot`
- Domain: `canvas-protocol.com` (Cloudflare + Vercel)

---

*Canvas Protocol · BUILD.md · confidential*
