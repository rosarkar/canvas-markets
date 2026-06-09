import type { Api } from "grammy";
import type { User } from "@grammyjs/types";

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
import { InlineKeyboard } from "grammy";

export async function handleMemberJoin(
  api: Api,
  chatId: number | bigint,
  user: User,
): Promise<void> {
  if (user.is_bot) return;

  const tgGroupId = BigInt(chatId);
  const tgUserId = BigInt(user.id);

  const group = await getGroupByTgId(tgGroupId);
  if (!group?.isActive) {
    logger.info(
      { tgGroupId: tgGroupId.toString(), tgUserId: tgUserId.toString() },
      "Join ignored — group not registered (run /register in the group)",
    );
    return;
  }

  if (await isUserInCooldown(tgUserId, group.groupId)) {
    logger.info({ tgUserId: tgUserId.toString(), groupId: group.groupId }, "Join rejected — cooldown");
    await rejectUser(api, chatId, tgUserId);
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

  await restrictUserForCaptcha(api, chatId, tgUserId);

  const username = user.username ? `@${user.username}` : user.first_name;
  const keyboard = new InlineKeyboard();
  for (const option of captcha.options) {
    keyboard.text(
      option.label,
      buildCaptchaCallbackData(verification.verificationId, option.id),
    );
  }

  try {
    await api.sendMessage(
      Number(chatId),
      `Welcome ${username} — complete verification to participate:\n\n${captcha.prompt}`,
      { reply_markup: keyboard },
    );
    logger.info(
      {
        verificationId: verification.verificationId,
        groupId: group.groupId,
        tgUserId: tgUserId.toString(),
        captchaId: captcha.id,
      },
      "Captcha posted for new member",
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg, tgGroupId: tgGroupId.toString() }, "Failed to post captcha message");
    if (msg.includes("not enough rights")) {
      logger.error(`Bot lost admin in group ${group.groupId}`);
    }
  }
}
