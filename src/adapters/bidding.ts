import { db } from "@/db.js";

export interface TopBid {
  advertiserId: number;
  groupId: number;
  bidPerVerification: bigint;
  remainingBudget: bigint;
  taskText: string | null;
  advertiserTgId: bigint | null;
}

/** First-price auction: highest active bid with remaining budget wins. */
export async function getTopBidForGroup(groupId: number): Promise<TopBid | null> {
  const res = await db.query<TopBid & Record<string, unknown>>(
    `SELECT advertiser_id AS "advertiserId",
            group_id AS "groupId",
            bid_per_verification AS "bidPerVerification",
            remaining_budget AS "remainingBudget",
            task_text AS "taskText",
            advertiser_tg_id AS "advertiserTgId"
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
  };
}

export async function placeBid(input: {
  groupId: number;
  advertiserTgId: bigint;
  bidMicroUnits: bigint;
  quantity: number;
  taskText?: string;
}): Promise<{ advertiserId: number; displacedAdvertiserTgId: bigint | null }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const previous = await client.query<{ advertiser_tg_id: string | null }>(
      `SELECT advertiser_tg_id FROM advertiser_budgets
       WHERE group_id = $1 AND campaign_status = 'active'
       ORDER BY bid_per_verification DESC LIMIT 1`,
      [input.groupId],
    );
    const displacedTgId = previous.rows[0]?.advertiser_tg_id
      ? BigInt(previous.rows[0].advertiser_tg_id)
      : null;

    const totalBudget = input.bidMicroUnits * BigInt(input.quantity);
    const insert = await client.query<{ advertiser_id: number }>(
      `INSERT INTO advertiser_budgets
         (group_id, bid_per_verification, remaining_budget, task_text, advertiser_tg_id, campaign_status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING advertiser_id`,
      [
        input.groupId,
        input.bidMicroUnits.toString(),
        totalBudget.toString(),
        input.taskText ?? null,
        input.advertiserTgId.toString(),
      ],
    );
    const advertiserId = insert.rows[0]!.advertiser_id;

    await client.query(
      `INSERT INTO bid_log (advertiser_id, group_id, bid_amount) VALUES ($1, $2, $3)`,
      [advertiserId, input.groupId, input.bidMicroUnits.toString()],
    );

    // Demote previous top bidder (last-write-wins at POC scale)
    if (displacedTgId && displacedTgId !== input.advertiserTgId) {
      await client.query(
        `UPDATE advertiser_budgets SET campaign_status = 'paused', outbid_notified = false
         WHERE group_id = $1 AND advertiser_tg_id = $2 AND advertiser_id != $3`,
        [input.groupId, displacedTgId.toString(), advertiserId],
      );
    }

    await client.query("COMMIT");
    return { advertiserId, displacedAdvertiserTgId: displacedTgId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
