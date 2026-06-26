import { db } from "@/db.js";
import { config } from "@/config/index.js";
import { getVerificationByToken } from "@/adapters/verification.adapter.js";
import { logger } from "@/utils/logger.js";

export interface AccrualResult {
  advertiserId: number;
  groupId: number;
  totalMicro: bigint;
  exhausted: boolean;
  advertiserTgId: bigint | null;
}

/**
 * On verification pass: accrue payout in DB, decrement remaining_budget atomically.
 */
export async function accrueVerificationPayout(verificationId: string): Promise<AccrualResult | null> {
  const verification = await getVerificationByToken(verificationId);
  if (!verification?.advertiserId || verification.lockedBidPrice == null) return null;

  const total = verification.lockedBidPrice;
  const advertiserId = verification.advertiserId;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const camp = await client.query<{
      group_id: number;
      remaining_budget: string;
      advertiser_tg_id: string | null;
      campaign_status: string;
    }>(
      `SELECT group_id, remaining_budget, advertiser_tg_id, campaign_status
       FROM advertiser_budgets WHERE advertiser_id = $1 FOR UPDATE`,
      [advertiserId],
    );
    const row = camp.rows[0];
    if (!row || row.campaign_status !== "active") {
      await client.query("ROLLBACK");
      return null;
    }

    const remaining = BigInt(row.remaining_budget);
    if (remaining < total) {
      logger.warn(
        { verificationId, advertiserId, remaining: remaining.toString(), total: total.toString() },
        "Insufficient remaining_budget for accrual",
      );
      await client.query("ROLLBACK");
      return null;
    }

    const newRemaining = remaining - total;
    const exhausted = newRemaining === 0n;
    const newStatus = exhausted ? "exhausted" : "active";

    await client.query(
      `UPDATE advertiser_budgets
       SET remaining_budget = $2, campaign_status = $3, updated_at = NOW()
       WHERE advertiser_id = $1`,
      [advertiserId, newRemaining.toString(), newStatus],
    );

    await client.query(
      `UPDATE verifications SET payout_status = 'pending', updated_at = NOW() WHERE verification_id = $1`,
      [verificationId],
    );

    await client.query("COMMIT");

    return {
      advertiserId,
      groupId: row.group_id,
      totalMicro: total,
      exhausted,
      advertiserTgId: row.advertiser_tg_id ? BigInt(row.advertiser_tg_id) : null,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export function computeOwnerShare(totalMicro: bigint): { ownerMicro: bigint; feeMicro: bigint } {
  const { companyWallet, platformFeeBps } = config.payments;
  if (!companyWallet) {
    return { ownerMicro: totalMicro, feeMicro: 0n };
  }
  const feeMicro = (totalMicro * BigInt(platformFeeBps)) / 10000n;
  return { ownerMicro: totalMicro - feeMicro, feeMicro };
}
