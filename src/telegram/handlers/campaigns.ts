import { Bot, InlineKeyboard } from "grammy";

import {
  listCampaignsForAdvertiser,
  pauseCampaign,
  resumeCampaign,
  withdrawCampaign,
} from "@/adapters/bidding.js";
import { db } from "@/db.js";
import { refundUnusedBudget } from "@/services/escrow.js";
import { promoteNextBidder, wasTopBid } from "@/services/bid-ladder.js";
import { formatUsdMicro } from "@/utils/usdc.js";
import { logger } from "@/utils/logger.js";

const pendingWithdraw = new Map<number, number>();

export function registerCampaignHandlers(bot: Bot): void {
  bot.command("campaigns", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || ctx.chat?.type !== "private") {
      await ctx.reply("Send /campaigns in a private chat.");
      return;
    }

    const rows = await listCampaignsForAdvertiser(BigInt(fromId));
    if (rows.length === 0) {
      await ctx.reply("No campaigns yet. Send /buy to create one.");
      return;
    }

    const lines = rows.map(
      (c) =>
        `**#${c.advertiserId}** · ${c.groupTitle ?? "Group"}\n` +
        `  ${formatUsdMicro(c.bidPerVerification)}/join · ${formatUsdMicro(c.remainingBudget)} left · _${c.campaignStatus}_`,
    );
    await ctx.reply(
      `**Your campaigns**\n\n${lines.join("\n\n")}\n\n` +
        `/topup — add budget · /pause <id> · /resume <id> · /withdraw <id>`,
      { parse_mode: "Markdown" },
    );
  });

  bot.command("pause", async (ctx) => {
    const fromId = ctx.from?.id;
    const id = parseInt(ctx.match?.trim() ?? "", 10);
    if (!fromId || !id) {
      await ctx.reply("Usage: /pause <campaignId>");
      return;
    }

    const rows = await listCampaignsForAdvertiser(BigInt(fromId));
    const row = rows.find((r) => r.advertiserId === id);
    const topBefore = row ? await wasTopBid(id, row.groupId) : false;

    const ok = await pauseCampaign(id, BigInt(fromId));
    if (!ok) {
      await ctx.reply("Could not pause — check campaign ID and status.");
      return;
    }

    if (row && topBefore) {
      await promoteNextBidder(ctx.api, row.groupId, "paused", BigInt(fromId));
    }

    await ctx.reply(`Campaign #${id} paused. USDC stays in escrow. /resume ${id} to continue.`);
  });

  bot.command("resume", async (ctx) => {
    const fromId = ctx.from?.id;
    const id = parseInt(ctx.match?.trim() ?? "", 10);
    if (!fromId || !id) {
      await ctx.reply("Usage: /resume <campaignId>");
      return;
    }

    const ok = await resumeCampaign(id, BigInt(fromId));
    if (!ok) {
      await ctx.reply("Could not resume — campaign must be paused with remaining budget.");
      return;
    }

    await ctx.reply(`Campaign #${id} is active again and back in the bid ladder.`);
  });

  bot.command("withdraw", async (ctx) => {
    const fromId = ctx.from?.id;
    const id = parseInt(ctx.match?.trim() ?? "", 10);
    if (!fromId || !id) {
      await ctx.reply("Usage: /withdraw <campaignId>");
      return;
    }

    const rows = await listCampaignsForAdvertiser(BigInt(fromId));
    const row = rows.find((r) => r.advertiserId === id);
    if (!row || !["active", "paused"].includes(row.campaignStatus)) {
      await ctx.reply("Campaign not found or already withdrawn.");
      return;
    }

    pendingWithdraw.set(fromId, id);
    const kb = new InlineKeyboard()
      .text("Confirm withdraw", `withdraw_confirm:${id}`)
      .text("Cancel", "withdraw_cancel");
    await ctx.reply(
      `Withdraw campaign **#${id}**?\n\n` +
        `Refund: **${formatUsdMicro(row.remainingBudget)} USDC** (unused balance)\n` +
        `Pending owner payouts are not refunded.`,
      { parse_mode: "Markdown", reply_markup: kb },
    );
  });

  bot.callbackQuery(/^withdraw_confirm:(\d+)$/, async (ctx) => {
    const fromId = ctx.from?.id;
    const id = parseInt(ctx.match![1]!, 10);
    if (!fromId || pendingWithdraw.get(fromId) !== id) {
      await ctx.answerCallbackQuery({ text: "Expired.", show_alert: true });
      return;
    }
    pendingWithdraw.delete(fromId);

    const rows = await listCampaignsForAdvertiser(BigInt(fromId));
    const row = rows.find((r) => r.advertiserId === id);
    const groupId = row?.groupId ?? null;
    const topBefore = row ? await wasTopBid(id, row.groupId) : false;

    const result = await withdrawCampaign(id, BigInt(fromId));
    if (!result.ok) {
      await ctx.answerCallbackQuery({ text: "Withdraw failed.", show_alert: true });
      return;
    }

    let refundNote = "";
    if (result.refundMicro > 0n) {
      const tx = await refundUnusedBudget(id, result.refundMicro);
      if (tx) {
        await db.query(`UPDATE advertiser_budgets SET refund_tx_hash = $2 WHERE advertiser_id = $1`, [
          id,
          tx,
        ]);
      }
      refundNote = tx
        ? `\n\nRefund tx: \`${tx.slice(0, 10)}…\``
        : "\n\n⚠️ Refund tx failed — contact support.";
    }

    if (groupId != null && topBefore) {
      await promoteNextBidder(ctx.api, groupId, "withdrawn", BigInt(fromId));
    }

    await ctx.editMessageText(
      `✅ Campaign #${id} withdrawn.${refundNote}`,
      { parse_mode: "Markdown" },
    );
    await ctx.answerCallbackQuery();
    logger.info({ campaignId: id, refundMicro: result.refundMicro.toString() }, "Campaign withdrawn");
  });

  bot.callbackQuery("withdraw_cancel", async (ctx) => {
    const fromId = ctx.from?.id;
    if (fromId) pendingWithdraw.delete(fromId);
    await ctx.editMessageText("Withdraw cancelled.");
    await ctx.answerCallbackQuery();
  });
}
