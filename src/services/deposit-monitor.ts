import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

import {
  confirmCampaignDeposit,
  expirePendingDeposits,
  getPendingCampaignById,
  type PendingCampaign,
} from "@/adapters/bidding.js";
import { config } from "@/config/index.js";
import { db } from "@/db.js";
import { budgetDepositedEvent, CANVAS_ESCROW_ABI, getEscrowAddress } from "@/services/escrow.js";
import { getBot } from "@/telegram/bot.js";
import { fromMicroUnits } from "@/utils/usdc.js";
import { logger } from "@/utils/logger.js";

let polling = false;

async function getLastBlock(): Promise<bigint> {
  const res = await db.query<{ last_block: string }>(
    `SELECT last_block FROM deposit_cursor WHERE id = 1`,
  );
  return BigInt(res.rows[0]?.last_block ?? "0");
}

async function setLastBlock(block: bigint): Promise<void> {
  await db.query(`UPDATE deposit_cursor SET last_block = $1 WHERE id = 1`, [block.toString()]);
}

function formatUsd(micro: bigint): string {
  const dollars = fromMicroUnits(micro);
  if (dollars >= 1) return `$${dollars.toFixed(2)}`;
  if (dollars >= 0.01) return `$${dollars.toFixed(2)}`;
  return `$${dollars.toFixed(4)}`;
}

async function notifyCampaignLive(campaign: PendingCampaign): Promise<void> {
  if (!campaign.advertiserTgId) return;
  try {
    await getBot().api.sendMessage(
      Number(campaign.advertiserTgId),
      `✅ **Campaign #${campaign.advertiserId} is live!**\n\n` +
        `Deposit confirmed. Your campaign is now active and winning joins for this group.`,
      { parse_mode: "Markdown" },
    );
  } catch (err) {
    logger.warn({ err, advertiserId: campaign.advertiserId }, "Failed to DM advertiser on deposit");
  }
}

async function notifyOutbid(
  displacedTgId: bigint,
  groupTitle: string,
  bidMicro: bigint,
): Promise<void> {
  try {
    await getBot().api.sendMessage(
      Number(displacedTgId),
      `You've been outbid in **${groupTitle}**. New top bid: ${formatUsd(bidMicro)}. Send /buy to rebid.`,
      { parse_mode: "Markdown" },
    );
  } catch {
    /* advertiser may have blocked bot */
  }
}

async function processDepositLog(
  campaignId: number,
  amount: bigint,
  txHash: string,
): Promise<void> {
  const pending = await getPendingCampaignById(campaignId);
  if (!pending || pending.campaignStatus !== "pending_deposit") return;

  if (amount < pending.expectedDepositMicro) {
    logger.warn(
      { campaignId, amount: amount.toString(), expected: pending.expectedDepositMicro.toString() },
      "Deposit amount below expected — waiting for full amount",
    );
    return;
  }

  const result = await confirmCampaignDeposit(campaignId, txHash, amount);
  if (!result.confirmed) return;

  logger.info({ campaignId, txHash, amount: amount.toString() }, "Campaign deposit confirmed");

  const updated = await getPendingCampaignById(campaignId);
  if (updated) await notifyCampaignLive(updated);

  if (result.displacedAdvertiserTgId && updated) {
    await notifyOutbid(
      result.displacedAdvertiserTgId,
      `Group #${updated.groupId}`,
      updated.bidPerVerification,
    );
  }
}

export async function pollEscrowDeposits(): Promise<void> {
  if (polling) return;
  const escrowAddress = getEscrowAddress();
  if (!escrowAddress) return;

  polling = true;
  try {
    const client = createPublicClient({
      chain: base,
      transport: http(config.base.rpcUrl),
    });

    const latestBlock = await client.getBlockNumber();
    let fromBlock = await getLastBlock();
    if (fromBlock === 0n) {
      fromBlock = latestBlock > 2000n ? latestBlock - 2000n : 0n;
    }

    if (fromBlock > latestBlock) {
      polling = false;
      return;
    }

    const logs = await client.getContractEvents({
      address: escrowAddress,
      abi: CANVAS_ESCROW_ABI,
      eventName: "BudgetDeposited",
      fromBlock,
      toBlock: latestBlock,
    });

    for (const log of logs) {
      const campaignId = Number(log.args.campaignId);
      const amount = log.args.amount as bigint;
      const txHash = log.transactionHash;
      if (!campaignId || !txHash) continue;
      await processDepositLog(campaignId, amount, txHash);
    }

    await setLastBlock(latestBlock + 1n);
  } catch (err) {
    logger.error({ err }, "Escrow deposit poll failed");
  } finally {
    polling = false;
  }
}

export async function expirePendingDepositCampaigns(): Promise<void> {
  const expired = await expirePendingDeposits(config.payments.depositTtlMs);
  if (expired.length === 0) return;

  logger.info({ count: expired.length }, "Expired pending deposit campaigns");
  const api = getBot().api;
  for (const row of expired) {
    if (!row.advertiserTgId) continue;
    try {
      await api.sendMessage(
        Number(row.advertiserTgId),
        `Your campaign #${row.advertiserId} expired — no deposit received within 2 hours. Send /buy to try again.`,
      );
    } catch {
      /* ignore */
    }
  }
}

export function startDepositMonitor(): void {
  const escrowAddress = getEscrowAddress();
  if (!escrowAddress) {
    logger.warn("ESCROW_CONTRACT_ADDRESS not set — deposit monitor disabled");
    return;
  }

  const intervalMs = config.payments.depositPollIntervalMs;
  logger.info({ escrowAddress, intervalMs }, "Deposit monitor started");

  void pollEscrowDeposits();
  setInterval(() => {
    void pollEscrowDeposits();
  }, intervalMs);

  setInterval(() => {
    void expirePendingDepositCampaigns();
  }, 60_000);
}
