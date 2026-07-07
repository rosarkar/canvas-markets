import { randomUUID } from "node:crypto";

import { db } from "@/db.js";
import { config } from "@/config/index.js";
import {
  COOLDOWN_STATES,
  VerificationState,
  type VerificationState as State,
} from "@/services/verification-states.js";

export type VerificationEntryType = "open_join" | "join_request";

export interface VerificationRow {
  verificationId: string;
  tgUserId: bigint;
  groupId: number;
  advertiserId: number | null;
  state: State;
  entryType: VerificationEntryType;
  lockedBidPrice: bigint | null;
  kimiScore: number | null;
  responseText: string | null;
  captchaQuestionId: string | null;
  captchaCorrectOption: string | null;
  taskType: string | null;
  taskPayload: unknown | null;
  attemptCount: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}

function mapRow(r: Record<string, unknown>): VerificationRow {
  return {
    verificationId: r.verification_id as string,
    tgUserId: BigInt(r.tg_user_id as string | bigint),
    groupId: r.group_id as number,
    advertiserId: r.advertiser_id as number | null,
    state: r.state as State,
    entryType: (r.entry_type as VerificationEntryType) ?? "open_join",
    lockedBidPrice:
      r.locked_bid_price != null ? BigInt(r.locked_bid_price as string | bigint) : null,
    kimiScore: r.kimi_score as number | null,
    responseText: r.response_text as string | null,
    captchaQuestionId: (r.captcha_question_id as string | null) ?? null,
    captchaCorrectOption: (r.captcha_correct_option as string | null) ?? null,
    taskType: (r.task_type as string | null) ?? null,
    taskPayload: r.task_payload ?? null,
    attemptCount: r.attempt_count as number,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
    expiresAt: r.expires_at as Date | null,
  };
}

export async function isUserInCooldown(tgUserId: bigint, groupId: number): Promise<boolean> {
  const res = await db.query<{ cooldown_until: Date }>(
    `SELECT cooldown_until FROM user_cooldowns
     WHERE tg_user_id = $1 AND group_id = $2 AND cooldown_until > NOW()`,
    [tgUserId.toString(), groupId],
  );
  return res.rows.length > 0;
}

export async function setCooldown(tgUserId: bigint, groupId: number): Promise<void> {
  const until = new Date(Date.now() + config.constants.COOLDOWN_MS);
  await db.query(
    `INSERT INTO user_cooldowns (tg_user_id, group_id, cooldown_until)
     VALUES ($1, $2, $3)
     ON CONFLICT (tg_user_id, group_id) DO UPDATE SET cooldown_until = EXCLUDED.cooldown_until`,
    [tgUserId.toString(), groupId, until],
  );
}

