import { db } from "@/db.js";
import { config } from "@/config/index.js";
import { releaseEscrowPayout, readCampaignBalance } from "@/services/escrow.js";
import { formatUsdMicro } from "@/utils/usdc.js";
import { logger } from "@/utils/logger.js";

const PAYOUT_LOCK_KEY = 83927401;

interface OwnerLeg {
  recipient: string;
  amountMicro: bigint;
  verificationIds: string[];
}

/**
 * Per-campaign payout plan. The owner leg(s) and the platform-fee leg are tracked
 * separately: owner outcomes write payout_status/payout_tx_hash, fee outcomes write
 * fee_status/fee_tx_hash. A verification appears in exactly one owner leg and (when a
 * fee applies) the campaign's fee leg — the two legs can no longer clobber each
 * other's status.
 */
interface CampaignPayout {
  advertiserId: number;
  ownerLegs: Map<string, OwnerLeg>;
  feeMicro: bigint;
  feeVerificationIds: string[];
}

export async function runPayoutBatch(): Promise<{ txCount: number; totalMicro: bigint }> {
  const client = await db.connect();
  let locked = false;
  try {
    const lock = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS locked`,
      [PAYOUT_LOCK_KEY],
    );
    if (!lock.rows[0]?.locked) {
      logger.info("Payout batch skipped — another instance holds lock");
      return { txCount: 0, totalMicro: 0n };
    }
    locked = true;

    const feeBps = config.payments.platformFeeBps;
    const companyWallet = config.payments.companyWallet?.toLowerCase() ?? null;

    const pending = await client.query<{
      verification_id: string;
      advertiser_id: number;
      locked_bid_price: string;
      owner_wallet: string;
    }>(
      // PASSED is now followed by a rules-agreement gate (RULES_PENDING/ADMITTED/RULES_TIMED_OUT) —
      // billing already settled at PASSED, independent of whether the user later agreed, so
      // treat any post-pass state as payable.
      `SELECT v.verification_id, v.advertiser_id, v.locked_bid_price, g.owner_wallet
       FROM verifications v
       JOIN groups g ON g.group_id = v.group_id
       WHERE v.payout_status = 'pending'
         AND v.state IN ('PASSED', 'RULES_PENDING', 'ADMITTED', 'RULES_TIMED_OUT')
         AND v.advertiser_id IS NOT NULL AND v.locked_bid_price IS NOT NULL
       FOR UPDATE SKIP LOCKED`,
    );

    if (pending.rows.length === 0) {
      return { txCount: 0, totalMicro: 0n };
    }

    const campaigns = new Map<number, CampaignPayout>();

    for (const row of pending.rows) {
      const total = BigInt(row.locked_bid_price);
      const ownerMicro = companyWallet
        ? total - (total * BigInt(feeBps)) / 10000n
        : total;
      const feeMicro = total - ownerMicro;

      const campaign = campaigns.get(row.advertiser_id) ?? {
        advertiserId: row.advertiser_id,
        ownerLegs: new Map<string, OwnerLeg>(),
        feeMicro: 0n,
        feeVerificationIds: [],
      };

      const ownerKey = row.owner_wallet.toLowerCase();
      const leg = campaign.ownerLegs.get(ownerKey) ?? {
        recipient: row.owner_wallet,
        amountMicro: 0n,
        verificationIds: [],
      };
      leg.amountMicro += ownerMicro;
      leg.verificationIds.push(row.verification_id);
      campaign.ownerLegs.set(ownerKey, leg);

      if (companyWallet && feeMicro > 0n) {
        campaign.feeMicro += feeMicro;
        campaign.feeVerificationIds.push(row.verification_id);
      }

      campaigns.set(row.advertiser_id, campaign);
    }

    const batchIdRes = await client.query<{ batch_id: string }>(
      `INSERT INTO payout_batches (total_micro, tx_count, status)
       VALUES (0, 0, 'running') RETURNING batch_id`,
    );
    const batchId = batchIdRes.rows[0]!.batch_id;

    let txCount = 0;
    let totalMicro = 0n;
    const allVerificationIds = new Set<string>();

    for (const campaign of campaigns.values()) {
      const ownerTotal = [...campaign.ownerLegs.values()].reduce(
        (sum, leg) => sum + leg.amountMicro,
        0n,
      );
      const combined = ownerTotal + campaign.feeMicro;
      if (combined <= 0n) continue;

      // Balance check covers owner + fee combined — never fund one leg by starving the other.
      const onChain = await readCampaignBalance(campaign.advertiserId);
      if (onChain < combined) {
        logger.error(
          {
            advertiserId: campaign.advertiserId,
            onChain: onChain.toString(),
            need: combined.toString(),
          },
          "Insufficient on-chain campaign balance for payout batch (owner + fee)",
        );
        const campaignVerificationIds = [
          ...new Set([...campaign.ownerLegs.values()].flatMap((leg) => leg.verificationIds)),
        ];
        await client.query(
          `UPDATE verifications SET payout_status = 'failed', updated_at = NOW()
           WHERE verification_id = ANY($1::uuid[]) AND payout_status = 'pending'`,
          [campaignVerificationIds],
        );
        if (campaign.feeVerificationIds.length > 0) {
          await client.query(
            `UPDATE verifications SET fee_status = 'failed', updated_at = NOW()
             WHERE verification_id = ANY($1::uuid[])`,
            [campaign.feeVerificationIds],
          );
        }
        continue;
      }

      // Owner legs — write payout_status / payout_tx_hash only.
      for (const leg of campaign.ownerLegs.values()) {
        if (leg.amountMicro <= 0n) continue;

        await client.query(
          `UPDATE verifications SET payout_status = 'processing', updated_at = NOW()
           WHERE verification_id = ANY($1::uuid[]) AND payout_status = 'pending'`,
          [leg.verificationIds],
        );

        const txHash = await releaseEscrowPayout(campaign.advertiserId, leg.recipient, leg.amountMicro);
        if (!txHash) {
          await client.query(
            `UPDATE verifications SET payout_status = 'failed', updated_at = NOW()
             WHERE verification_id = ANY($1::uuid[]) AND payout_status = 'processing'`,
            [leg.verificationIds],
          );
          continue;
        }

        await client.query(
          `UPDATE verifications
           SET payout_status = 'paid', payout_tx_hash = $2, payout_batch_id = $3, updated_at = NOW()
           WHERE verification_id = ANY($1::uuid[]) AND payout_status = 'processing'`,
          [leg.verificationIds, txHash, batchId],
        );

        txCount += 1;
        totalMicro += leg.amountMicro;
        for (const id of leg.verificationIds) allVerificationIds.add(id);
      }

      // Fee leg — write fee_status / fee_tx_hash only, regardless of owner-leg outcomes.
      if (companyWallet && campaign.feeMicro > 0n) {
        const feeTxHash = await releaseEscrowPayout(
          campaign.advertiserId,
          companyWallet,
          campaign.feeMicro,
        );
        await client.query(
          `UPDATE verifications SET fee_status = $2, fee_tx_hash = $3, updated_at = NOW()
           WHERE verification_id = ANY($1::uuid[])`,
          [campaign.feeVerificationIds, feeTxHash ? "paid" : "failed", feeTxHash],
        );
        if (feeTxHash) {
          txCount += 1;
          totalMicro += campaign.feeMicro;
          for (const id of campaign.feeVerificationIds) allVerificationIds.add(id);
        }
      }
    }

    await client.query(
      `UPDATE payout_batches SET total_micro = $2, tx_count = $3, status = 'completed' WHERE batch_id = $1`,
      [batchId, totalMicro.toString(), txCount],
    );

    logger.info(
      { batchId, txCount, totalMicro: totalMicro.toString(), verifications: allVerificationIds.size },
      "Payout batch completed",
    );

    return { txCount, totalMicro };
  } finally {
    if (locked) {
      await client.query(`SELECT pg_advisory_unlock($1)`, [PAYOUT_LOCK_KEY]);
    }
    client.release();
  }
}

let batchTimer: ReturnType<typeof setInterval> | null = null;

export function startPayoutBatchScheduler(): void {
  if (batchTimer) return;
  const intervalMs = config.payments.payoutBatchIntervalMs;
  if (intervalMs <= 0) {
    logger.info("Payout batch scheduler disabled (PAYOUT_BATCH_INTERVAL_MS <= 0)");
    return;
  }

  batchTimer = setInterval(() => {
    runPayoutBatch().catch((err) => logger.error({ err }, "Payout batch failed"));
  }, intervalMs);

  logger.info({ intervalMs }, "Payout batch scheduler started");
}
