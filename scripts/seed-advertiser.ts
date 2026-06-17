#!/usr/bin/env tsx
/**
 * Seed a sample advertiser campaign for the first active group.
 * Usage: npx tsx scripts/seed-advertiser.ts
 */
import "@/load-env.js";

import { connectDb, db } from "@/db.js";
import { createCanvasTables } from "@/adapters/schema.js";
import { listActiveGroups } from "@/adapters/groups.adapter.js";
import { placeBid } from "@/adapters/bidding.js";
import { toMicroUnits } from "@/utils/usdc.js";

const SAMPLE_TASK =
  "You have 10,000 USDC — would you lend on Moonwell for yield or trade on Aerodrome? Pick what you'd actually do.";

const SEED_ADVERTISER_TG_ID = BigInt(process.env.SEED_ADVERTISER_TG_ID ?? "0");
const BID_DOLLARS = process.env.SEED_BID ?? "0.35";
const QUANTITY = Number(process.env.SEED_QUANTITY ?? "10");

async function main(): Promise<void> {
  await connectDb();
  await createCanvasTables();

  const groups = await listActiveGroups();
  if (groups.length === 0) {
    console.error("No active groups. Add the bot to a group first.");
    process.exit(1);
  }

  const group = groups[0]!;
  const bidMicro = toMicroUnits(BID_DOLLARS);

  const result = await placeBid({
    groupId: group.groupId,
    advertiserTgId: SEED_ADVERTISER_TG_ID,
    bidMicroUnits: bidMicro,
    quantity: QUANTITY,
    taskText: SAMPLE_TASK,
  });

  console.log("Seeded advertiser campaign:");
  console.log(`  group_id: ${group.groupId}`);
  console.log(`  advertiser_id: ${result.advertiserId}`);
  console.log(`  bid: $${BID_DOLLARS} x ${QUANTITY} verifications`);
  console.log(`  task: ${SAMPLE_TASK}`);

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
