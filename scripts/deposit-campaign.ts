#!/usr/bin/env tsx
/**
 * Approve + deposit USDC into Canvas escrow (Bankr-free fallback).
 *
 * Usage:
 *   npm run deposit:campaign -- 6              # amount from DB pending campaign
 *   npm run deposit:campaign -- 6 50000        # explicit microunits ($0.05)
 *
 * Wallet: set DEPOSIT_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY / RELAYER_PRIVATE_KEY).
 * Must hold USDC + a little Base ETH for gas on Base mainnet.
 */
import "@/load-env.js";

import {
  createPublicClient,
  createWalletClient,
  http,
  maxUint256,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

import { getPendingCampaignById } from "@/adapters/bidding.js";
import { config } from "@/config/index.js";
import { connectDb } from "@/db.js";
import { CANVAS_ESCROW_ABI, getEscrowAddress, getUsdcAddress } from "@/services/escrow.js";
import { fromMicroUnits } from "@/utils/usdc.js";

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

function getDepositPrivateKey(): Hex {
  const raw =
    process.env.DEPOSIT_PRIVATE_KEY?.trim() ||
    config.base.deployerPrivateKey ||
    config.base.relayerPrivateKey;
  if (!raw) {
    console.error("Set DEPOSIT_PRIVATE_KEY (wallet with USDC on Base) in .env");
    process.exit(1);
  }
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

async function main(): Promise<void> {
  const campaignId = Number.parseInt(process.argv[2] ?? "", 10);
  if (!Number.isFinite(campaignId) || campaignId < 1) {
    console.error("Usage: npm run deposit:campaign -- <campaignId> [amountMicro]");
    process.exit(1);
  }

  const escrow = getEscrowAddress();
  if (!escrow) {
    console.error("ESCROW_CONTRACT_ADDRESS not set");
    process.exit(1);
  }

  let amountMicro: bigint;
  const amountArg = process.argv[3];
  if (amountArg) {
    amountMicro = BigInt(amountArg);
  } else {
    await connectDb();
    const pending = await getPendingCampaignById(campaignId);
    if (!pending || pending.campaignStatus !== "pending_deposit") {
      console.error(`Campaign #${campaignId} not found or not pending_deposit`);
      process.exit(1);
    }
    amountMicro = pending.expectedDepositMicro;
  }

  if (amountMicro <= 0n) {
    console.error("Deposit amount must be > 0");
    process.exit(1);
  }

  const usdc = getUsdcAddress();
  const pk = getDepositPrivateKey();
  const account = privateKeyToAccount(pk);

  const publicClient = createPublicClient({
    chain: base,
    transport: http(config.base.rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(config.base.rpcUrl),
  });

  console.log("\nCanvas escrow deposit\n");
  console.log(`  Campaign:  #${campaignId}`);
  console.log(`  Amount:    ${fromMicroUnits(amountMicro)} USDC (${amountMicro} microunits)`);
  console.log(`  Wallet:    ${account.address}`);
  console.log(`  Escrow:    ${escrow}`);
  console.log(`  USDC:      ${usdc}\n`);

  const allowance = await publicClient.readContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account.address, escrow],
  });

  if (allowance < amountMicro) {
    console.log("Approving USDC for escrow...");
    const approveHash = await walletClient.writeContract({
      address: usdc,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [escrow, maxUint256],
    });
    console.log(`  Approve tx: ${approveHash}`);
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log("  Approved.");
  } else {
    console.log("USDC allowance already sufficient — skipping approve.");
  }

  console.log("Calling depositBudget...");
  const depositHash = await walletClient.writeContract({
    address: escrow,
    abi: CANVAS_ESCROW_ABI,
    functionName: "depositBudget",
    args: [BigInt(campaignId), amountMicro],
  });
  console.log(`  Deposit tx: ${depositHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
  console.log(`  Confirmed in block ${receipt.blockNumber}`);
  console.log("\nDone. Canvas should activate the campaign within ~30s.");
  console.log(`  Basescan: https://basescan.org/tx/${depositHash}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
