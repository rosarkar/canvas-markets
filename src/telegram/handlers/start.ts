import { Bot } from "grammy";

import { config } from "@/config/index.js";
import { getGroupById } from "@/adapters/groups.adapter.js";
import { getVerificationByToken, transitionState } from "@/adapters/verification.adapter.js";
import { VerificationState } from "@/services/verification-states.js";
import { resendCaptchaDm } from "@/telegram/services/begin-verification.js";
import { sendRulesGateDm } from "@/telegram/services/captcha-dm.js";
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
        verification.state !== VerificationState.RULES_SENT &&
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

      if (verification.state === VerificationState.RULES_SENT) {
        const sent = await sendRulesGateDm(ctx.api, fromId, group, title);
        if (!sent) {
          await ctx.reply("Could not send verification. Please try again.");
          return;
        }
        logger.info({ verificationId: token, groupId: group.groupId }, "Rules gate resent via /start deep link");
        return;
      }

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
        "/link 0x... — connect your wallet for the dashboard\n" +
        `Dashboard: ${origin}/advertiser\n\n` +
        "━━━━━━━━━━━━━━\n" +
        "Follow us: @canvas\\_protocol on X",
      { parse_mode: "Markdown" },
    );
  });
}
