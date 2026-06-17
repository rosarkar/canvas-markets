import { Bot } from "grammy";

import {
  getAdvertiserByTgId,
  linkAdvertiserWallet,
} from "@/adapters/advertisers.adapter.js";
import { config } from "@/config/index.js";
import { logger } from "@/utils/logger.js";

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

function parseWallet(input: string | undefined): string | null {
  const trimmed = input?.trim();
  if (!trimmed || !WALLET_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function registerLinkHandler(bot: Bot): void {
  bot.command("link", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || ctx.chat?.type !== "private") {
      await ctx.reply("Send /link in a private chat with me.");
      return;
    }

    const wallet = parseWallet(ctx.match);

    if (!wallet) {
      const existing = await getAdvertiserByTgId(BigInt(fromId));
      if (existing) {
        const dashboardUrl = new URL(config.telegram.webhookUrl).origin + "/advertiser";
        await ctx.reply(
          `Linked wallet:\n\`${existing.walletAddress}\`\n\nTo update: /link 0xNewAddress\n\nDashboard: ${dashboardUrl}`,
          { parse_mode: "Markdown" },
        );
      } else {
        await ctx.reply(
          "Link your Base wallet to access the advertiser dashboard:\n\n`/link 0xYourAddress`",
          { parse_mode: "Markdown" },
        );
      }
      return;
    }

    await linkAdvertiserWallet(BigInt(fromId), wallet);

    const dashboardUrl = new URL(config.telegram.webhookUrl).origin + "/advertiser";
    logger.info({ tgId: fromId, wallet }, "Advertiser wallet linked");

    await ctx.reply(
      `✅ Wallet linked!\n\`${wallet}\`\n\nView your campaigns:\n${dashboardUrl}`,
      { parse_mode: "Markdown" },
    );
  });
}
