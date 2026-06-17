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
import {
  isPassingMcAnswer,
  parseTaskPayload,
  TaskType,
  type PreferenceMcPayload,
  type TriviaMcPayload,
} from "@/services/verification-tasks.js";
import { VerificationState } from "@/services/verification-states.js";
import {
  completeVerificationFail,
  completeVerificationPass,
} from "@/telegram/services/verification-complete.js";
import { logger } from "@/utils/logger.js";

export function registerCaptchaCallbackHandler(bot: Bot): void {
  bot.on("callback_query:data", async (ctx, next) => {
    const parsed = parseCaptchaCallbackData(ctx.callbackQuery.data);
    if (!parsed) {
      await next();
      return;
    }

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

    if (
      verification.state !== VerificationState.TASK_SENT &&
      verification.state !== VerificationState.DEEP_LINK_SENT
    ) {
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

    const taskType = (verification.taskType as TaskType) ?? TaskType.TRIVIA_MC;
    const payload = parseTaskPayload(taskType, verification.taskPayload);

    let optionLabel = optionId;
    if (payload && "options" in payload) {
      optionLabel =
        (payload as TriviaMcPayload | PreferenceMcPayload).options.find((o) => o.id === optionId)
          ?.label ?? optionId;
    } else if (verification.captchaQuestionId) {
      const captcha = getCaptchaById(verification.captchaQuestionId);
      optionLabel = captcha?.options.find((o) => o.id === optionId)?.label ?? optionId;
    }

    const correctOptionId =
      verification.captchaCorrectOption ??
      (payload && "correctOptionId" in payload
        ? (payload as TriviaMcPayload).correctOptionId
        : null);

    const isCorrect = isPassingMcAnswer(taskType, correctOptionId, optionId);

    await transitionState(verificationId, VerificationState.RESPONSE_RECEIVED, {
      responseText: optionLabel,
    });

    const messageId = ctx.callbackQuery.message?.message_id;
    const dmChatId = ctx.callbackQuery.message?.chat.id;

    const chat = await ctx.api.getChat(Number(group.tgGroupId));
    const groupTitle =
      chat.type !== "private" && "title" in chat ? (chat.title ?? "the group") : "the group";
    const me = await ctx.api.getMe();
    const botUsername = me.username ?? "CanvasProtocolBot";

    if (isCorrect) {
      await transitionState(verificationId, VerificationState.PASSED);
      await completeVerificationPass(ctx.api, verification, group, groupTitle, botUsername);
      await ctx.answerCallbackQuery({ text: "Verified!" });

      if (messageId && dmChatId) {
        try {
          await ctx.api.editMessageReplyMarkup(dmChatId, messageId);
        } catch {
          /* ignore */
        }
      }

      const successMsg =
        verification.entryType === "join_request"
          ? `✅ You're in! Your join request for **${groupTitle}** has been approved.`
          : `✅ You're in! You can now chat in **${groupTitle}**.`;

      await ctx.reply(successMsg, { parse_mode: "Markdown" });
      logger.info(
        { verificationId, groupId: group.groupId, entryType: verification.entryType, taskType },
        "User passed MC verification (DM)",
      );
    } else {
      await transitionState(verificationId, VerificationState.FAILED);
      await completeVerificationFail(ctx.api, verification, group);
      await ctx.answerCallbackQuery({ text: "Wrong answer.", show_alert: true });

      if (messageId && dmChatId) {
        try {
          await ctx.api.editMessageReplyMarkup(dmChatId, messageId);
        } catch {
          /* ignore */
        }
      }

      await ctx.reply(`❌ Wrong answer. You can try again in 24 hours.`);
      logger.info(
        { verificationId, groupId: group.groupId, optionId, entryType: verification.entryType },
        "User failed captcha (DM)",
      );
    }
  });
}
