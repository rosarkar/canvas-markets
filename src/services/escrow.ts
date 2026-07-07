import { createWalletClient, http, type Abi, type Address, getAddress, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

import { config } from "@/config/index.js";
import { logger } from "@/utils/logger.js";

export const USDC_BASE_MAINNET =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;

export const CANVAS_ESCROW_ABI = [
  {
    type: "event",
    name: "BudgetDeposited",
    inputs: [
      { name: "campaignId", type: "uint256", indexed: true },
      { name: "depositor", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BudgetRefunded",
    inputs: [
      { name: "campaignId", type: "uint256", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "depositBudget",
    inputs: [
      { name: "campaignId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "creditDirectDeposit",
    inputs: [
      { name: "campaignId", type: "uint256" },
      { name: "depositor", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "totalHeld",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "campaignBalance",
    inputs: [{ name: "campaignId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "releasePayout",
    inputs: [
      { name: "campaignId", type: "uint256" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "refundUnusedBudget",
    inputs: [
      { name: "campaignId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const satisfies Abi;

export const budgetDepositedEvent = parseAbiItem(
  "event BudgetDeposited(uint256 indexed campaignId, address indexed depositor, uint256 amount)",
);

export function getEscrowAddress(): Address | null {
  const raw = config.payments.escrowContractAddress?.trim();
  if (!raw) return null;
  try {
    return getAddress(raw);
  } catch {
    return null;
  }
}

export function getUsdcAddress(): Address {
  const raw = config.payments.usdcAddress?.trim();
  if (raw) {
    try {
      return getAddress(raw);
    } catch {
      /* fall through */
    }
  }
  return USDC_BASE_MAINNET;
}

function getRelayerWalletClient() {
  const pk = config.base.relayerPrivateKey;
  const escrowAddress = getEscrowAddress();
  if (!pk || !escrowAddress) return null;

  const key = (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
  const account = privateKeyToAccount(key);
  const client = createWalletClient({
    account,
    chain: base,
    transport: http(config.base.rpcUrl),
  });
  return { client, escrowAddress };
}

export async function releaseEscrowPayout(
  advertiserId: number,
  recipientAddress: string,
  amountMicroUnits: bigint,
): Promise<string | null> {
  const ctx = getRelayerWalletClient();
  if (!ctx) {
    logger.warn({ advertiserId }, "Escrow payout skipped — relayer or escrow not configured");
    return null;
  }

  try {
    const txHash = await ctx.client.writeContract({
      address: ctx.escrowAddress,
      abi: CANVAS_ESCROW_ABI,
      functionName: "releasePayout",
      args: [BigInt(advertiserId), recipientAddress as `0x${string}`, amountMicroUnits],
    });

    logger.info(
      { advertiserId, recipientAddress, amountMicroUnits: amountMicroUnits.toString(), txHash },
      "Escrow payout released",
    );
    return txHash;
  } catch (err) {
    logger.error({ advertiserId, recipientAddress, err }, "Escrow payout failed");
    return null;
  }
}

const ERC20_BALANCE_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const satisfies Abi;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readUnallocatedUsdc(): Promise<bigint> {
  const escrowAddress = getEscrowAddress();
  if (!escrowAddress) return 0n;

  const { createPublicClient } = await import("viem");
  const publicClient = createPublicClient({
    chain: base,
    transport: http(config.base.rpcUrl),
  });

  const usdc = getUsdcAddress();
  const [usdcBalance, totalHeld] = await Promise.all([
    publicClient.readContract({
      address: usdc,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [escrowAddress],
    }),
    publicClient.readContract({
      address: escrowAddress,
      abi: CANVAS_ESCROW_ABI,
      functionName: "totalHeld",
    }),
  ]);

  return usdcBalance > totalHeld ? usdcBalance - totalHeld : 0n;
}

export async function waitForUnallocatedUsdc(
  needed: bigint,
  timeoutMs = 60_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const free = await readUnallocatedUsdc();
    if (free >= needed) return true;
    await sleep(2_000);
  }
  return false;
}

export async function creditDirectDeposit(
  campaignId: number,
  depositor: string,
  amountMicro: bigint,
  opts?: { waitForFundsMs?: number },
): Promise<string | null> {
  const ctx = getRelayerWalletClient();
  if (!ctx) return null;

  const waitMs = opts?.waitForFundsMs ?? 60_000;
  if (waitMs > 0) {
    const ready = await waitForUnallocatedUsdc(amountMicro, waitMs);
    if (!ready) {
      logger.error(
        { campaignId, amountMicro: amountMicro.toString(), waitMs },
        "Timed out waiting for USDC in escrow before credit",
      );
      return null;
    }
  }

  try {
    const txHash = await ctx.client.writeContract({
      address: ctx.escrowAddress,
      abi: CANVAS_ESCROW_ABI,
      functionName: "creditDirectDeposit",
      args: [BigInt(campaignId), depositor as `0x${string}`, amountMicro],
    });
    logger.info({ campaignId, depositor, amountMicro: amountMicro.toString(), txHash }, "Direct deposit credited");
    return txHash;
  } catch (err) {
    logger.error({ campaignId, err }, "creditDirectDeposit failed");
    return null;
  }
}

// refundUnusedBudget was deliberately removed when campaignDepositor was hijackable
// (see BUILD.md). The deployed contract (0xf808…101E) now has the first-depositor
// guard, so the function is safe — but refunds still go through releaseEscrowPayout
// to the advertiser's DB wallet record: same behavior across contract versions and
// the destination stays under our control. Re-add only with a concrete need.

export async function readCampaignBalance(campaignId: number): Promise<bigint> {
  const ctx = getRelayerWalletClient();
  if (!ctx) return 0n;

  const { createPublicClient } = await import("viem");
  const publicClient = createPublicClient({
    chain: base,
    transport: http(config.base.rpcUrl),
  });

  return publicClient.readContract({
    address: ctx.escrowAddress,
    abi: CANVAS_ESCROW_ABI,
    functionName: "campaignBalance",
    args: [BigInt(campaignId)],
  });
}
