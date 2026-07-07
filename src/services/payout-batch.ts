import { db } from "@/db.js";
import { config } from "@/config/index.js";
import { previewIds, sendAdminAlert } from "@/services/admin-alerts.js";
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
  groupTitle: string;
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

    // Recovery for rows stuck in 'processing' >6h (crashed batch, missed final status
    // write). Two tiers:
    //  - payout_tx_hash IS NULL: releasePayout almost certainly never fired — reset to
    //    'pending' so this very run retries them. Caveat: a crash in the narrow window
    //    between tx broadcast and the status write also leaves a null hash; retrying
    //    such a row can double-pay that leg. Accepted per BUILD.md — the window is
    //    milliseconds wide and the alternative is stranding payouts forever.
    //  - payout_tx_hash IS NOT NULL: the transfer went out but the 'paid' write was
    //    missed. Money may have moved — never auto-retry; alert for manual review.
    const reset = await client.query<{ verification_id: string }>(
      `UPDATE verifications
       SET payout_status = 'pending', updated_at = NOW()
       WHERE payout_status = 'processing'
         AND payout_tx_hash IS NULL
         AND updated_at < NOW() - INTERVAL '6 hours'
       RETURNING verification_id`,
    );
    if (reset.rows.length > 0) {
      const ids = reset.rows.map((r) => r.verification_id);
      await sendAdminAlert(
        `Payout recovery: reset ${ids.length} stuck 'processing' row(s) (no tx hash, >6h old) ` +
          `back to 'pending' — retrying in this batch run. ${previewIds(ids)}`,
      );
    }

    const stuckWithHash = await client.query<{ verification_id: string }>(
      `SELECT verification_id FROM verifications
       WHERE payout_status = 'processing'
         AND payout_tx_hash IS NOT NULL
         AND updated_at < NOW() - INTERVAL '6 hours'`,
    );
    if (stuckWithHash.rows.length > 0) {
      const ids = stuckWithHash.rows.map((r) => r.verification_id);
      await sendAdminAlert(
        `${ids.length} payout row(s) stuck in 'processing' >6h WITH a tx hash — transfer likely ` +
          `fired but the paid write was missed. Needs manual review (verify tx on Basescan, then ` +
          `set payout_status manually): ${previewIds(ids)}`,
      );
    }

    const feeBps = config.payments.platformFeeBps;
    const companyWallet = config.payments.companyWallet?.toLowerCase() ?? null;

    // Explicit transaction so FOR UPDATE SKIP LOCKED actually holds: without BEGIN,
    // each statement autocommits and the row locks evaporate the moment the SELECT
    // returns. The transaction spans the SELECT plus the claim UPDATE that flips the
    // rows to 'processing', so a competing runner can neither lock nor re-select them.
    // It deliberately does NOT span the on-chain transfers below: if it did, a crash
    // mid-batch (e.g. a Railway deploy restart) would roll every row back to 'pending'
    // after the USDC had already moved, and the next batch would pay everyone twice.
    // Crashing after the claim instead strands rows in 'processing' — unpaid, never
    // double-paid — the safe direction (stuck-'processing' recovery is tracked in
    // BUILD.md).
    await client.query("BEGIN");
    let pending;
    try {
      pending = await client.query<{
        verification_id: string;
        advertiser_id: number;
        locked_bid_price: string;
        owner_wallet: string;
        group_title: string | null;
      }>(
        // PASSED is now followed by a rules-agreement gate (RULES_PENDING/ADMITTED/RULES_TIMED_OUT) —
        // billing already settled at PASSED, independent of whether the user later agreed, so
        // treat any post-pass state as payable.
        `SELECT v.verification_id, v.advertiser_id, v.locked_bid_price, g.owner_wallet, g.group_title
         FROM verifications v
         JOIN groups g ON g.group_id = v.group_id
         WHERE v.payout_status = 'pending'
           AND v.state IN ('PASSED', 'RULES_PENDING', 'ADMITTED', 'RULES_TIMED_OUT')
           AND v.advertiser_id IS NOT NULL AND v.locked_bid_price IS NOT NULL
         FOR UPDATE OF v SKIP LOCKED`,
      );

      if (pending.rows.length === 0) {
        await client.query("COMMIT");
        return { txCount: 0, totalMicro: 0n };
      }

      await client.query(
        `UPDATE verifications SET payout_status = 'processing', updated_at = NOW()
         WHERE verification_id = ANY($1::uuid[])`,
        [pending.rows.map((r) => r.verification_id)],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
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
        groupTitle: row.group_title ?? "unknown group",
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
           WHERE verification_id = ANY($1::uuid[]) AND payout_status = 'processing'`,
          [campaignVerificationIds],
        );
        if (campaign.feeVerificationIds.length > 0) {
          await client.query(
            `UPDATE verifications SET fee_status = 'failed', updated_at = NOW()
             WHERE verification_id = ANY($1::uuid[])`,
            [campaign.feeVerificationIds],
          );
        }
        await sendAdminAlert(
          `Payout failed — campaign #${campaign.advertiserId} (${campaign.groupTitle}): ` +
            `insufficient escrow balance (need ${formatUsdMicro(combined)}, have ${formatUsdMicro(onChain)}). ` +
            `${campaignVerificationIds.length} verification(s) marked failed: ${previewIds(campaignVerificationIds)}`,
        );
        continue;
      }

      // Owner legs — write payout_status / payout_tx_hash only. Rows were already
      // claimed as 'processing' inside the transaction above.
      for (const leg of campaign.ownerLegs.values()) {
        if (leg.amountMicro <= 0n) continue;

        const txHash = await releaseEscrowPayout(campaign.advertiserId, leg.recipient, leg.amountMicro);
        if (!txHash) {
          await client.query(
            `UPDATE verifications SET payout_status = 'failed', updated_at = NOW()
             WHERE verification_id = ANY($1::uuid[]) AND payout_status = 'processing'`,
            [leg.verificationIds],
          );
          await sendAdminAlert(
            `Payout failed — campaign #${campaign.advertiserId} (${campaign.groupTitle}): ` +
              `on-chain transfer of ${formatUsdMicro(leg.amountMicro)} to owner ${leg.recipient} returned no tx (check logs). ` +
              `${leg.verificationIds.length} verification(s) marked failed: ${previewIds(leg.verificationIds)}`,
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
        if (!feeTxHash) {
          await sendAdminAlert(
            `Fee transfer failed — campaign #${campaign.advertiserId} (${campaign.groupTitle}): ` +
              `${formatUsdMicro(campaign.feeMicro)} platform fee returned no tx (check logs). ` +
              `Owner payouts unaffected; fee_status marked failed on ${campaign.feeVerificationIds.length} verification(s).`,
          );
        }
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
