#!/usr/bin/env tsx
/**
 * Deploy CanvasEscrowV0 to Base mainnet.
 *
 * Prerequisites:
 *   1. Install Foundry: https://book.getfoundry.sh/getting-started/installation
 *   2. Run from repo root: forge build
 *   3. Set DEPLOYER_PRIVATE_KEY (or RELAYER_PRIVATE_KEY) with Base ETH for gas
 *
 * Usage: npm run deploy:escrow
 */
import "@/load-env.js";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, createWalletClient, http, type Abi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

import { config } from "@/config/index.js";
import { getUsdcAddress } from "@/services/escrow.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = path.join(repoRoot, "out/CanvasEscrowV0.sol/CanvasEscrowV0.json");

async function main(): Promise<void> {
  const pk = config.base.deployerPrivateKey;
  if (!pk) {
    console.error("Set DEPLOYER_PRIVATE_KEY or RELAYER_PRIVATE_KEY in .env");
    process.exit(1);
  }

  if (!fs.existsSync(artifactPath)) {
    console.error(`Artifact not found: ${artifactPath}`);
    console.error("Run: forge build");
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as {
    abi: Abi;
    bytecode: { object: Hex };
  };

  const account = privateKeyToAccount(pk.startsWith("0x") ? (pk as Hex) : (`0x${pk}` as Hex));
  const usdc = getUsdcAddress();
  const relayer = account.address;

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(config.base.rpcUrl),
  });
  const publicClient = createPublicClient({
    chain: base,
    transport: http(config.base.rpcUrl),
  });

  console.log("Deploying CanvasEscrowV0 to Base mainnet...");
  console.log(`  Deployer/relayer: ${relayer}`);
  console.log(`  USDC: ${usdc}`);

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [usdc, relayer],
  });

  console.log(`  Tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 300_000 });
  const address = receipt.contractAddress;

  if (!address) {
    console.error("Deploy failed — no contract address in receipt");
    process.exit(1);
  }

  console.log("\nDeployed successfully!");
  console.log(`  ESCROW_CONTRACT_ADDRESS=${address}`);
  console.log(`  Basescan: https://basescan.org/address/${address}`);
  console.log("\nAdd ESCROW_CONTRACT_ADDRESS to Railway env vars.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
