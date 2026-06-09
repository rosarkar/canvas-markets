import type { Api } from "grammy";
import type { User } from "@grammyjs/types";

import { getGroupByTgId } from "@/adapters/groups.adapter.js";
import {
  getActiveVerificationForUser,
  getRecentlyPassedVerification,
  hasPassedVerification,
  isUserInCooldown,
} from "@/adapters/verification.adapter.js";
import { beginVerification } from "@/telegram/services/begin-verification.js";
import { rejectUser } from "@/telegram/verification-actions.js";
import { logger } from "@/utils/logger.js";

export async function handleMemberJoin(
  api: Api,
  chatId: number | bigint,
  user: User,
  groupTitle?: string,
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

  // Post-approve dedup: chat_member fires after approveChatJoinRequest
  if (await getRecentlyPassedVerification(tgUserId, group.groupId)) {
    logger.info(
      { tgUserId: tgUserId.toString(), groupId: group.groupId },
      "Join skipped — recently approved via join request",
    );
    return;
  }

  if (await hasPassedVerification(tgUserId, group.groupId)) {
    logger.info({ tgUserId: tgUserId.toString(), groupId: group.groupId }, "Join skipped — already verified");
    return;
  }

  if (await isUserInCooldown(tgUserId, group.groupId)) {
    logger.info({ tgUserId: tgUserId.toString(), groupId: group.groupId }, "Join rejected — cooldown");
    await rejectUser(api, chatId, tgUserId);
    return;
  }

  const active = await getActiveVerificationForUser(tgUserId, group.groupId);
  if (active) {
    if (active.entryType === "join_request") {
      logger.info(
        { tgUserId: tgUserId.toString(), groupId: group.groupId },
        "Join skipped — join-request verification in progress",
      );
      return;
    }
    logger.info({ tgUserId: tgUserId.toString(), groupId: group.groupId }, "Join skipped — verification in progress");
    return;
  }

  const title = groupTitle ?? "the group";
  await beginVerification(api, user, group, title, "open_join");
}
