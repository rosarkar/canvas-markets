import { Bot, InlineKeyboard, type Context } from "grammy";

import {
  listCampaignsForAdvertiser,
  pauseCampaign,
  resumeCampaign,
  withdrawCampaign,
  type AdvertiserCampaignRow,
} from "@/adapters/bidding.js";
import { getAdvertiserByTgId } from "@/adapters/advertisers.adapter.js";
import { db } from "@/db.js";
import { releaseEscrowPayout } from "@/services/escrow.js";
import { promoteNextBidder, wasTopBid } from "@/services/bid-ladder.js";
import { showBuyEntryMenu } from "@/telegram/handlers/buy.js";
import { formatUsdMicro } from "@/utils/usdc.js";
import { logger } from "@/utils/logger.js";

const pendingWithdraw = new Map<number, number>();

function withdrawableCampaigns(rows: AdvertiserCampaignRow[]): AdvertiserCampaignRow[] {
  return rows.filter(
    (c) =>
      ["active", "paused"].includes(c.campaignStatus) && c.remainingBudget > 0n,
  );
}

function campaignSummaryLines(rows: AdvertiserCampaignRow[]): string {
  return rows
    .map(
      (c) =>
        `**#${c.advertiserId}** · ${c.groupTitle ?? "Group"}\n` +
        `  ${formatUsdMicro(c.bidPerVerification)}/join · ${formatUsdMicro(c.remainingBudget)} left · _${c.campaignStatus}_`,
    )
    .join("\n\n");
}

function buildCampaignListKeyboard(rows: AdvertiserCampaignRow[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const c of withdrawableCampaigns(rows)) {
    keyboard
      .text(
        `💰 Withdraw #${c.advertiserId} · ${formatUsdMicro(c.remainingBudget)}`,
        `campaign:withdraw:${c.advertiserId}`,
      )
      .row();
  }

  for (const c of rows) {
    if (c.campaignStatus === "active") {
      keyboard.text(`⏸ Pause #${c.advertiserId}`, `campaign:pause:${c.advertiserId}`).row();
    } else if (c.campaignStatus === "paused" && c.remainingBudget > 0n) {
      keyboard.text(`▶️ Resume #${c.advertiserId}`, `campaign:resume:${c.advertiserId}`).row();
    }
  }

  if (rows.some((c) => ["active", "paused", "exhausted"].includes(c.campaignStatus))) {
    keyboard.text("📈 Top up", "campaign:topup_menu").row();
  }

  keyboard.text("🔄 Refresh", "campaign:list");
  return keyboard;
}

async function sendCampaignList(ctx: Context, fromId: number): Promise<void> {
  const rows = await listCampaignsForAdvertiser(BigInt(fromId));
  if (rows.length === 0) {
    const text = "No campaigns yet. Send /buy to create one.";
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text);
      await ctx.answerCallbackQuery();
    } else {
      await ctx.reply(text);
    }
    return;
  }

  const text =
    `**Your campaigns**\n\n${campaignSummaryLines(rows)}\n\n` +
    `_Tap a button below to withdraw unused USDC, pause, or top up._\n\n` +
    `Type /start to return to the main menu.`;

  const keyboard = buildCampaignListKeyboard(rows);
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
  }
}

async function sendWithdrawMenu(ctx: Context, fromId: number): Promise<void> {
  const rows = await listCampaignsForAdvertiser(BigInt(fromId));
  const withdrawable = withdrawableCampaigns(rows);

  if (withdrawable.length === 0) {
    const text =
      rows.length === 0
        ? "No campaigns yet. Send /buy to create one."
        : "No unused balance to withdraw. Check /campaigns for status.";
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Nothing to withdraw.", show_alert: true });
    } else {
      await ctx.reply(text);
    }
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const c of withdrawable) {
    keyboard
      .text(
        `#${c.advertiserId} ${c.groupTitle ?? "Group"} · ${formatUsdMicro(c.remainingBudget)}`,
        `campaign:withdraw:${c.advertiserId}`,
      )
      .row();
  }
  keyboard.text("← Back to campaigns", "campaign:list");

  const text =
    "**Withdraw unused USDC**\n\n" +
    "Pick a campaign. You'll get a refund of the remaining balance to the wallet that originally paid.\n\n" +
    "_Pending owner payouts are not refunded._";

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
  }
}

async function sendWithdrawPrompt(
  ctx: Context,
  fromId: number,
  id: number,
): Promise<void> {
  const rows = await listCampaignsForAdvertiser(BigInt(fromId));
  const row = rows.find((r) => r.advertiserId === id);
  if (!row || !["active", "paused"].includes(row.campaignStatus)) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Campaign not found.", show_alert: true });
    } else {
      await ctx.reply("Campaign not found or already withdrawn.");
    }
    return;
  }

  if (row.remainingBudget === 0n) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "No balance left to withdraw.", show_alert: true });
    } else {
      await ctx.reply("This campaign has no remaining balance to withdraw.");
    }
    return;
  }

  pendingWithdraw.set(fromId, id);
  const kb = new InlineKeyboard()
    .text("✅ Confirm withdraw", `withdraw_confirm:${id}`)
    .text("Cancel", "withdraw_cancel");

  const text =
    `Withdraw campaign **#${id}** · ${row.groupTitle ?? "Group"}?\n\n` +
    `Refund: **${formatUsdMicro(row.remainingBudget)} USDC** (unused balance)\n` +
    `Pending owner payouts are not refunded.`;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: kb });
    await ctx.answerCallbackQuery();
  } else {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  }
}

