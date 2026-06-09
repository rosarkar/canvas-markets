import { Bot } from "grammy";

import { getGroupByTgId } from "@/adapters/groups.adapter.js";
import {
  getActiveVerificationForUser,
  hasPassedVerification,
} from "@/adapters/verification.adapter.js";

export function registerMessageHandler(bot: Bot): void {
  bot.on("message", async (ctx, next) => {
    const chat = ctx.chat;
    const from = ctx.from;
    if (!from || from.is_bot) {
      await next();
      return;
    }

    if (chat.type !== "group" && chat.type !== "supergroup") {
      await next();
      return;
    }

    if (ctx.message.text?.startsWith("/")) {
      await next();
      return;
    }

    const group = await getGroupByTgId(BigInt(chat.id));
    if (!group?.isActive) {
      await next();
      return;
    }

    if (await hasPassedVerification(BigInt(from.id), group.groupId)) {
      await next();
      return;
    }

    const active = await getActiveVerificationForUser(BigInt(from.id), group.groupId);
    if (!active || active.entryType !== "open_join") {
      await next();
      return;
    }

    try {
      await ctx.deleteMessage();
    } catch {
      /* may lack delete permission */
    }
  });
}
