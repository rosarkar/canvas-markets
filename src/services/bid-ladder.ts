import type { Api } from "grammy";

import {
  getTopBidForGroup,
  getPendingCampaignById,
  type TopBid,
} from "@/adapters/bidding.js";
import { getGroupById } from "@/adapters/groups.adapter.js";
import { formatUsdMicro } from "@/utils/usdc.js";
import { logger } from "@/utils/logger.js";

export async function promoteNextBidder(
  api: Api,
  groupId: number,
  reason: "exhausted" | "paused" | "withdrawn",
  displacedAdvertiserTgId?: bigint | null,
): Promise<TopBid | null> {
  const group = await getGroupById(groupId);
  const groupTitle = group?.groupTitle ?? "your group";
  const next = await getTopBidForGroup(groupId);

  if (displacedAdvertiserTgId) {
    const reasonText =
      reason === "exhausted"
        ? "Your campaign budget is exhausted."
        : reason === "paused"
          ? "Your campaign is paused."
          : "You withdrew your campaign.";
    try {
      await api.sendMessage(
        Number(displacedAdvertiserTgId),
        `📊 **${groupTitle}**\n\n${reasonText} Your bid is no longer being served.`,
        { parse_mode: "Markdown" },
      );
    } catch {
      /* blocked bot */
    }
  }

  if (next?.advertiserTgId) {
    try {
      await api.sendMessage(
        Number(next.advertiserTgId),
        `🎯 You're now the **top bidder** on **${groupTitle}** at ${formatUsdMicro(next.bidPerVerification)}/verification.`,
        { parse_mode: "Markdown" },
      );
    } catch {
      /* blocked bot */
    }
  } else if (group?.ownerTgId) {
    try {
      await api.sendMessage(
        Number(group.ownerTgId),
        `ℹ️ No active advertiser campaigns on **${groupTitle}** — new joins use generic verification until someone bids.`,
        { parse_mode: "Markdown" },
      );
    } catch {
      /* blocked bot */
    }
  }

  logger.info({ groupId, reason, nextAdvertiserId: next?.advertiserId ?? null }, "Bid ladder updated");
  return next;
}

export async function wasTopBid(advertiserId: number, groupId: number): Promise<boolean> {
  const top = await getTopBidForGroup(groupId);
  return top?.advertiserId === advertiserId;
}

export async function notifyOutbidOnDeposit(
  api: Api,
  displacedTgId: bigint,
  groupTitle: string,
  bidMicro: bigint,
): Promise<void> {
  try {
    await api.sendMessage(
      Number(displacedTgId),
      `You've been outbid in **${groupTitle}**. New top bid: ${formatUsdMicro(bidMicro)}. Send /buy to rebid.`,
      { parse_mode: "Markdown" },
    );
  } catch {
    /* blocked bot */
  }
}

export async function getGroupTitleForCampaign(advertiserId: number): Promise<string> {
  const campaign = await getPendingCampaignById(advertiserId);
  if (!campaign) return "your group";
  const group = await getGroupById(campaign.groupId);
  return group?.groupTitle ?? "your group";
}