export function registerCampaignHandlers(bot: Bot): void {
  bot.command("campaigns", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || ctx.chat?.type !== "private") {
      await ctx.reply("Send /campaigns in a private chat.");
      return;
    }
    await sendCampaignList(ctx, fromId);
  });

  bot.command("pause", async (ctx) => {
    const fromId = ctx.from?.id;
    const id = parseInt(ctx.match?.trim() ?? "", 10);
    if (!fromId || !id) {
      await ctx.reply("Usage: /pause <campaignId> — or use /campaigns for buttons.");
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

    await ctx.reply(`Campaign #${id} paused. USDC stays in escrow. /resume ${id} or /campaigns to continue.`);
  });

  bot.command("resume", async (ctx) => {
    const fromId = ctx.from?.id;
    const id = parseInt(ctx.match?.trim() ?? "", 10);
    if (!fromId || !id) {
      await ctx.reply("Usage: /resume <campaignId> — or use /campaigns for buttons.");
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
    if (!fromId || ctx.chat?.type !== "private") {
      await ctx.reply("Send /withdraw in a private chat.");
      return;
    }

    const id = parseInt(ctx.match?.trim() ?? "", 10);
    if (!id) {
      await sendWithdrawMenu(ctx, fromId);
      return;
    }

    await sendWithdrawPrompt(ctx, fromId, id);
  });

  bot.callbackQuery("campaign:list", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;
    await sendCampaignList(ctx, fromId);
  });

  bot.callbackQuery("campaign:withdraw_menu", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;
    await sendWithdrawMenu(ctx, fromId);
  });

  bot.callbackQuery(/^campaign:withdraw:(\d+)$/, async (ctx) => {
    const fromId = ctx.from?.id;
    const id = parseInt(ctx.match![1]!, 10);
    if (!fromId) return;
    await sendWithdrawPrompt(ctx, fromId, id);
  });

  bot.callbackQuery(/^campaign:pause:(\d+)$/, async (ctx) => {
    const fromId = ctx.from?.id;
    const id = parseInt(ctx.match![1]!, 10);
    if (!fromId) return;

    const rows = await listCampaignsForAdvertiser(BigInt(fromId));
    const row = rows.find((r) => r.advertiserId === id);
    const topBefore = row ? await wasTopBid(id, row.groupId) : false;

    const ok = await pauseCampaign(id, BigInt(fromId));
    if (!ok) {
      await ctx.answerCallbackQuery({ text: "Could not pause.", show_alert: true });
      return;
    }

    if (row && topBefore) {
      await promoteNextBidder(ctx.api, row.groupId, "paused", BigInt(fromId));
    }

    await ctx.answerCallbackQuery({ text: `Campaign #${id} paused.` });
    await sendCampaignList(ctx, fromId);
  });

  bot.callbackQuery(/^campaign:resume:(\d+)$/, async (ctx) => {
    const fromId = ctx.from?.id;
    const id = parseInt(ctx.match![1]!, 10);
    if (!fromId) return;

    const ok = await resumeCampaign(id, BigInt(fromId));
    if (!ok) {
      await ctx.answerCallbackQuery({ text: "Could not resume.", show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery({ text: `Campaign #${id} resumed.` });
    await sendCampaignList(ctx, fromId);
  });

  bot.callbackQuery("campaign:buy", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;
    await ctx.answerCallbackQuery();
    await showBuyEntryMenu(ctx, fromId, false);
  });

  bot.callbackQuery("campaign:topup_menu", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId) return;
    await ctx.answerCallbackQuery();
    await showBuyEntryMenu(ctx, fromId, true);
  });

  bot.callbackQuery(/^withdraw_confirm:(\d+)$/, async (ctx) => {
    const fromId = ctx.from?.id;
    const id = parseInt(ctx.match![1]!, 10);
    if (!fromId || pendingWithdraw.get(fromId) !== id) {
      await ctx.answerCallbackQuery({ text: "Expired. Use /campaigns → Withdraw.", show_alert: true });
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
      // TODO for Mateo: fix campaignDepositor overwrite in CanvasEscrowV0.sol V1 — any
      // address can call depositBudget and overwrite the refund recipient. This
      // application-layer workaround routes refunds through our DB wallet record
      // (releasePayout to the advertiser's registered wallet, instead of
      // refundUnusedBudget which pays whoever last touched campaignDepositor) until
      // the contract is redeployed.
      const advertiser = await getAdvertiserByTgId(BigInt(fromId));
      const refundWallet = advertiser?.walletAddress ?? null;

      let tx: string | null = null;
      if (refundWallet) {
        tx = await releaseEscrowPayout(id, refundWallet, result.refundMicro);
        if (tx) {
          await db.query(`UPDATE advertiser_budgets SET refund_tx_hash = $2 WHERE advertiser_id = $1`, [
            id,
            tx,
          ]);
        }
        refundNote = tx
          ? `\n\nRefund tx: \`${tx.slice(0, 10)}…\``
          : "\n\n⚠️ Refund tx failed — contact support.";
      } else {
        logger.error(
          { campaignId: id, advertiserTgId: fromId },
          "Withdraw refund skipped — no wallet on record for advertiser",
        );
        refundNote = "\n\n⚠️ No wallet on record for your account — contact support to receive your refund.";
      }
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
