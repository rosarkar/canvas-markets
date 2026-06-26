#!/usr/bin/env tsx
import "@/load-env.js";

import { connectDb } from "@/db.js";
import { runPayoutBatch } from "@/services/payout-batch.js";

async function main(): Promise<void> {
  await connectDb();
  const result = await runPayoutBatch();
  console.log(`Payout batch: ${result.txCount} txs, ${result.totalMicro.toString()} micro USDC`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
