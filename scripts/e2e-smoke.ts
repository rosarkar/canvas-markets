#!/usr/bin/env tsx
/**
 * Automated smoke checks for local dev / CI.
 * Usage: npx tsx scripts/e2e-smoke.ts
 */
import "@/load-env.js";

import { connectDb, db } from "@/db.js";
import { createCanvasTables } from "@/adapters/schema.js";
import { listActiveGroups } from "@/adapters/groups.adapter.js";
import { getTopBidForGroup } from "@/adapters/bidding.js";
import { resolveVerificationTask } from "@/services/verification-tasks.js";
import { scoreWithKeywords, passesThreshold } from "@/services/scoring.js";
import { parseBidInput } from "@/utils/usdc.js";

async function main(): Promise<void> {
  const checks: { name: string; ok: boolean; detail?: string }[] = [];

  try {
    await connectDb();
    checks.push({ name: "Postgres connection", ok: true });
  } catch (err) {
    checks.push({ name: "Postgres connection", ok: false, detail: String(err) });
    printResults(checks);
    process.exit(1);
  }

  try {
    await createCanvasTables();
    checks.push({ name: "Schema migration", ok: true });
  } catch (err) {
    checks.push({ name: "Schema migration", ok: false, detail: String(err) });
  }

  const groups = await listActiveGroups();
  checks.push({
    name: "Registered groups",
    ok: true,
    detail: `${groups.length} active group(s)`,
  });

  if (groups[0]) {
    const topBid = await getTopBidForGroup(groups[0].groupId);
    const task = resolveVerificationTask(groups[0], topBid);
    checks.push({
      name: "Task resolver",
      ok: !!task.taskType,
      detail: `${task.taskType}${topBid?.taskText ? " (advertiser task)" : ""}`,
    });
  }

  const score = scoreWithKeywords(
    "What do you use DeFi for?",
    "I stake USDC on Moonwell and swap on Aerodrome for yield.",
  );
  checks.push({
    name: "Keyword scoring",
    ok: passesThreshold(score),
    detail: `score=${score.score}`,
  });

  try {
    const micro = parseBidInput("$0.35");
    checks.push({ name: "Bid parsing", ok: micro === 350_000n, detail: `${micro} microunits` });
  } catch (err) {
    checks.push({ name: "Bid parsing", ok: false, detail: String(err) });
  }

  printResults(checks);
  await db.end();

  const failed = checks.filter((c) => !c.ok);
  process.exit(failed.length > 0 ? 1 : 0);
}

function printResults(checks: { name: string; ok: boolean; detail?: string }[]): void {
  console.log("\nCanvas AI E2E smoke checks\n");
  for (const c of checks) {
    const icon = c.ok ? "✅" : "❌";
    console.log(`${icon} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  console.log("\nManual Telegram checklist:");
  console.log("  1. Add bot to test group (admin: Ban, Restrict, Invite via Link)");
  console.log("  2. /register + /wallet 0x...");
  console.log("  3. Join with test account → verify in DM");
  console.log("  4. Wrong answer → 24h cooldown; correct → admitted");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
