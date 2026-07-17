import { db } from "@/db.js";
import { BID_LOCK_STATES } from "@/services/verification-states.js";

export interface TopBid {
  advertiserId: number;
  groupId: number;
  bidPerVerification: bigint;
  remainingBudget: bigint;
  taskText: string | null;
  /** Enriched task-design brief ({openingPrompt, goal, targetSignal, thinResponseExamples}) for the captcha agent. */
  taskTemplate: unknown | null;
  advertiserTgId: bigint | null;
  templateId: number | null;
}

export interface PendingCampaign {
  advertiserId: number;
  groupId: number;
  bidPerVerification: bigint;
  expectedDepositMicro: bigint;
  remainingBudget: bigint;
  taskText: string | null;
  advertiserTgId: bigint | null;
  campaignStatus: string;
}

/** First-price auction: highest active bid with remaining budget wins. */
export async function getTopBidForGroup(groupId: number): Promise<TopBid | null> {
  const res = await db.query<TopBid & Record<string, unknown>>(
    `SELECT advertiser_id AS "advertiserId",
            group_id AS "groupId",
            bid_per_verification AS "bidPerVerification",
            remaining_budget AS "remainingBudget",
            task_text AS "taskText",
            task_template AS "taskTemplate",
            advertiser_tg_id AS "advertiserTgId",
            template_id AS "templateId"
     FROM advertiser_budgets
     WHERE group_id = $1
       AND campaign_status = 'active'
       AND remaining_budget > 0
     ORDER BY bid_per_verification DESC, updated_at DESC
     LIMIT 1`,
    [groupId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    advertiserId: row.advertiserId,
    groupId: row.groupId,
    bidPerVerification: BigInt(row.bidPerVerification as string | bigint),
    remainingBudget: BigInt(row.remainingBudget as string | bigint),
    taskText: row.taskText as string | null,
    taskTemplate: row.taskTemplate ?? null,
    advertiserTgId: row.advertiserTgId != null ? BigInt(row.advertiserTgId as string | bigint) : null,
    templateId: row.templateId != null ? Number(row.templateId) : null,
  };
}

export async function getPendingCampaignById(advertiserId: number): Promise<PendingCampaign | null> {
  const res = await db.query<{
    advertiser_id: number;
    group_id: number;
    bid_per_verification: string;
    expected_deposit_micro: string | null;
    remaining_budget: string;
    task_text: string | null;
    advertiser_tg_id: string | null;
    campaign_status: string;
  }>(`SELECT * FROM advertiser_budgets WHERE advertiser_id = $1`, [advertiserId]);

  const row = res.rows[0];
  if (!row) return null;
  return {
    advertiserId: row.advertiser_id,
    groupId: row.group_id,
    bidPerVerification: BigInt(row.bid_per_verification),
    expectedDepositMicro: BigInt(row.expected_deposit_micro ?? "0"),
    remainingBudget: BigInt(row.remaining_budget),
    taskText: row.task_text,
    advertiserTgId: row.advertiser_tg_id ? BigInt(row.advertiser_tg_id) : null,
    campaignStatus: row.campaign_status,
  };
}

export async function placeBid(input: {
  groupId: number;
  advertiserTgId: bigint;
  bidMicroUnits: bigint;
  quantity: number;
  taskText?: string;
  taskTemplate?: unknown;
  templateId?: number;
}): Promise<{ advertiserId: number; expectedDepositMicro: bigint }> {
  const totalBudget = input.bidMicroUnits * BigInt(input.quantity);
  const insert = await db.query<{ advertiser_id: number }>(
    `INSERT INTO advertiser_budgets
       (group_id, bid_per_verification, remaining_budget, task_text, task_template,
        advertiser_tg_id, template_id, campaign_status, expected_deposit_micro)
     VALUES ($1, $2, 0, $3, $4, $5, $6, 'pending_deposit', $7)
     RETURNING advertiser_id`,
    [
      input.groupId,
      input.bidMicroUnits.toString(),
      input.taskText ?? null,
      input.taskTemplate != null ? JSON.stringify(input.taskTemplate) : null,
      input.advertiserTgId.toString(),
      input.templateId ?? null,
      totalBudget.toString(),
    ],
  );
  const advertiserId = insert.rows[0]!.advertiser_id;

  await db.query(
    `INSERT INTO bid_log (advertiser_id, group_id, bid_amount) VALUES ($1, $2, $3)`,
    [advertiserId, input.groupId, input.bidMicroUnits.toString()],
  );

  return { advertiserId, expectedDepositMicro: totalBudget };
}

export async function confirmCampaignDeposit(
  advertiserId: number,
  txHash: string,
  depositedAmount: bigint,
): Promise<{ confirmed: boolean; displacedAdvertiserTgId: bigint | null }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const pending = await client.query<{
      group_id: number;
      bid_per_verification: string;
      expected_deposit_micro: string;
      advertiser_tg_id: string | null;
      campaign_status: string;
    }>(`SELECT * FROM advertiser_budgets WHERE advertiser_id = $1 FOR UPDATE`, [advertiserId]);

    const row = pending.rows[0];
    if (!row || row.campaign_status !== "pending_deposit") {
      await client.query("ROLLBACK");
      return { confirmed: false, displacedAdvertiserTgId: null };
    }

    const expected = BigInt(row.expected_deposit_micro);
    if (depositedAmount < expected) {
      await client.query("ROLLBACK");
      return { confirmed: false, displacedAdvertiserTgId: null };
    }

    // Funded campaigns now enter 'pending_approval' — the group owner accepts or
    // declines before the campaign can serve tasks (auto-accept after 48h). The
    // outbid/displacement notification moved to approveCampaign: a pending campaign
    // hasn't outbid anyone yet.
    await client.query(
      `UPDATE advertiser_budgets
       SET campaign_status = 'pending_approval',
           approval_requested_at = NOW(),
           remaining_budget = $2,
           deposit_tx_hash = $3,
           deposit_confirmed_at = NOW(),
           updated_at = NOW()
       WHERE advertiser_id = $1`,
      [advertiserId, depositedAmount.toString(), txHash],
    );

    await client.query("COMMIT");
    return { confirmed: true, displacedAdvertiserTgId: null };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface CampaignApprovalInfo {
  advertiserId: number;
  groupId: number;
  ownerTgId: bigint | null;
  groupTitle: string | null;
  advertiserTgId: bigint | null;
  bidPerVerification: bigint;
  remainingBudget: bigint;
  taskText: string | null;
  campaignStatus: string;
}

export async function getCampaignApprovalInfo(
  advertiserId: number,
): Promise<CampaignApprovalInfo | null> {
  const res = await db.query<{
    advertiser_id: number;
    group_id: number;
    owner_tg_id: string | null;
    group_title: string | null;
    advertiser_tg_id: string | null;
    bid_per_verification: string;
    remaining_budget: string;
    task_text: string | null;
    campaign_status: string;
  }>(
    `SELECT ab.advertiser_id, ab.group_id, g.owner_tg_id::TEXT AS owner_tg_id,
            g.group_title, ab.advertiser_tg_id::TEXT AS advertiser_tg_id,
            ab.bid_per_verification, ab.remaining_budget, ab.task_text, ab.campaign_status
     FROM advertiser_budgets ab
     JOIN groups g ON g.group_id = ab.group_id
     WHERE ab.advertiser_id = $1`,
    [advertiserId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    advertiserId: row.advertiser_id,
    groupId: row.group_id,
    ownerTgId: row.owner_tg_id ? BigInt(row.owner_tg_id) : null,
    groupTitle: row.group_title,
    advertiserTgId: row.advertiser_tg_id ? BigInt(row.advertiser_tg_id) : null,
    bidPerVerification: BigInt(row.bid_per_verification),
    remainingBudget: BigInt(row.remaining_budget),
    taskText: row.task_text,
    campaignStatus: row.campaign_status,
  };
}

/**
 * Group owner accepted the campaign: pending_approval → active. Displacement (outbid
 * notification) is computed here, at activation, inside the same transaction.
 */
export async function approveCampaign(
  advertiserId: number,
): Promise<{ ok: boolean; displacedAdvertiserTgId: bigint | null }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<{ group_id: number; bid_per_verification: string }>(
      `SELECT group_id, bid_per_verification FROM advertiser_budgets
       WHERE advertiser_id = $1 AND campaign_status = 'pending_approval' FOR UPDATE`,
      [advertiserId],
    );
    const row = res.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, displacedAdvertiserTgId: null };
    }

    const previous = await client.query<{ advertiser_tg_id: string | null; bid_per_verification: string }>(
      `SELECT advertiser_tg_id, bid_per_verification FROM advertiser_budgets
       WHERE group_id = $1 AND campaign_status = 'active' AND advertiser_id != $2
       ORDER BY bid_per_verification DESC LIMIT 1`,
      [row.group_id, advertiserId],
    );
    const prevRow = previous.rows[0];
    const displaced =
      prevRow?.advertiser_tg_id && BigInt(row.bid_per_verification) > BigInt(prevRow.bid_per_verification)
        ? BigInt(prevRow.advertiser_tg_id)
        : null;

    await client.query(
      `UPDATE advertiser_budgets
       SET campaign_status = 'active', updated_at = NOW()
       WHERE advertiser_id = $1`,
      [advertiserId],
    );
    await client.query("COMMIT");
    return { ok: true, displacedAdvertiserTgId: displaced };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Group owner declined the campaign: pending_approval → declined, budget zeroed.
 * Returns the amount to refund on-chain (caller routes it via releasePayout to the
 * advertiser's DB wallet — never refundUnusedBudget, see escrow.ts).
 */
export async function declineCampaign(
  advertiserId: number,
): Promise<{ ok: boolean; refundMicro: bigint; advertiserTgId: bigint | null }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<{ remaining_budget: string; advertiser_tg_id: string | null }>(
      `SELECT remaining_budget, advertiser_tg_id::TEXT AS advertiser_tg_id FROM advertiser_budgets
       WHERE advertiser_id = $1 AND campaign_status = 'pending_approval' FOR UPDATE`,
      [advertiserId],
    );
    const row = res.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, refundMicro: 0n, advertiserTgId: null };
    }
    const refundMicro = BigInt(row.remaining_budget);
    await client.query(
      `UPDATE advertiser_budgets
       SET campaign_status = 'declined', remaining_budget = 0, updated_at = NOW()
       WHERE advertiser_id = $1`,
      [advertiserId],
    );
    await client.query("COMMIT");
    return {
      ok: true,
      refundMicro,
      advertiserTgId: row.advertiser_tg_id ? BigInt(row.advertiser_tg_id) : null,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Auto-accept campaigns the owner ignored for 48 hours (BUILD.md spec). Displacement
 * notifications are skipped on auto-accept — acceptable edge, the ladder re-sorts on
 * the next verification anyway.
 */
export async function autoAcceptStaleCampaigns(): Promise<
  { advertiserId: number; advertiserTgId: bigint | null; groupId: number }[]
> {
  const res = await db.query<{
    advertiser_id: number;
    advertiser_tg_id: string | null;
    group_id: number;
  }>(
    `UPDATE advertiser_budgets
     SET campaign_status = 'active', updated_at = NOW()
     WHERE campaign_status = 'pending_approval'
       AND approval_requested_at < NOW() - INTERVAL '48 hours'
     RETURNING advertiser_id, advertiser_tg_id::TEXT AS advertiser_tg_id, group_id`,
  );
  return res.rows.map((row) => ({
    advertiserId: row.advertiser_id,
    advertiserTgId: row.advertiser_tg_id ? BigInt(row.advertiser_tg_id) : null,
    groupId: row.group_id,
  }));
}

export async function expirePendingDeposits(ttlMs: number): Promise<
  { advertiserId: number; advertiserTgId: bigint | null }[]
> {
  const cutoff = new Date(Date.now() - ttlMs);
  const res = await db.query<{ advertiser_id: number; advertiser_tg_id: string | null }>(
    `UPDATE advertiser_budgets
     SET campaign_status = 'expired', updated_at = NOW()
     WHERE campaign_status = 'pending_deposit'
       AND created_at < $1
     RETURNING advertiser_id, advertiser_tg_id`,
    [cutoff],
  );

  return res.rows.map((r) => ({
    advertiserId: r.advertiser_id,
    advertiserTgId: r.advertiser_tg_id ? BigInt(r.advertiser_tg_id) : null,
  }));
}

export async function markCampaignExhausted(advertiserId: number): Promise<void> {
  await db.query(
    `UPDATE advertiser_budgets SET campaign_status = 'exhausted', updated_at = NOW()
     WHERE advertiser_id = $1 AND remaining_budget = 0`,
    [advertiserId],
  );
}

export interface AdvertiserCampaignRow {
  advertiserId: number;
  groupId: number;
  groupTitle: string | null;
  bidPerVerification: bigint;
  remainingBudget: bigint;
  campaignStatus: string;
}

export async function listCampaignsForAdvertiser(advertiserTgId: bigint): Promise<AdvertiserCampaignRow[]> {
  const res = await db.query<{
    advertiser_id: number;
    group_id: number;
    group_title: string | null;
    bid_per_verification: string;
    remaining_budget: string;
    campaign_status: string;
  }>(
    `SELECT ab.advertiser_id, ab.group_id, g.group_title, ab.bid_per_verification,
            ab.remaining_budget, ab.campaign_status
     FROM advertiser_budgets ab
     JOIN groups g ON g.group_id = ab.group_id
     WHERE ab.advertiser_tg_id = $1
       AND ab.campaign_status IN ('active', 'paused', 'pending_deposit', 'pending_approval', 'exhausted', 'declined')
     ORDER BY ab.updated_at DESC`,
    [advertiserTgId.toString()],
  );

  return res.rows.map((r) => ({
    advertiserId: r.advertiser_id,
    groupId: r.group_id,
    groupTitle: r.group_title,
    bidPerVerification: BigInt(r.bid_per_verification),
    remainingBudget: BigInt(r.remaining_budget),
    campaignStatus: r.campaign_status,
  }));
}

export async function pauseCampaign(advertiserId: number, advertiserTgId: bigint): Promise<boolean> {
  const res = await db.query<{ group_id: number }>(
    `UPDATE advertiser_budgets
     SET campaign_status = 'paused', paused_at = NOW(), updated_at = NOW()
     WHERE advertiser_id = $1 AND advertiser_tg_id = $2 AND campaign_status = 'active'
     RETURNING group_id`,
    [advertiserId, advertiserTgId.toString()],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function resumeCampaign(advertiserId: number, advertiserTgId: bigint): Promise<boolean> {
  const res = await db.query<{ group_id: number }>(
    `UPDATE advertiser_budgets
     SET campaign_status = 'active', paused_at = NULL, updated_at = NOW()
     WHERE advertiser_id = $1 AND advertiser_tg_id = $2 AND campaign_status = 'paused'
       AND remaining_budget > 0
     RETURNING group_id`,
    [advertiserId, advertiserTgId.toString()],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function withdrawCampaign(
  advertiserId: number,
  advertiserTgId: bigint,
): Promise<{ ok: boolean; refundMicro: bigint; groupId: number | null; inFlight?: number }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<{
      group_id: number;
      remaining_budget: string;
      campaign_status: string;
    }>(
      `SELECT group_id, remaining_budget, campaign_status FROM advertiser_budgets
       WHERE advertiser_id = $1 AND advertiser_tg_id = $2 FOR UPDATE`,
      [advertiserId, advertiserTgId.toString()],
    );
    const row = res.rows[0];
    // pending_approval included: advertisers can cancel while awaiting owner approval.
    if (!row || !["active", "paused", "pending_approval"].includes(row.campaign_status)) {
      await client.query("ROLLBACK");
      return { ok: false, refundMicro: 0n, groupId: null };
    }

    // Block while verifications are mid-flight at a locked bid against this campaign:
    // draining escrow now would strand the group owner's payout when the user passes
    // moments later (batch would find insufficient balance). Locked states are short-
    // lived (5-min task TTL), so "try again in a few minutes" is accurate.
    const inFlight = await client.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM verifications
       WHERE advertiser_id = $1
         AND state = ANY($2::text[])`,
      [advertiserId, BID_LOCK_STATES],
    );
    const inFlightCount = Number(inFlight.rows[0]?.n ?? 0);
    if (inFlightCount > 0) {
      await client.query("ROLLBACK");
      return { ok: false, refundMicro: 0n, groupId: row.group_id, inFlight: inFlightCount };
    }

    const refundMicro = BigInt(row.remaining_budget);
    await client.query(
      `UPDATE advertiser_budgets
       SET campaign_status = 'withdrawn', remaining_budget = 0,
           withdrawn_at = NOW(), updated_at = NOW()
       WHERE advertiser_id = $1`,
      [advertiserId],
    );
    await client.query("COMMIT");
    return { ok: true, refundMicro, groupId: row.group_id };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface PendingTopUp {
  topupId: number;
  advertiserId: number;
  verifications: number;
  amountMicro: bigint;
  status: string;
}

export async function listTopUpEligibleCampaigns(
  advertiserTgId: bigint,
): Promise<AdvertiserCampaignRow[]> {
  const rows = await listCampaignsForAdvertiser(advertiserTgId);
  return rows.filter((c) => ["active", "paused", "exhausted"].includes(c.campaignStatus));
}

export async function getCampaignOwnedByAdvertiser(
  advertiserId: number,
  advertiserTgId: bigint,
): Promise<AdvertiserCampaignRow | null> {
  const rows = await listCampaignsForAdvertiser(advertiserTgId);
  return rows.find((c) => c.advertiserId === advertiserId) ?? null;
}

export async function createPendingTopUp(input: {
  advertiserId: number;
  advertiserTgId: bigint;
  verifications: number;
}): Promise<{ topupId: number; amountMicro: bigint } | null> {
  const campaign = await getCampaignOwnedByAdvertiser(input.advertiserId, input.advertiserTgId);
  if (!campaign || !["active", "paused", "exhausted"].includes(campaign.campaignStatus)) {
    return null;
  }

  const amountMicro = campaign.bidPerVerification * BigInt(input.verifications);
  const res = await db.query<{ topup_id: number }>(
    `INSERT INTO campaign_topups (advertiser_id, verifications, amount_micro, status)
     VALUES ($1, $2, $3, 'pending')
     RETURNING topup_id`,
    [input.advertiserId, input.verifications, amountMicro.toString()],
  );
  return { topupId: res.rows[0]!.topup_id, amountMicro };
}

export async function getPendingTopUpById(topupId: number): Promise<PendingTopUp | null> {
  const res = await db.query<{
    topup_id: number;
    advertiser_id: number;
    verifications: number;
    amount_micro: string;
    status: string;
  }>(`SELECT * FROM campaign_topups WHERE topup_id = $1`, [topupId]);

  const row = res.rows[0];
  if (!row) return null;
  return {
    topupId: row.topup_id,
    advertiserId: row.advertiser_id,
    verifications: row.verifications,
    amountMicro: BigInt(row.amount_micro),
    status: row.status,
  };
}

export async function findPendingTopUpForDeposit(
  advertiserId: number,
  amountMicro: bigint,
): Promise<PendingTopUp | null> {
  const res = await db.query<{
    topup_id: number;
    advertiser_id: number;
    verifications: number;
    amount_micro: string;
    status: string;
  }>(
    `SELECT * FROM campaign_topups
     WHERE advertiser_id = $1 AND amount_micro = $2 AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
    [advertiserId, amountMicro.toString()],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    topupId: row.topup_id,
    advertiserId: row.advertiser_id,
    verifications: row.verifications,
    amountMicro: BigInt(row.amount_micro),
    status: row.status,
  };
}

export async function confirmTopUpDeposit(
  topupId: number,
  txHash: string,
  depositedAmount: bigint,
): Promise<{ confirmed: boolean; advertiserTgId: bigint | null }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const topupRes = await client.query<{
      advertiser_id: number;
      amount_micro: string;
      status: string;
    }>(`SELECT advertiser_id, amount_micro, status FROM campaign_topups WHERE topup_id = $1 FOR UPDATE`, [
      topupId,
    ]);
    const topup = topupRes.rows[0];
    if (!topup || topup.status !== "pending") {
      await client.query("ROLLBACK");
      return { confirmed: false, advertiserTgId: null };
    }

    const expected = BigInt(topup.amount_micro);
    if (depositedAmount < expected) {
      await client.query("ROLLBACK");
      return { confirmed: false, advertiserTgId: null };
    }

    const campaignRes = await client.query<{
      remaining_budget: string;
      campaign_status: string;
      advertiser_tg_id: string | null;
    }>(`SELECT remaining_budget, campaign_status, advertiser_tg_id FROM advertiser_budgets WHERE advertiser_id = $1 FOR UPDATE`, [
      topup.advertiser_id,
    ]);
    const campaign = campaignRes.rows[0];
    if (!campaign || !["active", "paused", "exhausted"].includes(campaign.campaign_status)) {
      await client.query("ROLLBACK");
      return { confirmed: false, advertiserTgId: null };
    }

    const newBudget = BigInt(campaign.remaining_budget) + depositedAmount;
    const newStatus =
      campaign.campaign_status === "paused"
        ? "paused"
        : newBudget > 0n
          ? "active"
          : campaign.campaign_status;

    await client.query(
      `UPDATE advertiser_budgets
       SET remaining_budget = $2,
           campaign_status = $3,
           updated_at = NOW()
       WHERE advertiser_id = $1`,
      [topup.advertiser_id, newBudget.toString(), newStatus],
    );

    await client.query(
      `UPDATE campaign_topups SET status = 'confirmed', credit_tx_hash = $2 WHERE topup_id = $1`,
      [topupId, txHash],
    );

    await client.query("COMMIT");
    return {
      confirmed: true,
      advertiserTgId: campaign.advertiser_tg_id ? BigInt(campaign.advertiser_tg_id) : null,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function expirePendingTopUps(ttlMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - ttlMs);
  const res = await db.query(
    `UPDATE campaign_topups SET status = 'expired'
     WHERE status = 'pending' AND created_at < $1`,
    [cutoff],
  );
  return res.rowCount ?? 0;
}
