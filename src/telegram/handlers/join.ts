import { Bot, InlineKeyboard } from "grammy";

import { getTopBidForGroup } from "@/adapters/bidding.js";
import { getGroupByTgId } from "@/adapters/groups.adapter.js";
import {
  createVerification,
  isUserInCooldown,
  transitionState,
} from "@/adapters/verification.adapter.js";
import {
  buildCaptchaCallbackData,
  pickRandomCaptcha,
} from "@/services/captcha-questions.js";
import { VerificationState } from "@/services/verification-states.js";
import { rejectUser, restrictUserForCaptcha } from "@/telegram/verification-actions.js";
import { logger } from "@/utils/logger.js";

export function registerJoinHandler(bot: Bot): void {
  bot.on("chat_member", async (ctx) => {
    const update = ctx.chatMember;
    if (!update) return;

    const { new_chat_member: member, chat } = update;
    if (member.status !== "member" || member.user.is_bot) return;

    const tgGroupId = BigInt(chat.id);
    const tgUserId = BigInt(member.user.id);

    const group = await getGroupByTgId(tgGroupId);
    if (!group?.isActive) return;

    if (await isUserInCooldown(tgUserId, group.groupId)) {
      await rejectUser(ctx.api, chat.id, tgUserId);
      return;
    }

    const topBid = await getTopBidForGroup(group.groupId);
    const captcha = pickRandomCaptcha();
    const verification = await createVerification({
      tgUserId,
      groupId: group.groupId,
      advertiserId: topBid?.advertiserId ?? null,
    });

    await transitionState(verification.verificationId, VerificationState.TASK_SENT, {
      lockedBidPrice: topBid?.bidPerVerification ?? undefined,
      captchaQuestionId: captcha.id,
      captchaCorrectOption: captcha.correctOptionId,
    });

    await restrictUserForCaptcha(ctx.api, chat.id, tgUserId);

    const username = member.user.username
      ? `@${member.user.username}`
      : member.user.first_name;
    const keyboard = new InlineKeyboard();
    for (const option of captcha.options) {
      keyboard.text(
        option.label,
        buildCaptchaCallbackData(verification.verificationId, option.id),
      );
    }

    try {
      await ctx.api.sendMessage(
        chat.id,
        `Welcome ${username} — complete verification to participate:\n\n${captcha.prompt}`,
        { reply_markup: keyboard },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, tgGroupId: tgGroupId.toString() }, "Failed to post captcha message");
      if (msg.includes("not enough rights")) {
        logger.error(`Bot lost admin in group ${group.groupId}`);
      }
    }
  });
}
