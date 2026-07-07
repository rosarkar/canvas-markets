# Canvas Protocol

Canvas replaces the useless bot-check captcha on Telegram group joins with a short, sponsored verification task. A user requesting to join a registered group is intercepted, muted, and DM'd a task (multiple-choice captcha or open-text question, optionally sponsored by an advertiser). Responses are scored by an LLM (Kimi); passing users agree to the group rules and are admitted. The group owner earns USDC per verified join, paid from the advertiser's on-chain escrow on Base. Canvas takes a protocol fee. The verification layer doubles as a source of contextual human responses (RLHF-style ranking tasks, product-preference tasks) for AI-lab and DeFi advertisers.

## Live infrastructure

| What | Where |
|---|---|
| Repo (source of truth, auto-deploys `main`) | `rosarkar/canvas-ai` |
| Railway service | `https://canvas-ai-production-eae7.up.railway.app` (project `30c2e333-…`, + Postgres) |
| Bot | `@CanvasProtocolBot` (webhook mode, path `/telegram/webhook`) |
| Escrow contract (Base mainnet, verified on Basescan, first-depositor guard) | `0xf808b264E13Bf809C8e86afaF4e14c200931101E` |
| Relayer (only address that can move escrow funds) | `0xbD5f911E8621Ec144681d17a8b59DcDd3f9356d9` |
| Deprecated — do not use | `fweekshow/canvas-ai` repo; escrows `0x262a…5890` (partial bytecode) and `0x13aA…561B` (pre-guard) |

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node 20+, TypeScript (strict, ESM, `@/` path aliases), `tsx` in dev |
| Bot | grammY (webhook mode behind Express) |
| HTTP | Express — bot webhook, `/health`, read APIs, static dashboards + mini-app |
| Database | Postgres via `pg`, no ORM; schema applied at boot (`CREATE TABLE / ADD COLUMN IF NOT EXISTS` in `src/adapters/schema.ts`) |
| Chain | viem on Base mainnet (escrow reads/writes, wallet-signature auth) |
| Contracts | Solidity 0.8.20, Foundry (`forge test`; forge-std via git submodule) |
| Scoring | Kimi (Moonshot) chat completions, temperature 0, fail-closed + retry queue |
| Deploy | Railway, auto-deploy on push to `main`; Dockerfile two-stage build |
| Tests | vitest (`src/**/*.test.ts`) + Foundry tests (`test/*.t.sol`) |

## Run locally

```bash
git clone https://github.com/rosarkar/canvas-ai.git && cd canvas-ai
npm install
cp .env.example .env      # fill in the values below
npm run dev               # tsx watch src/index.ts
```

Required env vars (boot fails without them): `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_WEBHOOK_SECRET`. Everything else in `.env.example` is optional or has defaults.

Notes:
- The bot runs **webhook-only** — locally you need a public URL (e.g. an ngrok tunnel) in `TELEGRAM_WEBHOOK_URL`, and the app registers the webhook itself on boot. **Never boot with the production bot token locally**: you'd steal the production webhook.
- Postgres: any local instance works; the schema self-applies on boot.
- Contracts: `git submodule update --init && forge test` (requires Foundry).
- Useful scripts: `npm run typecheck`, `npm test`, `npm run smoke`, `npm run payout:batch` (manual batch run), `npm run deploy:escrow` (⚠️ deploys with relayer = deployer; the live contract was deployed with explicit constructor args instead — see BUILD.md July 7).

## Current state

**Working end-to-end:** join interception (both `chat_member` and join-request paths) → captcha/open-text task via DM → Kimi scoring with fail-closed + retry queue → post-verification rules gate → admission; advertiser campaigns (guided `/buy` flow, top-ups, withdraw with in-flight protection, group-owner accept/decline gate with 48h auto-accept); USDC escrow deposits (Base Pay + direct `depositBudget`) and daily payout batch (per-campaign balance checks, separate owner/fee legs, claim pattern); per-group 12h rate limiting with rejection audit log; recovery sweeps for every stranded state; admin DM alerts for silent failures; wallet-signature-authenticated dashboards (advertiser + group owner); persistent dual-identity sessions.

**Deferred / V2:**
- **Rate-limiting review** — current thresholds (12h per-group window, 24h failure cooldown) are first-pass values; revisit with real traffic data. `COOLDOWN_REJECTED` rows are the signal source.
- **Phase 2 re-verification** — periodic re-verification of existing members (the recurring-revenue model); not started.
- Also parked: contract audit (before public rollout), group-owner abuse detection (freeze payouts on farming signals — design in BUILD.md), mod/admin payout splits, scoring-bonus persistence for deferred completions.

## Read these first

1. **`BUILD.md`** — the full build log: every design decision, every resolved issue with its commit, current pending items. The single source of truth for "why is it like this."
2. **`src/telegram/handlers/join.ts`** (+ `join-request.ts`, `src/telegram/services/group-join-captcha.ts`) — the front door: how joins are intercepted and gated (cooldowns, rate limit, resume logic) before a verification starts.
3. **`src/services/escrow.ts`** — every on-chain interaction: the confirmed ABI, relayer wallet, payout/credit/balance calls, and the comment explaining why `refundUnusedBudget` was removed.
4. **`contracts/CanvasEscrowV0.sol`** — the escrow itself (~90 lines). Deployed bytecode matches this source (verified on Basescan).
5. Bonus: `src/services/verification-states.ts` — the 17-state verification state machine with per-state exemption docs; most bugs in this codebase's history lived in state transitions.

## Money paths (be careful here)

Verification pass → `accrueVerificationPayout` (locks price) → daily `payout-batch.ts` (advisory lock, claim pattern, on-chain balance check per campaign, owner + fee legs tracked separately) → `releasePayout` on the escrow, signed by the relayer key (Railway env only). Refunds and declines pay the advertiser's wallet from the `advertisers` table — never the on-chain `campaignDepositor`. If you touch any of this, read the BUILD.md entries for commits `915e475`, `88c838b`, and `3a475f7` first, and run both test suites.
