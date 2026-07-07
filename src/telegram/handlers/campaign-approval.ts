import type { Api } from "grammy";
import { Bot, InlineKeyboard } from "grammy";

import { getAdvertiserByTgId } from "@/adapters/advertisers.adapter.js";
import {
  approveCampaign,
  autoAcceptStaleCampaigns,
  declineCampaign,
  getCampaignApprovalInfo,
} from "@/adapters/bidding.js";
import { db } from "@/db.js";
import { sendAdminAlert } from "@/services/admin-alerts.js";
import { releaseEscrowPayout } from "@/services/escrow.js";
import { formatUsdMicro } from "@/utils/usdc.js";
import { logger } from "@/utils/logger.js";

/**
 * Owner accept/decline gate for funded campaigns (BUILD.md "advertiser accept/decline
 * layer"). Deposit confirmation puts a campaign in 'pending_approval' and calls
 * sendApprovalRequest; the owner taps Accept or Decline; ignoring it auto-accepts
 * after 48h via runAutoAcceptSweep.
 */

const CB_PREFIX = "campappr:";

function taskPreview(taskText: string | null): string {
  if (!taskText) return "(default verification task)";
  return taskText.length > 140 ? `${taskText.slice(0, 140)}…` : taskText;
}

/** DM the group owner an accept/decline request for a freshly funded campaign. */
export async function sendApprovalRequest(api: Api, advertiserId: number): Promise<void> {
  const info = await getCampaignApprovalInfo(advertiserId);
  if (!info || info.campaignStatus !== "pending_approval") return;
  if (!info.ownerTgId) {
    logger.warn({ advertiserId }, "Approval request skipped — group has no owner_tg_id");
    return;
  }

  const keyboard = new InlineKeyboard()
    .text("✅ Accept", `${CB_PREFIX}accept:${advertiserId}`)
    .text("❌ Decline", `${CB_PREFIX}decline:${advertiserId}`);

  try {
    await api.sendMessage(
      Number(info.ownerTgId),
      `🆕 *New campaign request for ${info.groupTitle ?? "your group"}*\n\n` +
        `Bid: ${formatUsdMicro(info.bidPerVerification)}/verification · ` +
        `Budget: ${formatUsdMicro(info.remainingBudget)}\n` +
        `Task: ${taskPreview(info.taskText)}\n\n` +
        `Accept to let this advertiser sponsor your group's verifications. ` +
        `If you don't respond within 48 hours it activates automatically.`,
      { parse_mode: "Markdown", reply_markup: keyboard },
    );
  } catch (err) {
    // Owner unreachable (blocked bot etc.) — campaign stays pending and the 48h
    // auto-accept covers it. Surface so it isn't a silent stall.
    logger.warn({ err, advertiserId }, "Failed to DM owner approval request");
    await sendAdminAlert(
      `Could not DM group owner the approval request for campaign #${advertiserId} — ` +
        `it will auto-accept in 48h unless handled.`,
    );
  }
}

async function notifyAdvertiserActivated(api: Api, advertiserTgId: bigint | null, advertiserId: number, auto: boolean): Promise<void> {
  if (!advertiserTgId) return;
  try {
    await api.sendMessage(
      Number(advertiserTgId),
      `✅ **Campaign #${advertiserId} is live!**\n\n` +
        (auto
          ? `The group owner didn't respond within 48 hours, so your campaign activated automatically.`
          : `The group owner accepted your campaign. It's now active and winning joins.`),
      { parse_mode: "Markdown" },
    );
  } catch {
    /* advertiser may have blocked the bot */
  }
}

async function notifyOutbidByApproval(api: Api, displacedTgId: bigint, groupTitle: string, bidMicro: bigint): Promise<void> {
  try {
    await api.sendMessage(
      Number(displacedTgId),
      `You've been outbid in **${groupTitle}**. New top bid: ${formatUsdMicro(bidMicro)}. Send /buy to rebid.`,
      { parse_mode: "Markdown" },
    );
  } catch {
    /* advertiser may have blocked the bot */
  }
}

