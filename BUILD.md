# Canvas Protocol — Build Log
**Last updated:** July 2, 2026  
**Repo:** `fweekshow/canvas-ai` · **Branch:** `main`  
**Infrastructure:** Railway (canvas-ai + Postgres) · Base mainnet · `@CanvasProtocolBot`  
**Smart contract:** `CanvasEscrowV0.sol` at `0x262ac1a082fd32c83e9b32ff1912ea070ed55890`

---

## Changelog

### July 2, 2026

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
- Kimi scoring of responses
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
- Confirm rules gate appears and "I agree ✓" admits user
- Confirm group picker routes correctly for multi-group owner

### Pending — Mateo
- Basescan contract verification via `forge verify-contract` (blocking Bankr integration)
- Advertiser accept/decline layer for group owners
- Rate limiting: one verification attempt per handle per 12 hours across all groups
- `/api/groups` endpoint (needed for advertiser dashboard Available Groups tab)

---

## Known Issues

### Coinbase smart wallet fails in Telegram in-app browser
**Status:** Open — workaround available  
**Symptom:** Payment page at `canvas-ai-production.up.railway.app` throws "This app doesn't support smart wallets / window.opener is inaccessible" when opened from Telegram's in-app browser. Error originates from `keys.coinbase.com` COOP policy check.  
**Workaround:** Open the payment link in an external browser. Payment confirms correctly.  
**Root cause:** Telegram's in-app browser blocks `window.opener`. Coinbase smart wallet SDK requires it for the OAuth connection flow.  
**Fix options:**  
1. Add `Cross-Origin-Opener-Policy: same-origin-allow-popups` to payment page response headers  
2. Force payment link to open in external browser via Telegram link formatting  
**Confirmed:** Campaign #9 escrow write succeeded despite the error — no funds at risk.

### `registered_at` not written on group insert
**Status:** Open  
**Symptom:** All rows in `groups` table have null `registered_at`. Group picker ordering is coincidentally correct (falls back to `group_id DESC`) but is not reliable long-term.  
**Fix:** Add `DEFAULT NOW()` to `registered_at` column in schema, or add explicit `registered_at: new Date()` to the group insert query.

### `group_title` null on old group rows
**Status:** Low priority  
**Symptom:** Groups registered before `group_title` column was added show as "Group {group_id}" in the picker.  
**Fix:** `UPDATE groups SET group_title = 'Canvas Test 2' WHERE group_id = 5;` (or deactivate old test groups with `UPDATE groups SET is_active = false WHERE group_id IN (5, 8, 12);`)

### Dual-identity session clears on bot restart
**Status:** Known, deferred  
**Symptom:** `activeTgGroupId` and mode stored in-memory only. Bot restart (Railway redeploy) clears all sessions. Users hit `/start` again to restore.  
**Fix:** Persist session to Postgres or Redis. Deferred until needed.

### No-advertiser groups still call Kimi
**Status:** Known, deferred  
**Symptom:** Groups with no active advertiser budget still run Kimi scoring. There is a TODO in the code to bypass Kimi and admit on any non-empty response for no-advertiser groups.

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
