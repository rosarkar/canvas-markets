import { db } from "@/db.js";

export interface TopBid {
  advertiserId: number;
  groupId: number;
  bidPerVerification: bigint;
  remainingBudget: bigint;
  taskText: string | null;
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
  templateId?: number;
}): Promise<{ advertiserId: number; expectedDepositMicro: bigint }> {
  const totalBudget = input.bidMicroUnits * BigInt(input.quantity);
  const insert = await db.query<{ advertiser_id: number }>(
    `INSERT INTO advertiser_budgets
       (group_id, bid_per_verification, remaining_budget, task_text, advertiser_tg_id,
        template_id, campaign_status, expected_deposit_micro)
     VALUES ($1, $2, 0, $3, $4, $5, 'pending_deposit', $6)
     RETURNING advertiser_id`,
    [
      input.groupId,
      input.bidMicroUnits.toString(),
      input.taskText ?? null,
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

    const previous = await client.query<{ advertiser_tg_id: string | null; bid_per_verification: string }>(
      `SELECT advertiser_tg_id, bid_per_verification FROM advertiser_budgets
       WHERE group_id = $1 AND campaign_status = 'active' AND advertiser_id != $2
       ORDER BY bid_per_verification DESC LIMIT 1`,
      [row.group_id, advertiserId],
    );
    const prevRow = previous.rows[0];
    const newBid = BigInt(row.bid_per_verification);
    let displacedTgId: bigint | null = null;

    if (prevRow?.advertiser_tg_id && newBid > BigInt(prevRow.bid_per_verification)) {
      displacedTgId = BigInt(prevRow.advertiser_tg_id);
    }

    await client.query(
      `UPDATE advertiser_budgets
       SET campaign_status = 'active',
           remaining_budget = $2,
           deposit_tx_hash = $3,
           deposit_confirmed_at = NOW(),
           updated_at = NOW()
       WHERE advertiser_id = $1`,
      [advertiserId, depositedAmount.toString(), txHash],
    );

    await client.query("COMMIT");
    return { confirmed: true, displacedAdvertiserTgId: displacedTgId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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
       AND ab.campaign_status IN ('active', 'paused', 'pending_deposit', 'exhausted')
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
): Promise<{ ok: boolean; refundMicro: bigint; groupId: number | null }> {
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
    if (!row || !["active", "paused"].includes(row.campaign_status)) {
      await client.query("ROLLBACK");
      return { ok: false, refundMicro: 0n, groupId: null };
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