export async function createVerification(input: {
  tgUserId: bigint;
  groupId: number;
  advertiserId?: number | null;
  entryType?: VerificationEntryType;
}): Promise<VerificationRow> {
  const verificationId = randomUUID();
  const expiresAt = new Date(Date.now() + config.constants.VERIFICATION_TTL_MS);
  const entryType = input.entryType ?? "open_join";
  const res = await db.query(
    `INSERT INTO verifications (verification_id, tg_user_id, group_id, advertiser_id, state, expires_at, entry_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      verificationId,
      input.tgUserId.toString(),
      input.groupId,
      input.advertiserId ?? null,
      VerificationState.PENDING,
      expiresAt,
      entryType,
    ],
  );
  return mapRow(res.rows[0]!);
}

export async function getVerificationByToken(token: string): Promise<VerificationRow | null> {
  const res = await db.query(`SELECT * FROM verifications WHERE verification_id = $1`, [token]);
  if (!res.rows[0]) return null;
  return mapRow(res.rows[0]);
}

export async function transitionState(
  verificationId: string,
  newState: State,
  extra?: {
    lockedBidPrice?: bigint;
    responseText?: string;
    kimiScore?: number;
    captchaQuestionId?: string;
    captchaCorrectOption?: string;
    taskType?: string;
    taskPayload?: unknown;
    /** Added on top of locked_bid_price — e.g. a quality bonus for reasoned binary replies. */
    bonusMicroUnits?: bigint;
    /** Overrides expires_at — e.g. a fresh 10-minute window for the RULES_PENDING gate. */
    expiresAt?: Date;
    /**
     * Compare-and-swap guard: only transition if the row is currently in one of these
     * states. Prevents two concurrent webhook updates from both driving the same
     * verification through the finalize path (double scoring, double payout accrual).
     */
    expectedState?: State | State[];
  },
): Promise<boolean> {
  const expected =
    extra?.expectedState == null
      ? null
      : Array.isArray(extra.expectedState)
        ? extra.expectedState
        : [extra.expectedState];

  const res = await db.query(
    `UPDATE verifications
     SET state = $2,
         locked_bid_price = COALESCE($3, locked_bid_price) + COALESCE($10, 0),
         response_text = COALESCE($4, response_text),
         kimi_score = COALESCE($5, kimi_score),
         captcha_question_id = COALESCE($6, captcha_question_id),
         captcha_correct_option = COALESCE($7, captcha_correct_option),
         task_type = COALESCE($8, task_type),
         task_payload = COALESCE($9, task_payload),
         expires_at = COALESCE($11, expires_at),
         updated_at = NOW()
     WHERE verification_id = $1
       AND ($12::text[] IS NULL OR state = ANY($12::text[]))`,
    [
      verificationId,
      newState,
      extra?.lockedBidPrice?.toString() ?? null,
      extra?.responseText ?? null,
      extra?.kimiScore ?? null,
      extra?.captchaQuestionId ?? null,
      extra?.captchaCorrectOption ?? null,
      extra?.taskType ?? null,
      extra?.taskPayload != null ? JSON.stringify(extra.taskPayload) : null,
      extra?.bonusMicroUnits?.toString() ?? null,
      extra?.expiresAt ?? null,
      expected,
    ],
  );

  if ((res.rowCount ?? 0) === 0) return false;

  const row = await getVerificationByToken(verificationId);
  if (row && COOLDOWN_STATES.includes(newState)) {
    await setCooldown(row.tgUserId, row.groupId);
  }
  return true;
}

/** Bump attempt_count after sending a one-shot re-prompt for a thin/incomplete reply. */
export async function bumpAttemptCount(verificationId: string): Promise<void> {
  await db.query(
    `UPDATE verifications SET attempt_count = attempt_count + 1, updated_at = NOW() WHERE verification_id = $1`,
    [verificationId],
  );
}

export async function getActiveVerificationForUser(
  tgUserId: bigint,
  groupId: number,
): Promise<VerificationRow | null> {
  const res = await db.query(
    `SELECT * FROM verifications
     WHERE tg_user_id = $1 AND group_id = $2
       AND state NOT IN ('PASSED', 'FAILED', 'TIMED_OUT', 'ADMITTED', 'RULES_TIMED_OUT')
     ORDER BY created_at DESC LIMIT 1`,
    [tgUserId.toString(), groupId],
  );
  if (!res.rows[0]) return null;
  return mapRow(res.rows[0]);
}

/** Active verification awaiting a DM text reply (open_text, rank_reasoning, binary_reasoning tasks). */
export async function getActiveDmVerificationForUser(
  tgUserId: bigint,
): Promise<VerificationRow | null> {
  const res = await db.query(
    `SELECT * FROM verifications
     WHERE tg_user_id = $1
       AND state IN ('TASK_SENT', 'DEEP_LINK_SENT')
       AND task_type IN ('open_text', 'rank_reasoning', 'binary_reasoning')
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC LIMIT 1`,
    [tgUserId.toString()],
  );
  if (!res.rows[0]) return null;
  return mapRow(res.rows[0]);
}

export async function hasPassedVerification(
  tgUserId: bigint,
  groupId: number,
): Promise<boolean> {
  const res = await db.query(
    `SELECT 1 FROM verifications
     WHERE tg_user_id = $1 AND group_id = $2 AND state = 'ADMITTED'
     LIMIT 1`,
    [tgUserId.toString(), groupId],
  );
  return res.rows.length > 0;
}

export interface ExpiredVerification {
  verificationId: string;
  tgUserId: bigint;
  groupId: number;
  tgGroupId: bigint;
  entryType: VerificationEntryType;
  /** State the row was in when swept — RESPONSE_RECEIVED/SCORING means it was stranded mid-finalize. */
  previousState: string;
}

export async function expireStaleVerifications(): Promise<ExpiredVerification[]> {
  const res = await db.query<{
    verification_id: string;
    tg_user_id: string;
    group_id: number;
    tg_group_id: string;
    entry_type: VerificationEntryType;
    previous_state: string;
  }>(
    // Two tiers:
    //  - DEEP_LINK_SENT/TASK_SENT past expires_at: the normal user-never-answered timeout.
    //  - RESPONSE_RECEIVED/SCORING 2+ minutes past expires_at: stranded mid-finalize by a
    //    crash (these states normally last seconds). The grace window keeps an in-flight
    //    finalize from racing the sweep; if both fire, the CAS in transitionState means
    //    exactly one side wins. Without this tier the user stayed muted forever.
    `UPDATE verifications v
     SET state = 'TIMED_OUT', updated_at = NOW()
     FROM groups g
     WHERE v.group_id = g.group_id
       AND (
         (v.state IN ('DEEP_LINK_SENT', 'TASK_SENT') AND v.expires_at < NOW())
         OR
         (v.state IN ('RESPONSE_RECEIVED', 'SCORING')
          AND v.expires_at < NOW() - INTERVAL '2 minutes')
       )
     RETURNING v.verification_id, v.tg_user_id, v.group_id, g.tg_group_id, v.entry_type,
               -- RETURNING v.state would show the new value ('TIMED_OUT'); a subquery runs
               -- against the statement's start-of-statement snapshot, so it sees the old state.
               (SELECT state FROM verifications x
                WHERE x.verification_id = v.verification_id) AS previous_state`,
  );
  const expired: ExpiredVerification[] = [];
  for (const row of res.rows) {
    await setCooldown(BigInt(row.tg_user_id), row.group_id);
    expired.push({
      verificationId: row.verification_id,
      tgUserId: BigInt(row.tg_user_id),
      groupId: row.group_id,
      tgGroupId: BigInt(row.tg_group_id),
      entryType: row.entry_type ?? "open_join",
      previousState: row.previous_state,
    });
  }
  return expired;
}

export interface TimedOutRulesPending {
  verificationId: string;
  tgUserId: bigint;
  groupId: number;
}

/**
 * Sweeps RULES_PENDING verifications past their 10-minute window into RULES_TIMED_OUT.
 * Unlike expireStaleVerifications, this does not kick/decline the user — they're left muted.
 */
export async function expireStaleRulesPending(): Promise<TimedOutRulesPending[]> {
  const res = await db.query<{
    verification_id: string;
    tg_user_id: string;
    group_id: number;
  }>(
    `UPDATE verifications
     SET state = 'RULES_TIMED_OUT', updated_at = NOW()
     WHERE state = 'RULES_PENDING'
       AND expires_at < NOW()
     RETURNING verification_id, tg_user_id, group_id`,
  );
  return res.rows.map((row) => ({
    verificationId: row.verification_id,
    tgUserId: BigInt(row.tg_user_id),
    groupId: row.group_id,
  }));
}

export interface StuckPassedVerification {
  verificationId: string;
  tgUserId: bigint;
  groupId: number;
}

/**
 * Rows stranded in PASSED: completeVerificationPass crashed between the PASSED
 * transition and the RULES_PENDING transition (e.g. process restart, DB blip).
 * PASSED is excluded from the active-verification set, so without recovery the
 * user stays muted forever and a duplicate verification can start.
 */
export async function getStuckPassedVerifications(): Promise<StuckPassedVerification[]> {
  const res = await db.query<{
    verification_id: string;
    tg_user_id: string;
    group_id: number;
  }>(
    `SELECT verification_id, tg_user_id, group_id
     FROM verifications
     WHERE state = 'PASSED'
       AND updated_at < NOW() - INTERVAL '2 minutes'`,
  );
  return res.rows.map((row) => ({
    verificationId: row.verification_id,
    tgUserId: BigInt(row.tg_user_id),
    groupId: row.group_id,
  }));
}

export async function getRecentlyPassedVerification(
  tgUserId: bigint,
  groupId: number,
  withinMs = 60_000,
): Promise<VerificationRow | null> {
  const since = new Date(Date.now() - withinMs);
  const res = await db.query(
    `SELECT * FROM verifications
     WHERE tg_user_id = $1 AND group_id = $2 AND state = 'ADMITTED'
       AND updated_at > $3
     ORDER BY updated_at DESC LIMIT 1`,
    [tgUserId.toString(), groupId, since],
  );
  if (!res.rows[0]) return null;
  return mapRow(res.rows[0]);
}
