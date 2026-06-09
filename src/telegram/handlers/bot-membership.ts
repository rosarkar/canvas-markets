import { Bot } from "grammy";

import { autoRegisterGroupOnBotAdd } from "@/telegram/handlers/register.js";
import { logger } from "@/utils/logger.js";

export function registerBotMembershipHandler(bot: Bot): void {
  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.myChatMember;
    if (!update) return;

    const { chat, new_chat_member: member, old_chat_member: oldMember } = update;
    if (chat.type !== "group" && chat.type !== "supergroup") return;

    const becameAdmin =
      member.status === "administrator" && oldMember.status !== "administrator";

    if (!becameAdmin) return;

    const addedBy = ctx.from?.id;
    if (!addedBy) return;

    logger.info(
      { tgGroupId: chat.id, title: chat.title, addedBy },
      "Bot added as group admin",
    );

    await autoRegisterGroupOnBotAdd(bot, chat.id, chat.title ?? "Group", addedBy);
  });
}
