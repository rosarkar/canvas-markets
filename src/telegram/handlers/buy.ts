import { Bot, InlineKeyboard } from "grammy";

import { getTopBidForGroup, placeBid } from "@/adapters/bidding.js";
import { listActiveGroups } from "@/adapters/groups.adapter.js";
import { config } from "@/config/index.js";
import { fromMicroUnits, parseBidInput } from "@/utils/usdc.js";
import { logger } from "@/utils/logger.js";

type BuyStep = "group" | "quantity" | "bid" | "task" | "confirm";

interface BuySession {
  step: BuyStep;
  groupId?: number;
  groupTitle?: string;
  quantity?: number;
  bidMicroUnits?: bigint;
  taskText?: string;
}

const sessions = new Map<number, BuySession>();

export function hasActiveBuySession(userId: number): boolean {
  return sessions.has(userId);
}

const MIN_QUANTITY = 10;

function formatUsd(micro: bigint): string {
  return `$${fromMicroUnits(micro).toFixed(2)}`;
}

export function registerBuyHandler(bot: Bot): void {
  bot.command("buy", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || ctx.chat?.type !== "private") {
      await ctx.reply("Send /buy to me in a private chat to start a campaign.");
      return;
    }

    const groups = await listActiveGroups();
    if (groups.length === 0) {
      await ctx.reply("No active groups registered yet. Group owners must /register first.");
      return;
    }

    sessions.set(fromId, { step: "group" });

    const keyboard = new InlineKeyboard();
    for (const group of groups) {
      const topBid = await getTopBidForGroup(group.groupId);
      const topLabel = topBid ? formatUsd(topBid.bidPerVerification) : "none";
      let title = `Group #${group.groupId}`;
      try {
        const chat = await ctx.api.getChat(Number(group.tgGroupId));
        if (chat.type !== "private" && "title" in chat) {
          title = chat.title ?? title;
        }
      } catch {
        /* ignore */
      }
      keyboard
        .text(`${title} (top: ${topLabel})`, `buy:group:${group.groupId}:${encodeURIComponent(title)}`)
        .row();
    }

    await ctx.reply(
      "**Advertiser buy flow**\n\nPick a target group. You'll set quantity (min 10), bid per verification, and your task prompt.",
      { parse_mode: "Markdown", reply_markup: keyboard },
    );
  });

  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith("buy:")) {
      await next();
      return;
    }

    const fromId = ctx.from.id;
    const session = sessions.get(fromId);
    if (!session) {
      await ctx.answerCallbackQuery({ text: "Session expired. Send /buy again.", show_alert: true });
      return;
    }

    if (data.startsWith("buy:group:")) {
      const parts = data.split(":");
      const groupId = Number(parts[2]);
      const groupTitle = decodeURIComponent(parts[3] ?? `Group #${groupId}`);
      session.groupId = groupId;
      session.groupTitle = groupTitle;
      session.step = "quantity";
      sessions.set(fromId, session);
      await ctx.answerCallbackQuery();
      await ctx.reply(
        `Selected **${groupTitle}**.\n\nHow many verifications do you want to fund? (minimum ${MIN_QUANTITY})`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    if (data === "buy:confirm:yes") {
      await ctx.answerCallbackQuery();
      if (
        !session.groupId ||
        !session.quantity ||
        !session.bidMicroUnits ||
        !session.taskText
      ) {
        await ctx.reply("Incomplete session. Send /buy to start over.");
        sessions.delete(fromId);
        return;
      }

      if (session.bidMicroUnits < config.constants.MIN_BID_MICROUNITS) {
        await ctx.reply(`Minimum bid is ${formatUsd(config.constants.MIN_BID_MICROUNITS)} per verification.`);
        return;
      }

      const topBid = await getTopBidForGroup(session.groupId);
      if (topBid && session.bidMicroUnits <= topBid.bidPerVerification) {
        await ctx.reply(
          `Your bid must exceed the current top bid of ${formatUsd(topBid.bidPerVerification)}. Send /buy to try again.`,
        );
        sessions.delete(fromId);
        return;
      }

      const total = session.bidMicroUnits * BigInt(session.quantity);
      try {
        const result = await placeBid({
          groupId: session.groupId,
          advertiserTgId: BigInt(fromId),
          bidMicroUnits: session.bidMicroUnits,
          quantity: session.quantity,
          taskText: session.taskText,
        });

        await ctx.reply(
          `✅ Campaign live for **${session.groupTitle}**!\n\n` +
            `• Bid: ${formatUsd(session.bidMicroUnits)} / verification\n` +
            `• Quantity: ${session.quantity}\n` +
            `• Total budget: ${formatUsd(total)} USDC (escrow deposit pending)\n` +
            `• Task: ${session.taskText}\n\n` +
            `Campaign ID: ${result.advertiserId}`,
          { parse_mode: "Markdown" },
        );

        if (result.displacedAdvertiserTgId && result.displacedAdvertiserTgId !== BigInt(fromId)) {
          try {
            await ctx.api.sendMessage(
              Number(result.displacedAdvertiserTgId),
              `You've been outbid in **${session.groupTitle}**. New top bid: ${formatUsd(session.bidMicroUnits)}. Send /buy to rebid.`,
              { parse_mode: "Markdown" },
            );
          } catch {
            /* advertiser may have blocked bot */
          }
        }

        logger.info(
          { advertiserId: result.advertiserId, groupId: session.groupId, fromId },
          "Advertiser campaign created via /buy",
        );
      } catch (err) {
        logger.error({ err }, "placeBid failed");
        await ctx.reply("Could not create campaign. Please try again.");
      }

      sessions.delete(fromId);
      return;
    }

    if (data === "buy:confirm:no") {
      await ctx.answerCallbackQuery();
      sessions.delete(fromId);
      await ctx.reply("Campaign cancelled.");
      return;
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const fromId = ctx.from?.id;
    if (!fromId || ctx.chat?.type !== "private") {
      await next();
      return;
    }

    const session = sessions.get(fromId);
    if (!session || ctx.message.text.startsWith("/")) {
      await next();
      return;
    }

    const text = ctx.message.text.trim();

    if (session.step === "quantity") {
      const qty = Number.parseInt(text, 10);
      if (!Number.isFinite(qty) || qty < MIN_QUANTITY) {
        await ctx.reply(`Enter a whole number ≥ ${MIN_QUANTITY}.`);
        return;
      }
      session.quantity = qty;
      session.step = "bid";
      sessions.set(fromId, session);
      const topBid = session.groupId ? await getTopBidForGroup(session.groupId) : null;
      const hint = topBid
        ? `Current top bid: ${formatUsd(topBid.bidPerVerification)}. Yours must be higher.`
        : `Minimum bid: ${formatUsd(config.constants.MIN_BID_MICROUNITS)}.`;
      await ctx.reply(`Bid per verification in USD (e.g. 0.35 or $0.35).\n${hint}`);
      return;
    }

    if (session.step === "bid") {
      try {
        session.bidMicroUnits = parseBidInput(text);
      } catch (err) {
        await ctx.reply(err instanceof Error ? err.message : "Invalid bid amount.");
        return;
      }
      session.step = "task";
      sessions.set(fromId, session);
      await ctx.reply(
        "What verification task should joining users see?\n\n" +
          "Example: *You have 10,000 USDC — would you lend on Moonwell or trade on Aerodrome?*",
        { parse_mode: "Markdown" },
      );
      return;
    }

    if (session.step === "task") {
      if (text.length < 10) {
        await ctx.reply("Task prompt must be at least 10 characters.");
        return;
      }
      session.taskText = text;
      session.step = "confirm";
      sessions.set(fromId, session);

      const total =
        session.bidMicroUnits && session.quantity
          ? session.bidMicroUnits * BigInt(session.quantity)
          : 0n;

      const keyboard = new InlineKeyboard()
        .text("Confirm campaign", "buy:confirm:yes")
        .text("Cancel", "buy:confirm:no");

      await ctx.reply(
        `**Confirm campaign for ${session.groupTitle}**\n\n` +
          `• ${session.quantity} verifications @ ${formatUsd(session.bidMicroUnits!)} each\n` +
          `• Total: ${formatUsd(total)} USDC\n` +
          `• Task: ${session.taskText}`,
        { parse_mode: "Markdown", reply_markup: keyboard },
      );
      return;
    }

    await next();
  });
}
