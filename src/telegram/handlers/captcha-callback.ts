import { Bot } from "grammy";

import { getGroupById } from "@/adapters/groups.adapter.js";
import {
  getVerificationByToken,
  transitionState,
} from "@/adapters/verification.adapter.js";
import {
  getCaptchaById,
  parseCaptchaCallbackData,
} from "@/services/captcha-questions.js";
import { VerificationState } from "@/services/verification-states.js";
import { admitUser, rejectUser } from "@/telegram/verification-actions.js";
import { logger } from "@/utils/logger.js";

export function registerCaptchaCallbackHandler(bot: Bot): void {
  bot.on("callback_query:data", async (ctx) => {
    const parsed = parseCaptchaCallbackData(ctx.callbackQuery.data);
    if (!parsed) return;

    const { verificationId, optionId } = parsed;
    const fromId = BigInt(ctx.from.id);

    const verification = await getVerificationByToken(verificationId);
    if (!verification) {
      await ctx.answerCallbackQuery({ text: "This verification expired.", show_alert: true });
      return;
    }

    if (verification.tgUserId !== fromId) {
      await ctx.answerCallbackQuery({ text: "This captcha is not for you.", show_alert: true });
      return;
    }

    if (verification.state !== VerificationState.TASK_SENT) {
      await ctx.answerCallbackQuery({ text: "This verification is no longer active." });
      return;
    }

    if (verification.expiresAt && verification.expiresAt.getTime() < Date.now()) {
      await ctx.answerCallbackQuery({ text: "This verification timed out.", show_alert: true });
      return;
    }

    const group = await getGroupById(verification.groupId);
    if (!group) {
      await ctx.answerCallbackQuery({ text: "Group not found.", show_alert: true });
      return;
    }

    const captcha = verification.captchaQuestionId
      ? getCaptchaById(verification.captchaQuestionId)
      : undefined;
    const optionLabel =
      captcha?.options.find((o) => o.id === optionId)?.label ?? optionId;
    const isCorrect = verification.captchaCorrectOption === optionId;

    await transitionState(verificationId, VerificationState.RESPONSE_RECEIVED, {
      responseText: optionLabel,
    });

    const chatId = Number(group.tgGroupId);
    const userId = Number(verification.tgUserId);
    const messageId = ctx.callbackQuery.message?.message_id;

    if (isCorrect) {
      await transitionState(verificationId, VerificationState.PASSED);
      await admitUser(ctx.api, chatId, userId);
      await ctx.answerCallbackQuery({ text: "Verified!" });

      if (messageId) {
        try {
          await ctx.api.editMessageReplyMarkup(chatId, messageId);
        } catch {
          /* message may already be edited */
        }
      }

      const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
      await ctx.reply(`${username} verified — welcome to the group.`);
      logger.info({ verificationId, groupId: group.groupId }, "User passed captcha");
    } else {
      await transitionState(verificationId, VerificationState.FAILED);
      await rejectUser(ctx.api, chatId, userId);
      await ctx.answerCallbackQuery({ text: "Wrong answer.", show_alert: true });

      if (messageId) {
        try {
          await ctx.api.editMessageReplyMarkup(chatId, messageId);
        } catch {
          /* ignore */
        }
      }

      logger.info({ verificationId, groupId: group.groupId, optionId }, "User failed captcha");
    }
  });
}
