import { Bot, InlineKeyboard } from "grammy";

import { config } from "@/config/index.js";
import { getGroupById, getGroupsByOwnerTgId } from "@/adapters/groups.adapter.js";
import { hasAdvertiserActivity } from "@/adapters/advertisers.adapter.js";
import { getVerificationByToken, transitionState } from "@/adapters/verification.adapter.js";
import { VerificationState } from "@/services/verification-states.js";
import { resendCaptchaDm } from "@/telegram/services/begin-verification.js";
import { handleDmStart } from "@/telegram/handlers/menu.js";
import { logger } from "@/utils/logger.js";

export function registerStartHandler(bot: Bot): void {
  bot.command("start", async (ctx) => {
    const payload = ctx.match?.trim() ?? "";

    if (payload.startsWith("verify_")) {
      const fromId = ctx.from?.id;
      if (!fromId) return;

      const token = payload.replace("verify_", "");
      const verification = await getVerificationByToken(token);
      if (!verification) {
        await ctx.reply("This verification link is invalid or expired.");
        return;
      }

      if (
        verification.state !== VerificationState.PENDING &&
        verification.state !== VerificationState.DEEP_LINK_SENT &&
        verification.state !== VerificationState.TASK_SENT
      ) {
        await ctx.reply("This verification session is no longer active.");
        return;
      }

      const group = await getGroupById(verification.groupId);
      if (!group) {
        await ctx.reply("Group not found.");
        return;
      }

      const chat = await ctx.api.getChat(Number(group.tgGroupId));
      const title =
        chat.type !== "private" && "title" in chat ? (chat.title ?? "the group") : "the group";

      if (verification.state !== VerificationState.TASK_SENT) {
        await transitionState(token, VerificationState.TASK_SENT);
      }

      const sent = await resendCaptchaDm(ctx.api, fromId, token, title);

      if (!sent) {
        await ctx.reply("Could not send verification. Please try again.");
        return;
      }

      logger.info({ verificationId: token, groupId: group.groupId }, "Captcha sent via /start deep link");
      return;
    }

    // Known users (owner, advertiser, or both) get the appropriate menu.
    // New users fall through to the onboarding welcome screen below.
    const fromId = ctx.from?.id;
    if (fromId && ctx.chat?.type === "private") {
      const [ownerGroups, isAdvertiser] = await Promise.all([
        getGroupsByOwnerTgId(BigInt(fromId)),
        hasAdvertiserActivity(BigInt(fromId)),
      ]);
      const isOwner = ownerGroups.length > 0;
      if (isOwner || isAdvertiser) {
        await handleDmStart(ctx.api, fromId, ownerGroups, isAdvertiser);
        return;
      }
    }

    const origin = new URL(config.telegram.webhookUrl).origin;
    await ctx.reply(
      "👋 Welcome to *Canvas Protocol*\n\n" +
        "The marketplace where Telegram group owners earn USDC for every verified join — and advertisers reach DeFi-native users who actually engage.\n\n" +
        "━━━━━━━━━━━━━━\n" +
        "👥 *Group owners*\n" +
        "/register — activate Canvas in your group\n" +
        "/invite — get your verification portal link\n" +
        "/wallet 0x... — set your USDC payout address\n" +
        `Dashboard: ${origin}/group-owner\n\n` +
        "📢 *Advertisers*\n" +
        "/buy — launch a verified-join campaign\n" +
        "/topup — add budget to your ads\n" +
        "/campaigns — manage ads, pause, or withdraw refunds\n" +
        "/link 0x... — connect your wallet for the dashboard\n" +
        `Dashboard: ${origin}/advertiser\n\n` +
        "━━━━━━━━━━━━━━\n" +
        "Follow us: @canvas\\_protocol on X",
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
  });
}
