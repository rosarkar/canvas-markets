import { Bot } from "grammy";

import { getGroupById } from "@/adapters/groups.adapter.js";
import { getVerificationByToken, transitionState } from "@/adapters/verification.adapter.js";
import { VerificationState } from "@/services/verification-states.js";
import { resendCaptchaDm } from "@/telegram/services/begin-verification.js";
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

      if (verification.state !== VerificationState.TASK_SENT) {
        await transitionState(token, VerificationState.TASK_SENT);
      }

      const chat = await ctx.api.getChat(Number(group.tgGroupId));
      const title =
        chat.type !== "private" && "title" in chat ? (chat.title ?? "the group") : "the group";

      const sent = await resendCaptchaDm(ctx.api, fromId, token, title);

      if (!sent) {
        await ctx.reply("Could not send verification. Please try again.");
        return;
      }

      logger.info({ verificationId: token, groupId: group.groupId }, "Captcha sent via /start deep link");
      return;
    }

    await ctx.reply(
      "Canvas AI — monetise your Telegram group gating.\n\n" +
        "Group owners: send /register\n" +
        "Advertisers: send /buy",
    );
  });
}
