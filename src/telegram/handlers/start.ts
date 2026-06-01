import { Bot } from "grammy";

import { getTopBidForGroup } from "@/adapters/bidding.js";
import { getGroupById } from "@/adapters/groups.adapter.js";
import {
  getVerificationByToken,
  transitionState,
} from "@/adapters/verification.adapter.js";
import { VerificationState } from "@/services/verification-states.js";
import { fromMicroUnits } from "@/utils/usdc.js";
import { logger } from "@/utils/logger.js";

export function registerStartHandler(bot: Bot): void {
  bot.command("start", async (ctx) => {
    const payload = ctx.match?.trim() ?? "";
    if (!payload.startsWith("verify_")) {
      await ctx.reply(
        "Canvas AI — monetise your Telegram group gating.\n\n" +
          "Group owners: send /register\n" +
          "Advertisers: send /buy",
      );
      return;
    }

    const token = payload.replace("verify_", "");
    const verification = await getVerificationByToken(token);
    if (!verification) {
      await ctx.reply("This verification link is invalid or expired.");
      return;
    }

    if (verification.state !== VerificationState.PENDING && verification.state !== VerificationState.DEEP_LINK_SENT) {
      await ctx.reply("This verification session is no longer active.");
      return;
    }

    const group = await getGroupById(verification.groupId);
    if (!group) {
      await ctx.reply("Group not found.");
      return;
    }

    const topBid = await getTopBidForGroup(group.groupId);
    const taskText =
      topBid?.taskText ??
      group.verificationTaskText;

    const lockedPrice = topBid?.bidPerVerification ?? null;

    await transitionState(token, VerificationState.TASK_SENT, {
      lockedBidPrice: lockedPrice ?? undefined,
    });

    const earningHint =
      lockedPrice != null
        ? `\n\n_(Group owner earns ${fromMicroUnits(lockedPrice)} per verified join)_`
        : "";

    await ctx.reply(`${taskText}\n\nReply to this message with your answer.${earningHint}`, {
      parse_mode: "Markdown",
    });

    logger.info({ verificationId: token, groupId: group.groupId }, "Task sent via DM");
  });

  bot.command("register", async (ctx) => {
    await ctx.reply(
      "Group owner registration — coming in next build step.\n\n" +
        "You'll provide: group link, Base payout wallet, and a fallback verification question.",
    );
  });

  bot.command("buy", async (ctx) => {
    await ctx.reply(
      "Advertiser buy flow — coming in next build step.\n\n" +
        "You'll select groups, set bid per verification, and fund escrow.",
    );
  });
}
