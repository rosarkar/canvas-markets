import { Bot, InlineKeyboard } from "grammy";

import {
  getGroupsByOwnerTgId,
  getGroupOwnerMenuStats,
  updateOwnerWallet,
} from "@/adapters/groups.adapter.js";
import { config } from "@/config/index.js";
import { createPortalInviteLink } from "@/telegram/services/portal-invite.js";
import { startPendingRulesPrompt } from "@/telegram/handlers/register.js";
import { fromMicroUnits } from "@/utils/usdc.js";
import { logger } from "@/utils/logger.js";

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

/** Owner Tg IDs waiting for a new wallet address reply via the menu. */
const pendingMenuWallet = new Map<number, true>();

export function hasActivePendingMenuWallet(userId: number): boolean {
  return pendingMenuWallet.has(userId);
}

export async function handlePendingMenuWalletReply(
  ctx: { from: { id: number }; reply: (text: string, extra?: object) => Promise<unknown> },
  text: string,
): Promise<boolean> {
  if (!pendingMenuWallet.has(ctx.from.id)) return false;
  const wallet = text.trim();
  if (!WALLET_RE.test(wallet)) {
    await ctx.reply(
      "That doesn't look like a valid Base address. Send a 0x… address, or tap /menu to cancel.",
    );
    return true;
  }
  await updateOwnerWallet(BigInt(ctx.from.id), wallet.toLowerCase());
  pendingMenuWallet.delete(ctx.from.id);
  await ctx.reply(`✅ Wallet updated to \`${wallet.toLowerCase()}\``, { parse_mode: "Markdown" });
  logger.info({ ownerTgId: ctx.from.id, wallet }, "Owner wallet updated via menu");
  return true;
}

export function buildOwnerMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📊 My Stats", "menu:stats")
    .text("🔗 Portal Link", "menu:portal")
    .row()
    .text("✏️ Edit Rules", "menu:rules")
    .text("💰 Update Wallet", "menu:wallet")
    .row()
    .text("❓ Help", "menu:help")
    .text("📢 Advertiser tools", "menu:advertiser");
}

export function registerMenuHandler(bot: Bot): void {
  bot.command("menu", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    const fromId = ctx.from?.id;
    if (!fromId) return;

    const groups = await getGroupsByOwnerTgId(BigInt(fromId));
    if (groups.length === 0) {
      await ctx.reply(
        "No registered groups found. Add the bot to your group and run /register there first.",
      );
      return;
    }

    await ctx.reply("What would you like to do?", { reply_markup: buildOwnerMenuKeyboard() });
  });

  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith("menu:")) {
      await next();
      return;
    }

    const fromId = ctx.from.id;
    await ctx.answerCallbackQuery();

    switch (data) {
      case "menu:stats": {
        const stats = await getGroupOwnerMenuStats(BigInt(fromId));
        if (stats.length === 0) {
          await ctx.api.sendMessage(fromId, "No registered groups found.");
          break;
        }
        for (const s of stats) {
          const title = s.groupTitle ?? "Your group";
          const earned = fromMicroUnits(s.pendingEarningsMicro).toFixed(2);
          const bidLine =
            s.topBidMicro != null
              ? `$${fromMicroUnits(s.topBidMicro).toFixed(4)} per verification`
              : "No active campaign";
          await ctx.api.sendMessage(
            fromId,
            [
              title,
              `Verifications this week: ${s.verificationsThisWeek}`,
              `Total earned: $${earned}`,
              `Current advertiser: —`,
              `Current bid: ${bidLine}`,
            ].join("\n"),
          );
        }
        break;
      }

      case "menu:portal": {
        const groups = await getGroupsByOwnerTgId(BigInt(fromId));
        if (groups.length === 0) {
          await ctx.api.sendMessage(fromId, "No registered groups found.");
          break;
        }
        for (const group of groups) {
          try {
            const portalLink =
              group.portalInviteLink ?? (await createPortalInviteLink(bot.api, group));
            if (portalLink) {
              await ctx.api.sendMessage(
                fromId,
                `Here's your portal link to share with new members:\n${portalLink}`,
              );
            } else {
              await ctx.api.sendMessage(
                fromId,
                "Could not generate portal link. Make sure the bot has **Invite users via link** admin permission.",
                { parse_mode: "Markdown" },
              );
            }
          } catch {
            /* ignore */
          }
        }
        break;
      }

      case "menu:rules": {
        const groups = await getGroupsByOwnerTgId(BigInt(fromId));
        if (groups.length === 0) {
          await ctx.api.sendMessage(fromId, "No registered groups found.");
          break;
        }
        const group = groups[0]!;
        startPendingRulesPrompt(fromId, group.groupId);
        const keyboard = new InlineKeyboard().text("Skip", `rules_prompt:skip:${group.groupId}`);
        await ctx.api.sendMessage(
          fromId,
          "Send your updated group rules as a message, one rule per line. Tap Skip to keep your current rules.",
          { reply_markup: keyboard },
        );
        break;
      }

      case "menu:wallet": {
        pendingMenuWallet.set(fromId, true);
        await ctx.api.sendMessage(fromId, "Send your new Base payout wallet address.");
        break;
      }

      case "menu:help": {
        await ctx.api.sendMessage(
          fromId,
          "Canvas verifies new members before they enter your group.\n\n" +
            "Commands:\n" +
            "/menu — open this menu\n" +
            "/invite — get your portal link\n" +
            "/wallet 0xAddress — update your payout wallet\n\n" +
            "Questions? Reach out to the Canvas team.",
        );
        break;
      }

      case "menu:advertiser": {
        const origin = new URL(config.telegram.webhookUrl).origin;
        await ctx.api.sendMessage(
          fromId,
          "📢 *Advertiser tools*\n\n" +
            "/buy — launch a verified-join campaign\n" +
            "/topup — add budget to your ads\n" +
            "/campaigns — manage ads, pause, or withdraw refunds\n" +
            "/link 0x... — connect your wallet for the dashboard\n" +
            `Dashboard: ${origin}/advertiser`,
          {
            parse_mode: "Markdown",
            reply_markup: new InlineKeyboard()
              .text("📋 My campaigns", "campaign:list")
              .text("💰 Withdraw refund", "campaign:withdraw_menu")
              .row()
              .text("➕ New campaign", "campaign:buy")
              .text("📈 Top up", "campaign:topup_menu"),
          },
        );
        break;
      }

      default:
        await next();
    }
  });

  // Handle wallet address reply
  bot.on("message:text", async (ctx, next) => {
    const fromId = ctx.from?.id;
    if (!fromId || ctx.chat?.type !== "private" || ctx.message.text.startsWith("/")) {
      await next();
      return;
    }

    const handled = await handlePendingMenuWalletReply(ctx, ctx.message.text.trim());
    if (!handled) {
      await next();
    }
  });
}
