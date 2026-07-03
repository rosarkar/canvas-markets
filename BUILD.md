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

### Pending — Mateo
- **`registered_at` schema migration** — `ALTER TABLE groups ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;` needs to run against live DB; `CREATE TABLE IF NOT EXISTS` block is skipped because table already exists, so column was never added
- **Stuck `PASSED` state recovery** — if `sendAdmissionRulesDm` throws mid-flight, verification stays stuck in `PASSED` forever; needs a sweep in the 60s TTL loop to re-attempt or transition to `RULES_TIMED_OUT` after 2 minutes
- **Basescan contract verification** via `forge verify-contract` (blocking Bankr integration)
- **Advertiser accept/decline layer** for group owners
- **Rate limiting** — one verification attempt per handle per 12 hours across all groups
- **`/api/groups` endpoint** (needed for advertiser dashboard Available Groups tab)
- **Coinbase smart wallet COOP fix** — add `Cross-Origin-Opener-Policy: same-origin-allow-popups` to payment page response headers, or force link to open in external browser

---

## Known Issues

### Coinbase smart wallet fails in Telegram in-app browser
**Status:** Open — workaround available  
**Symptom:** Payment page throws "This app doesn't support smart wallets / window.opener is inaccessible" when opened from Telegram's in-app browser.  
**Workaround:** Open the payment link in an external browser. Payment confirms correctly.  
**Root cause:** Telegram's in-app browser blocks `window.opener`. Coinbase smart wallet SDK requires it for the OAuth connection flow.  
**Fix options:**
1. Add `Cross-Origin-Opener-Policy: same-origin-allow-popups` to payment page response headers
2. Force payment link to open in external browser via Telegram link formatting  
**Confirmed:** Campaign #9 escrow write succeeded despite the error — no funds at risk.

### `registered_at` not written on group insert
**Status:** Open — Mateo to fix  
**Symptom:** All rows in `groups` table have null `registered_at`. Group picker ordering currently works (falls back to `group_id ASC`) but is not reliable long-term.  
**Root cause:** `CREATE TABLE IF NOT EXISTS` block is skipped for existing tables so the column definition was never applied to the live DB. No `ALTER TABLE` migration exists.  
**Fix:** `ALTER TABLE groups ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;`

### Stuck `PASSED` state
**Status:** Open — Mateo to fix  
**Symptom:** If `sendAdmissionRulesDm` throws a Telegram API error after Kimi passes, the verification row stays in `PASSED` permanently. User is muted forever. A duplicate verification can start for the same user.  
**Fix:** Add a sweep in the 60s TTL loop: find any verification in `PASSED` state for more than 2 minutes, re-attempt `sendAdmissionRulesDm`, or transition to `RULES_TIMED_OUT` on second failure.

### `group_title` null on old group rows
**Status:** Low priority  
**Symptom:** Groups registered before `group_title` column was added show as "Group {group_id}" in the picker.  
**Fix:** `UPDATE groups SET is_active = false WHERE group_id IN (5, 8, 12);` to hide old test groups from picker.

### Dual-identity session clears on bot restart
**Status:** Known, deferred  
**Symptom:** `activeTgGroupId` and mode stored in-memory only. Bot restart clears all sessions. Users hit `/start` again to restore.  
**Fix:** Persist session to Postgres or Redis. Deferred until needed.

### Read endpoints trust bare wallet strings
**Status:** Security — close before public rollout  
**Symptom:** `/api/advertiser` and `/api/group-owner` endpoints accept bare wallet addresses with no signature proof. Information-disclosure risk (not funds-at-risk).  
**Fix:** Add wallet signature verification (sign a nonce, verify on server) before public rollout.

---

## Deferred

- Smart contract audit (unaudited, marked test-only in NatSpec — budget before public rollout)
- Re-verification cadence (Phase 2)
- Mod/admin payout splits (Phase 2)
- Token issuance decision (deferred until term sheet or funding clarity)
- Incorporation (deferred until term sheet or token decision)
- Mateo relocation to North America (deferred until Canvas has funding — Alliance DAO acceptance would require NYC)

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
