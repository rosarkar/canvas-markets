import type { Api } from "grammy";
import type { User } from "@grammyjs/types";
import { InlineKeyboard } from "grammy";

import { getTopBidForGroup } from "@/adapters/bidding.js";
import type { GroupRow } from "@/adapters/groups.adapter.js";
import {
  createVerification,
  type VerificationEntryType,
  type VerificationRow,
  transitionState,
} from "@/adapters/verification.adapter.js";
import {
  getCaptchaById,
  pickRandomCaptcha,
} from "@/services/captcha-questions.js";
import { VerificationState } from "@/services/verification-states.js";
import { sendCaptchaDm } from "@/telegram/services/captcha-dm.js";
import { sendWelcomeGateMessage } from "@/telegram/services/welcome-gate.js";
import { restrictUserForCaptcha } from "@/telegram/verification-actions.js";
import { logger } from "@/utils/logger.js";

export interface BeginVerificationResult {
  verification: VerificationRow;
  captchaSentInDm: boolean;
}

export async function beginVerification(
  api: Api,
  user: User,
  group: GroupRow,
  groupTitle: string,
  entryType: VerificationEntryType,
): Promise<BeginVerificationResult> {
  const topBid = await getTopBidForGroup(group.groupId);
  const captcha = pickRandomCaptcha();
  const verification = await createVerification({
    tgUserId: BigInt(user.id),
    groupId: group.groupId,
    advertiserId: topBid?.advertiserId ?? null,
    entryType,
  });

  await transitionState(verification.verificationId, VerificationState.TASK_SENT, {
    lockedBidPrice: topBid?.bidPerVerification ?? undefined,
    captchaQuestionId: captcha.id,
    captchaCorrectOption: captcha.correctOptionId,
  });

  const me = await api.getMe();
  const botUsername = me.username ?? "CanvasProtocolBot";
  let captchaSentInDm = false;

  if (entryType === "open_join") {
    await restrictUserForCaptcha(api, group.tgGroupId, user.id);
    await sendWelcomeGateMessage(
      api,
      Number(group.tgGroupId),
      group.groupId,
      user.first_name,
      groupTitle,
      verification.verificationId,
      botUsername,
    );
    captchaSentInDm = await sendCaptchaDm(
      api,
      user.id,
      verification.verificationId,
      captcha,
      groupTitle,
    );
    if (!captchaSentInDm) {
      await transitionState(verification.verificationId, VerificationState.DEEP_LINK_SENT);
    }
  } else {
    captchaSentInDm = await sendCaptchaDm(
      api,
      user.id,
      verification.verificationId,
      captcha,
      groupTitle,
    );
    if (!captchaSentInDm) {
      await transitionState(verification.verificationId, VerificationState.DEEP_LINK_SENT);
      const deepLink = `https://t.me/${botUsername}?start=verify_${verification.verificationId}`;
      const keyboard = new InlineKeyboard().url("Start verification", deepLink);
      try {
        await api.sendMessage(
          user.id,
          `You requested to join **${groupTitle}**.\n\nTap below to verify.`,
          { reply_markup: keyboard, parse_mode: "Markdown" },
        );
      } catch {
        /* cannot reach user */
      }
    }
  }

  logger.info(
    {
      verificationId: verification.verificationId,
      groupId: group.groupId,
      tgUserId: user.id,
      entryType,
      captchaId: captcha.id,
      captchaSentInDm,
    },
    "Verification started",
  );

  return { verification, captchaSentInDm };
}

export async function resendCaptchaDm(
  api: Api,
  userId: number,
  verificationId: string,
  groupTitle: string,
): Promise<boolean> {
  const { getVerificationByToken } = await import("@/adapters/verification.adapter.js");
  const verification = await getVerificationByToken(verificationId);
  if (!verification?.captchaQuestionId) return false;

  const captcha = getCaptchaById(verification.captchaQuestionId);
  if (!captcha) return false;

  return sendCaptchaDm(api, userId, verificationId, captcha, groupTitle);
}