export function registerCampaignApprovalHandler(bot: Bot): void {
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith(CB_PREFIX)) {
      await next();
      return;
    }

    const [, action, idStr] = data.split(":");
    const advertiserId = Number(idStr);
    if (!Number.isFinite(advertiserId) || (action !== "accept" && action !== "decline")) {
      await ctx.answerCallbackQuery({ text: "Invalid action." });
      return;
    }

    const info = await getCampaignApprovalInfo(advertiserId);
    if (!info) {
      await ctx.answerCallbackQuery({ text: "Campaign not found.", show_alert: true });
      return;
    }
    if (info.ownerTgId == null || Number(info.ownerTgId) !== ctx.from.id) {
      await ctx.answerCallbackQuery({ text: "This request isn't for you.", show_alert: true });
      return;
    }
    if (info.campaignStatus !== "pending_approval") {
      await ctx.answerCallbackQuery({ text: "This campaign was already handled." });
      try { await ctx.editMessageReplyMarkup(); } catch { /* ignore */ }
      return;
    }

    if (action === "accept") {
      const result = await approveCampaign(advertiserId);
      if (!result.ok) {
        await ctx.answerCallbackQuery({ text: "Already handled." });
        return;
      }
      await ctx.answerCallbackQuery({ text: "Campaign accepted ✅" });
      try {
        await ctx.editMessageText(
          `✅ Accepted — campaign #${advertiserId} is now active in ${info.groupTitle ?? "your group"}.`,
        );
      } catch { /* ignore */ }
      await notifyAdvertiserActivated(ctx.api, info.advertiserTgId, advertiserId, false);
      if (result.displacedAdvertiserTgId) {
        await notifyOutbidByApproval(
          ctx.api,
          result.displacedAdvertiserTgId,
          info.groupTitle ?? "your group",
          info.bidPerVerification,
        );
      }
      logger.info({ advertiserId, ownerTgId: ctx.from.id }, "Campaign accepted by group owner");
      return;
    }

    // decline
    const result = await declineCampaign(advertiserId);
    if (!result.ok) {
      await ctx.answerCallbackQuery({ text: "Already handled." });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Campaign declined" });
    try {
      await ctx.editMessageText(`❌ Declined — campaign #${advertiserId} will not run in your group.`);
    } catch { /* ignore */ }

    // Refund the escrowed budget to the advertiser's linked wallet. Same safe path as
    // withdraw: releasePayout to the DB wallet record, never refundUnusedBudget.
    let refundNote = "The advertiser has been notified.";
    if (result.refundMicro > 0n && result.advertiserTgId) {
      const advertiser = await getAdvertiserByTgId(result.advertiserTgId);
      const refundWallet = advertiser?.walletAddress ?? null;
      if (refundWallet) {
        const tx = await releaseEscrowPayout(advertiserId, refundWallet, result.refundMicro);
        if (tx) {
          await db.query(
            `UPDATE advertiser_budgets SET refund_tx_hash = $2 WHERE advertiser_id = $1`,
            [advertiserId, tx],
          );
        } else {
          await sendAdminAlert(
            `Refund failed — campaign #${advertiserId} declined by owner: releasePayout of ` +
              `${formatUsdMicro(result.refundMicro)} to ${refundWallet} returned no tx (check logs).`,
            ctx.api,
          );
          refundNote = "Refund is being processed — the advertiser will be contacted.";
        }
      } else {
        await sendAdminAlert(
          `Refund blocked — campaign #${advertiserId} declined but advertiser tg ${result.advertiserTgId} ` +
            `has no wallet linked. ${formatUsdMicro(result.refundMicro)} needs manual refund.`,
          ctx.api,
        );
        refundNote = "Refund pending — the advertiser needs to link a wallet.";
      }
    }

    if (result.advertiserTgId) {
      try {
        await ctx.api.sendMessage(
          Number(result.advertiserTgId),
          `❌ **Campaign #${advertiserId} was declined** by the group owner.\n\n` +
            `Your ${formatUsdMicro(result.refundMicro)} budget is being refunded to your linked wallet. ` +
            `If you haven't linked one, run /link 0xYourAddress and contact support.`,
          { parse_mode: "Markdown" },
        );
      } catch { /* advertiser may have blocked the bot */ }
    }
    logger.info({ advertiserId, ownerTgId: ctx.from.id, refundNote }, "Campaign declined by group owner");
  });
}

/** Hourly sweep: activate campaigns the owner ignored for 48h and notify the advertiser. */
export async function runAutoAcceptSweep(api: Api): Promise<void> {
  const accepted = await autoAcceptStaleCampaigns();
  for (const campaign of accepted) {
    await notifyAdvertiserActivated(api, campaign.advertiserTgId, campaign.advertiserId, true);
    logger.info({ advertiserId: campaign.advertiserId }, "Campaign auto-accepted after 48h");
  }
  if (accepted.length > 0) {
    await sendAdminAlert(
      `${accepted.length} campaign(s) auto-accepted after 48h without owner response: ` +
        accepted.map((c) => `#${c.advertiserId}`).join(", "),
    );
  }
}
