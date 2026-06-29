import { Bot } from "grammy";

import { getGroupById } from "@/adapters/groups.adapter.js";
import { getVerificationByToken } from "@/adapters/verification.adapter.js";
import { VerificationState } from "@/services/verification-states.js";
import { completeAdmission } from "@/telegram/services/verification-complete.js";
import { logger } from "@/utils/logger.js";

const CALLBACK_PREFIX = "rules_agree:";

/** Handles the "I agree ✓" tap on the post-verification rules gate (RULES_PENDING). */
export function registerAdmissionCallbackHandler(bot: Bot): void {
  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith(CALLBACK_PREFIX)) {
      await next();
      return;
    }

    const verificationId = data.slice(CALLBACK_PREFIX.length);
    const verification = await getVerificationByToken(verificationId);
    if (!verification) {
      await ctx.answerCallbackQuery({ text: "This verification expired.", show_alert: true });
      return;
    }

    if (verification.tgUserId !== BigInt(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "This isn't for you.", show_alert: true });
      return;
    }

    if (verification.state !== VerificationState.RULES_PENDING) {
      await ctx.answerCallbackQuery({ text: "This step is no longer active." });
      return;
    }

    if (verification.expiresAt && verification.expiresAt.getTime() < Date.now()) {
      await ctx.answerCallbackQuery({ text: "This timed out.", show_alert: true });
      return;
    }

    const group = await getGroupById(verification.groupId);
    if (!group) {
      await ctx.answerCallbackQuery({ text: "Group not found.", show_alert: true });
      return;
    }

    await completeAdmission(ctx.api, verificationId, group);
    await ctx.answerCallbackQuery({ text: "Welcome!" });

    try {
      await ctx.editMessageReplyMarkup();
    } catch {
      /* ignore — message may already be edited/deleted */
    }

    logger.info(
      { verificationId, groupId: group.groupId },
      "User tapped \"I agree\" on the rules gate",
    );
  });
}
