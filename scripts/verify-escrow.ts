#!/usr/bin/env tsx
/**
 * Verify CanvasEscrowV0 on Basescan (Base mainnet).
 *
 * Usage: npm run verify:escrow -- <deployedAddress>
 */
import "@/load-env.js";

import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "@/config/index.js";
import { getEscrowAddress, getUsdcAddress } from "@/services/escrow.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const address = process.argv[2] ?? getEscrowAddress();
  if (!address) {
    console.error("Usage: npm run verify:escrow -- <address>  (or set ESCROW_CONTRACT_ADDRESS)");
    process.exit(1);
  }

  const usdc = getUsdcAddress();
  const pk = config.base.deployerPrivateKey;
  if (!pk) {
    console.error("Set DEPLOYER_PRIVATE_KEY or RELAYER_PRIVATE_KEY");
    process.exit(1);
  }

  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(pk.startsWith("0x") ? (pk as `0x${string}`) : (`0x${pk}` as `0x${string}`));
  const relayer = account.address;

  const cmd =
    `forge verify-contract ${address} contracts/CanvasEscrowV0.sol:CanvasEscrowV0 ` +
    `--chain base --constructor-args $(cast abi-encode "constructor(address,address)" ${usdc} ${relayer}) ` +
    `--etherscan-api-key ${process.env.BASESCAN_API_KEY ?? ""}`;

  console.log("Running:", cmd);
  execSync(cmd, { cwd: repoRoot, stdio: "inherit" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
