#!/usr/bin/env tsx
/**
 * Bankr Agent API spike — validates API key and Base USDC balance query.
 * Usage: npm run bankr:spike
 */
import "@/load-env.js";

import { isBankrConfigured, queryBalance, runPrompt } from "@/services/bankr.client.js";
import { config } from "@/config/index.js";
import { getEscrowAddress } from "@/services/escrow.js";

async function main(): Promise<void> {
  console.log("\nCanvas AI — Bankr spike\n");

  if (!isBankrConfigured()) {
    console.log("❌ BANKR_API_KEY not set — skip Bankr tests");
    console.log("   Get a key at https://bankr.bot/api");
    process.exit(0);
  }

  console.log("✓ BANKR_API_KEY configured");

  try {
    const balance = await queryBalance();
    console.log(`✓ Balance query: ${balance.status}`);
    console.log(`  Response: ${balance.response ?? balance.error ?? "(empty)"}`);
  } catch (err) {
    console.log(`❌ Balance query failed: ${err instanceof Error ? err.message : err}`);
  }

  const escrow = getEscrowAddress();
  const runTransferTest = process.argv.includes("--transfer");

  if (runTransferTest && escrow) {
    console.log("\n--transfer flag set — attempting 0.01 USDC transfer to escrow (founder wallet only)");
    try {
      const result = await runPrompt(
        `Send 0.01 USDC on Base to ${escrow}. This is a Canvas escrow test deposit for campaign 0.`,
      );
      console.log(`  Status: ${result.status}`);
      console.log(`  Response: ${result.response ?? result.error ?? "(empty)"}`);
    } catch (err) {
      console.log(`❌ Transfer test failed: ${err instanceof Error ? err.message : err}`);
    }
  } else if (runTransferTest) {
    console.log("❌ ESCROW_CONTRACT_ADDRESS not set — cannot run transfer test");
  }

  console.log("\nNotes:");
  console.log("  • Bankr API acts on YOUR wallet (API key owner), not the advertiser's.");
  console.log("  • Advertisers fund via @bankr_ai_bot or their own wallet → depositBudget() on escrow.");
  console.log("  • Run with --transfer to test a tiny USDC send to escrow (costs real USDC + gas).");
  console.log(`  • Escrow: ${escrow ?? "(not set)"}`);
  console.log(`  • RPC: ${config.base.rpcUrl}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
