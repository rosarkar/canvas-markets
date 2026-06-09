import { Bot } from "grammy";

import { handleMemberJoin } from "@/telegram/services/group-join-captcha.js";
import { logger } from "@/utils/logger.js";

const JOIN_FROM_STATUSES = new Set(["left", "kicked"]);

export function registerJoinHandler(bot: Bot): void {
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

    await handleMemberJoin(ctx.api, chat.id, member.user);
  });

  bot.on("message:new_chat_members", async (ctx) => {
    const members = ctx.message.new_chat_members;
    if (!members?.length) return;

    logger.info(
      { tgGroupId: ctx.chat.id, count: members.length },
      "new_chat_members join detected",
    );

    for (const member of members) {
      await handleMemberJoin(ctx.api, ctx.chat.id, member);
    }
  });
}
