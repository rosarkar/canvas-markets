import { Bot } from "grammy";

import { handleMemberJoin } from "@/telegram/services/group-join-captcha.js";
import { logger } from "@/utils/logger.js";

const JOIN_FROM_STATUSES = new Set(["left", "kicked"]);

export function registerJoinHandler(bot: Bot): void {
  // chat_member is the reliable join signal when the bot is a group admin.
  // Do not also handle new_chat_members — it duplicates the same join.
  bot.on("chat_member", async (ctx) => {
    const update = ctx.chatMember;
    if (!update) return;

    const { new_chat_member: member, old_chat_member: oldMember, chat } = update;
    if (member.status !== "member" || member.user.is_bot) return;
    if (!JOIN_FROM_STATUSES.has(oldMember.status)) return;

    logger.info(
      {
        tgGroupId: chat.id,
        tgUserId: member.user.id,
        oldStatus: oldMember.status,
      },
      "chat_member join detected",
    );

    const title = "title" in chat ? chat.title : undefined;
    await handleMemberJoin(ctx.api, chat.id, member.user, title);
  });
}
