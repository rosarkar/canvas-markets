import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";

import { getTopBidForGroup } from "@/adapters/bidding.js";
import type { GroupRow } from "@/adapters/groups.adapter.js";
import { getTemplateById } from "@/adapters/templates.adapter.js";
import {
  createVerification,
  getVerificationByToken,
  type VerificationEntryType,
  type VerificationRow,
  transitionState,
} from "@/adapters/verification.adapter.js";
import { getCaptchaById } from "@/services/captcha-questions.js";
import {
  resolveVerificationTask,
  TaskType,
  type ResolvedVerificationTask,
} from "@/services/verification-tasks.js";
import { VerificationState } from "@/services/verification-states.js";
import { sendVerificationTaskDm } from "@/telegram/services/captcha-dm.js";
import { sendWelcomeGateMessage } from "@/telegram/services/welcome-gate.js";
import { restrictUserForCaptcha } from "@/telegram/verification-actions.js";
import { logger } from "@/utils/logger.js";

export interface BeginVerificationResult {
  verification: VerificationRow;
  captchaSentInDm: boolean;
}

function taskToTransitionExtra(task: ResolvedVerificationTask) {
  return {
    taskType: task.taskType,
    taskPayload: task.payload,
    captchaQuestionId: task.captchaQuestionId,
    captchaCorrectOption: task.captchaCorrectOption,
  };
}

function rebuildTaskFromVerification(verification: VerificationRow): ResolvedVerificationTask | null {
  if (!verification.taskType || !verification.taskPayload) return null;
  return {
    taskType: verification.taskType as TaskType,
    payload: verification.taskPayload as ResolvedVerificationTask["payload"],
    captchaQuestionId: verification.captchaQuestionId ?? undefined,
    captchaCorrectOption: verification.captchaCorrectOption ?? undefined,
  };
}

export async function beginVerification(
  api: Api,
  user: { id: number; first_name: string },
  group: GroupRow,
  groupTitle: string,
  entryType: VerificationEntryType,
): Promise<BeginVerificationResult> {
  const topBid = await getTopBidForGroup(group.groupId);
  const template = topBid?.templateId ? await getTemplateById(topBid.templateId) : null;
  const task = resolveVerificationTask(group, topBid, template);
  const verification = await createVerification({
    tgUserId: BigInt(user.id),
    groupId: group.groupId,
    advertiserId: topBid?.advertiserId ?? null,
    entryType,
  });

  await transitionState(verification.verificationId, VerificationState.TASK_SENT, {
    lockedBidPrice: topBid?.bidPerVerification ?? undefined,
    ...taskToTransitionExtra(task),
  });

  const sendTaskDm = (): Promise<boolean> =>
    sendVerificationTaskDm(api, user.id, verification.verificationId, task, groupTitle);

  const me = await api.getMe();
  const botUsername = me.username ?? "CanvasVerificationBot";
  let captchaSentInDm = false;

  if (entryType === "open_join") {
    await restrictUserForCaptcha(api, group.tgGroupId, user.id);
    await sendWelcomeGateMessage(api, Number(group.tgGroupId), group.groupId);
    captchaSentInDm = await sendTaskDm();
    if (!captchaSentInDm) {
      await transitionState(verification.verificationId, VerificationState.DEEP_LINK_SENT);
    }
  } else {
    captchaSentInDm = await sendTaskDm();
    if (!captchaSentInDm) {
      await transitionState(verification.verificationId, VerificationState.DEEP_LINK_SENT);
      const deepLink = `https://t.me/${botUsername}?start=verify_${verification.verificationId}`;
      const keyboard = new InlineKeyboard().url("Verify to join →", deepLink);
      try {
        await api.sendMessage(
          user.id,
          `👋 You requested to join **${groupTitle}**.\n\nTap below to complete your verification — it only takes 30 seconds.`,
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
      taskType: task.taskType,
      captchaSentInDm,
    },
    "Verification started",
  );

  return { verification, captchaSentInDm };
}

export async function resendVerificationDm(
  api: Api,
  userId: number,
  verificationId: string,
  groupTitle: string,
): Promise<boolean> {
  const verification = await getVerificationByToken(verificationId);
  if (!verification) return false;

  let task = rebuildTaskFromVerification(verification);
  if (!task && verification.captchaQuestionId) {
    const captcha = getCaptchaById(verification.captchaQuestionId);
    if (!captcha) return false;
    task = {
      taskType: TaskType.TRIVIA_MC,
      payload: {
        prompt: captcha.prompt,
        options: captcha.options,
        correctOptionId: captcha.correctOptionId,
        questionId: captcha.id,
      },
      captchaQuestionId: captcha.id,
      captchaCorrectOption: captcha.correctOptionId,
    };
  }
  if (!task) return false;

  return sendVerificationTaskDm(api, userId, verificationId, task, groupTitle);
}

/** @deprecated Use resendVerificationDm */
export async function resendCaptchaDm(
  api: Api,
  userId: number,
  verificationId: string,
  groupTitle: string,
): Promise<boolean> {
  return resendVerificationDm(api, userId, verificationId, groupTitle);
}
