import type { Api } from "grammy";

import type { GroupRow } from "@/adapters/groups.adapter.js";
import type { VerificationRow } from "@/adapters/verification.adapter.js";
import {
  admitUser,
  approveJoinRequest,
  declineJoinRequest,
  rejectUser,
} from "@/telegram/verification-actions.js";
import {
  deleteWelcomeGateMessage,
} from "@/telegram/services/welcome-gate.js";
import { logger } from "@/utils/logger.js";

export async function completeVerificationPass(
  api: Api,
  verification: VerificationRow,
  group: GroupRow,
  _groupTitle: string,
  _botUsername: string,
): Promise<void> {
  const chatId = Number(group.tgGroupId);
  const userId = Number(verification.tgUserId);

  if (verification.entryType === "join_request") {
    await approveJoinRequest(api, chatId, userId);
    logger.info(
      { verificationId: verification.verificationId, groupId: group.groupId },
      "Join request approved after captcha pass",
    );
    return;
  }

  await admitUser(api, chatId, userId);
  await deleteWelcomeGateMessage(api, chatId, group.groupId);
  logger.info(
    { verificationId: verification.verificationId, groupId: group.groupId },
    "User admitted after captcha pass (open join)",
  );
}

export async function completeVerificationFail(
  api: Api,
  verification: VerificationRow,
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
  entryType: VerificationRow["entryType"],
  group: GroupRow,
  tgUserId: bigint,
): Promise<void> {
  const chatId = Number(group.tgGroupId);
  const userId = Number(tgUserId);

  if (entryType === "join_request") {
    await declineJoinRequest(api, chatId, userId);
    return;
  }

  await rejectUser(api, chatId, userId);
  await deleteWelcomeGateMessage(api, chatId, group.groupId);
}
