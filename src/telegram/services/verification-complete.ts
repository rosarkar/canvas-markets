import type { Api } from "grammy";

import type { GroupRow } from "@/adapters/groups.adapter.js";
import { getVerificationByToken } from "@/adapters/verification.adapter.js";
import { accrueVerificationPayout } from "@/adapters/payout.adapter.js";
import { promoteNextBidder } from "@/services/bid-ladder.js";
import {
  admitUser,
  approveJoinRequest,
  declineJoinRequest,
  rejectUser,
} from "@/telegram/verification-actions.js";
import { deleteWelcomeGateMessage } from "@/telegram/services/welcome-gate.js";
import { logger } from "@/utils/logger.js";

export async function completeVerificationPass(
  api: Api,
  verificationId: string,
  group: GroupRow,
  _groupTitle: string,
  _botUsername: string,
): Promise<void> {
  const verification = await getVerificationByToken(verificationId);
  if (!verification) return;

  const chatId = Number(group.tgGroupId);
  const userId = Number(verification.tgUserId);

  if (verification.entryType === "join_request") {
    await approveJoinRequest(api, chatId, userId);
    logger.info(
      { verificationId: verification.verificationId, groupId: group.groupId },
      "Join request approved after captcha pass",
    );
  } else {
    await admitUser(api, chatId, userId);
    await deleteWelcomeGateMessage(api, chatId, group.groupId);
    logger.info(
      { verificationId: verification.verificationId, groupId: group.groupId },
      "User admitted after captcha pass (open join)",
    );
  }

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
