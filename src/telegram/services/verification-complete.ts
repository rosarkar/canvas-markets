import type { Api } from "grammy";

import { config } from "@/config/index.js";
import type { GroupRow } from "@/adapters/groups.adapter.js";
import { getVerificationByToken, transitionState } from "@/adapters/verification.adapter.js";
import { accrueVerificationPayout } from "@/adapters/payout.adapter.js";
import { promoteNextBidder } from "@/services/bid-ladder.js";
import { VerificationState } from "@/services/verification-states.js";
import { sendAdmissionRulesDm } from "@/telegram/services/captcha-dm.js";
import {
  admitUser,
  approveJoinRequest,
  declineJoinRequest,
  rejectUser,
} from "@/telegram/verification-actions.js";
import { deleteWelcomeGateMessage } from "@/telegram/services/welcome-gate.js";
import { logger } from "@/utils/logger.js";

/**
 * Verification scoring passed — but admission is gated on a rules-agreement tap.
 * Sends the rules DM and moves to RULES_PENDING; the user stays muted until completeAdmission runs.
 */
export async function completeVerificationPass(
  api: Api,
  verificationId: string,
  group: GroupRow,
  groupTitle: string,
  _botUsername: string,
): Promise<void> {
  const verification = await getVerificationByToken(verificationId);
  if (!verification) return;

  const sent = await sendAdmissionRulesDm(
    api,
    Number(verification.tgUserId),
    verificationId,
    group,
    groupTitle,
  );
  if (!sent) {
    logger.warn(
      { verificationId: verification.verificationId },
      "Failed to send admission rules DM — user may have blocked the bot",
    );
  }

  await transitionState(verificationId, VerificationState.RULES_PENDING, {
    expiresAt: new Date(Date.now() + config.constants.RULES_PENDING_TTL_MS),
  });

  logger.info(
    {
      verificationId: verification.verificationId,
      groupId: group.groupId,
      entryType: verification.entryType,
    },
    "User passed verification — awaiting rules agreement before admission",
  );

  if (verification.advertiserId != null && verification.lockedBidPrice != null) {
    try {
      const accrual = await accrueVerificationPayout(verification.verificationId);
      if (accrual?.exhausted) {
        await promoteNextBidder(api, accrual.groupId, "exhausted", accrual.advertiserTgId);
      }
    } catch (err) {
      logger.error({ err, verificationId: verification.verificationId }, "Payout accrual failed");
    }
  }
}

/** Runs after the user taps "I agree" on the post-verification rules gate. */
export async function completeAdmission(
  api: Api,
  verificationId: string,
  group: GroupRow,
): Promise<boolean> {
  const verification = await getVerificationByToken(verificationId);
  if (!verification) return false;

  const chatId = Number(group.tgGroupId);
  const userId = Number(verification.tgUserId);
  const groupTitle = group.groupTitle ?? "the group";

  if (verification.entryType === "join_request") {
    await approveJoinRequest(api, chatId, userId);
  } else {
    await admitUser(api, chatId, userId);
    await deleteWelcomeGateMessage(api, chatId, group.groupId);
  }

  await transitionState(verificationId, VerificationState.ADMITTED);

  try {
    await api.sendMessage(
      userId,
      verification.entryType === "join_request"
        ? `✅ You're in! Your join request for **${groupTitle}** has been approved.`
        : `✅ You're in! You can now chat in **${groupTitle}**.`,
      { parse_mode: "Markdown" },
    );
  } catch {
    /* user may have blocked the bot */
  }

  logger.info(
    { verificationId, groupId: group.groupId, entryType: verification.entryType },
    "User admitted after rules agreement",
  );
  return true;
}

export async function completeVerificationFail(
  api: Api,
  verification: { verificationId: string; entryType: string; tgUserId: bigint },
  group: GroupRow,
): Promise<void> {
  const chatId = Number(group.tgGroupId);
  const userId = Number(verification.tgUserId);

  if (verification.entryType === "join_request") {
    await declineJoinRequest(api, chatId, userId);
    logger.info(
      { verificationId: verification.verificationId, groupId: group.groupId },
      "Join request declined after captcha fail",
    );
    return;
  }

  await rejectUser(api, chatId, userId);
  await deleteWelcomeGateMessage(api, chatId, group.groupId);
  logger.info(
    { verificationId: verification.verificationId, groupId: group.groupId },
    "User kicked after captcha fail (open join)",
  );
}

export async function completeVerificationTimeout(
  api: Api,
  entryType: string,
  group: GroupRow,
  tgUserId: bigint,
): Promise<void> {
  const chatId = Number(group.tgGroupId);
  const userId = Number(tgUserId);
  const groupTitle = group.groupTitle ?? "the group";

  if (entryType === "join_request") {
    await declineJoinRequest(api, chatId, userId);
    try {
      await api.sendMessage(
        userId,
        `⏳ Your verification for **${groupTitle}** timed out. You're welcome to request to join again.`,
        { parse_mode: "Markdown" },
      );
    } catch { /* user may have blocked the bot */ }
    return;
  }

  await rejectUser(api, chatId, userId);
  await deleteWelcomeGateMessage(api, chatId, group.groupId);
  try {
    await api.sendMessage(
      userId,
      `⏳ Your verification for **${groupTitle}** timed out. Feel free to try joining again.`,
      { parse_mode: "Markdown" },
    );
  } catch { /* user may have blocked the bot */ }
}
