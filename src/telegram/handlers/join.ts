import { Bot } from "grammy";

import { getTopBidForGroup } from "@/adapters/bidding.js";
import { getGroupByTgId } from "@/adapters/groups.adapter.js";
import {
  createVerification,
  isUserInCooldown,
  transitionState,
} from "@/adapters/verification.adapter.js";
import { VerificationState } from "@/services/verification-states.js";
import { logger } from "@/utils/logger.js";

export function registerJoinHandler(bot: Bot): void {
  bot.on("chat_member", async (ctx) => {
    const update = ctx.chatMember;
    if (!update) return;

    const { new_chat_member: member, chat } = update;
    if (member.status !== "member" || member.user.is_bot) return;

    const tgGroupId = BigInt(chat.id);
    const tgUserId = BigInt(member.user.id);

    const group = await getGroupByTgId(tgGroupId);
    if (!group?.isActive) return;

    if (await isUserInCooldown(tgUserId, group.groupId)) {
      try {
        await ctx.api.banChatMember(chat.id, Number(tgUserId));
        await ctx.api.unbanChatMember(chat.id, Number(tgUserId));
      } catch (err) {
        logger.warn({ err, tgUserId: tgUserId.toString() }, "Failed to kick cooldown user");
      }
      return;
    }

    const topBid = await getTopBidForGroup(group.groupId);
    const verification = await createVerification({
      tgUserId,
      groupId: group.groupId,
      advertiserId: topBid?.advertiserId ?? null,
    });

    const botUsername = (await ctx.api.getMe()).username ?? "canvasbot";
    const deepLink = `https://t.me/${botUsername}?start=verify_${verification.verificationId}`;

    try {
      await ctx.api.sendMessage(
        chat.id,
        `Welcome! Complete verification to join this group.`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: "Verify to join", url: deepLink }]],
          },
        },
      );
      await transitionState(verification.verificationId, VerificationState.DEEP_LINK_SENT);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, tgGroupId: tgGroupId.toString() }, "Failed to post welcome message");
      if (msg.includes("not enough rights")) {
        // Bot admin loss — pause group (notify owner in follow-up)
        logger.error(`Bot lost admin in group ${group.groupId}`);
      }
    }
  });
}
