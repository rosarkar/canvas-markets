import { db } from "@/db.js";
import { config } from "@/config/index.js";
import { releaseEscrowPayout, readCampaignBalance } from "@/services/escrow.js";
import { formatUsdMicro } from "@/utils/usdc.js";
import { logger } from "@/utils/logger.js";

const PAYOUT_LOCK_KEY = 83927401;

interface PayoutAggregate {
  advertiserId: number;
  recipient: string;
  amountMicro: bigint;
  verificationIds: string[];
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

    const aggMap = new Map<string, PayoutAggregate>();

    for (const row of pending.rows) {
      const total = BigInt(row.locked_bid_price);
      const ownerMicro = companyWallet
        ? total - (total * BigInt(feeBps)) / 10000n
        : total;
      const feeMicro = total - ownerMicro;

      const ownerKey = `${row.advertiser_id}:${row.owner_wallet.toLowerCase()}`;
      const ownerAgg = aggMap.get(ownerKey) ?? {
        advertiserId: row.advertiser_id,
        recipient: row.owner_wallet,
        amountMicro: 0n,
        verificationIds: [],
      };
      ownerAgg.amountMicro += ownerMicro;
      ownerAgg.verificationIds.push(row.verification_id);
      aggMap.set(ownerKey, ownerAgg);

      if (companyWallet && feeMicro > 0n) {
        const feeKey = `${row.advertiser_id}:${companyWallet}`;
        const feeAgg = aggMap.get(feeKey) ?? {
          advertiserId: row.advertiser_id,
          recipient: companyWallet,
          amountMicro: 0n,
          verificationIds: [],
        };
        feeAgg.amountMicro += feeMicro;
        feeAgg.verificationIds.push(row.verification_id);
        aggMap.set(feeKey, feeAgg);
      }
    }

    const batchIdRes = await client.query<{ batch_id: string }>(
      `INSERT INTO payout_batches (total_micro, tx_count, status)
       VALUES (0, 0, 'running') RETURNING batch_id`,
    );
    const batchId = batchIdRes.rows[0]!.batch_id;

    let txCount = 0;
    let totalMicro = 0n;
    const allVerificationIds = new Set<string>();

    for (const agg of aggMap.values()) {
      if (agg.amountMicro <= 0n) continue;

      const onChain = await readCampaignBalance(agg.advertiserId);
      if (onChain < agg.amountMicro) {
        logger.error(
          { advertiserId: agg.advertiserId, onChain: onChain.toString(), need: agg.amountMicro.toString() },
          "Insufficient on-chain campaign balance for payout batch",
        );
        await client.query(
          `UPDATE verifications SET payout_status = 'failed', updated_at = NOW()
           WHERE verification_id = ANY($1::uuid[])`,
          [agg.verificationIds],
        );
        continue;
      }

      await client.query(
        `UPDATE verifications SET payout_status = 'processing', updated_at = NOW()
         WHERE verification_id = ANY($1::uuid[]) AND payout_status = 'pending'`,
        [agg.verificationIds],
      );

      const txHash = await releaseEscrowPayout(agg.advertiserId, agg.recipient, agg.amountMicro);
      if (!txHash) {
        await client.query(
          `UPDATE verifications SET payout_status = 'failed', updated_at = NOW()
           WHERE verification_id = ANY($1::uuid[])`,
          [agg.verificationIds],
        );
        continue;
      }

      await client.query(
        `UPDATE verifications
         SET payout_status = 'paid', payout_tx_hash = $2, payout_batch_id = $3, updated_at = NOW()
         WHERE verification_id = ANY($1::uuid[])`,
        [agg.verificationIds, txHash, batchId],
      );

      txCount += 1;
      totalMicro += agg.amountMicro;
      for (const id of agg.verificationIds) allVerificationIds.add(id);
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
