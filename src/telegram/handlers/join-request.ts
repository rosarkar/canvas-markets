import { Bot } from "grammy";

import { getGroupByTgId } from "@/adapters/groups.adapter.js";
import {
  getActiveVerificationForUser,
  hasPassedVerification,
  hasRecentGroupAttempt,
  isUserInCooldown,
  logCooldownRejection,
} from "@/adapters/verification.adapter.js";
import { beginVerification } from "@/telegram/services/begin-verification.js";
import { declineJoinRequest } from "@/telegram/verification-actions.js";
import { logger } from "@/utils/logger.js";

export function registerJoinRequestHandler(bot: Bot): void {
  bot.on("chat_join_request", async (ctx) => {
    const request = ctx.chatJoinRequest;
    if (!request) return;

    const { chat, from: user } = request;
    if (user.is_bot) return;
    if (chat.type === "channel") return;

    const tgGroupId = BigInt(chat.id);
    const tgUserId = BigInt(user.id);
    const group = await getGroupByTgId(tgGroupId);

    if (!group?.isActive) {
      logger.info(
        { tgGroupId: tgGroupId.toString(), tgUserId: tgUserId.toString() },
        "Join request ignored — group not registered",
      );
      return;
    }

    if (await hasPassedVerification(tgUserId, group.groupId)) {
      await ctx.api.approveChatJoinRequest(chat.id, user.id);
      return;
    }

    if (await isUserInCooldown(tgUserId, group.groupId)) {
      await logCooldownRejection(tgUserId, group.groupId, "group_cooldown_24h", "join_request");
      await declineJoinRequest(ctx.api, chat.id, user.id);
      return;
    }

    if (await getActiveVerificationForUser(tgUserId, group.groupId)) {
      logger.info(
        { tgUserId: tgUserId.toString(), groupId: group.groupId },
        "Join request skipped — verification already active",
      );
      return;
    }

    // Per-group rate limit: one verification attempt per handle per group per 12h.
    // Checked AFTER the active-verification resume path so in-flight attempts aren't
    // rejected by their own row.
    if (await hasRecentGroupAttempt(tgUserId, group.groupId)) {
      logger.info(
        { tgUserId: tgUserId.toString(), groupId: group.groupId },
        "Join request declined — per-group 12h attempt limit",
      );
      await logCooldownRejection(tgUserId, group.groupId, "attempt_limit_12h", "join_request");
      await declineJoinRequest(ctx.api, chat.id, user.id);
      return;
    }

    const title = "title" in chat ? (chat.title ?? "the group") : "the group";

    logger.info(
      { tgGroupId: chat.id, tgUserId: user.id, groupId: group.groupId },
      "chat_join_request received",
    );

    await beginVerification(ctx.api, user, group, title, "join_request");
  });
}
