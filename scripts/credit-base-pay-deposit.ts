#!/usr/bin/env tsx
/**
 * Credit orphaned Base Pay USDC sitting in escrow to a pending campaign.
 *
 * Usage:
 *   npm run credit:deposit -- 7
 *   npm run credit:deposit -- 7 0x22209... 100000
 */
import "@/load-env.js";

import { confirmCampaignDeposit, getPendingCampaignById } from "@/adapters/bidding.js";
import { connectDb, db } from "@/db.js";
import {
  creditDirectDeposit,
  readUnallocatedUsdc,
} from "@/services/escrow.js";
import { fromMicroUnits } from "@/utils/usdc.js";

async function main(): Promise<void> {
  const campaignId = Number.parseInt(process.argv[2] ?? "", 10);
  if (!Number.isFinite(campaignId) || campaignId < 1) {
    console.error("Usage: npm run credit:deposit -- <campaignId> [depositor] [amountMicro]");
    process.exit(1);
  }

  await connectDb();
  const pending = await getPendingCampaignById(campaignId);
  if (!pending || pending.campaignStatus !== "pending_deposit") {
    console.error(`Campaign #${campaignId} not found or not pending_deposit`);
    process.exit(1);
  }

  const depositor =
    process.argv[3] ??
    (
      await db.query<{ sender: string }>(
        `SELECT sender FROM payment_credits WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [campaignId],
      )
    ).rows[0]?.sender;

  const amountMicro = process.argv[4] ? BigInt(process.argv[4]) : pending.expectedDepositMicro;

  if (!depositor) {
    console.error("Depositor address required (pass as 2nd arg or ensure payment_credits row exists)");
    process.exit(1);
  }

  const free = await readUnallocatedUsdc();
  console.log(`Unallocated USDC in escrow: ${fromMicroUnits(free)} (${free} microunits)`);
  if (free < amountMicro) {
    console.error(`Need ${fromMicroUnits(amountMicro)} but only ${fromMicroUnits(free)} unallocated`);
    process.exit(1);
  }

  console.log(`Crediting campaign #${campaignId} from ${depositor} for ${fromMicroUnits(amountMicro)} USDC...`);
  const txHash = await creditDirectDeposit(campaignId, depositor, amountMicro, { waitForFundsMs: 0 });
  if (!txHash) {
    console.error("creditDirectDeposit failed");
    process.exit(1);
  }

  console.log(`Credit tx: ${txHash}`);
  const result = await confirmCampaignDeposit(campaignId, txHash, amountMicro);
  if (!result.confirmed) {
    console.error("On-chain credit succeeded but DB confirm failed — check manually");
    process.exit(1);
  }

  await db.query(
    `UPDATE payment_credits SET status = 'confirmed', credit_tx_hash = $2
     WHERE campaign_id = $1 AND status = 'failed'`,
    [campaignId, txHash],
  );

  console.log(`Campaign #${campaignId} is now active.`);
  console.log(`https://basescan.org/tx/${txHash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
