import { Bot } from "grammy";

import { getGroupById } from "@/adapters/groups.adapter.js";
import { getVerificationByToken, transitionState } from "@/adapters/verification.adapter.js";
import { passesThreshold, scoreWithKimi } from "@/services/scoring.js";
import { VerificationState } from "@/services/verification-states.js";
import { logger } from "@/utils/logger.js";

export function registerMessageHandler(bot: Bot): void {
  bot.on("message:text", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    if (ctx.message.text.startsWith("/")) return;

    const tgUserId = BigInt(ctx.from.id);
    const responseText = ctx.message.text.trim();
    if (!responseText) return;

    // Find in-flight verification awaiting response
    const client = await import("@/db.js").then((m) => m.db);
    const res = await client.query(
      `SELECT verification_id FROM verifications
       WHERE tg_user_id = $1 AND state = 'TASK_SENT'
       ORDER BY updated_at DESC LIMIT 1`,
      [tgUserId.toString()],
    );
    const verificationId = res.rows[0]?.verification_id as string | undefined;
    if (!verificationId) return;

    const verification = await getVerificationByToken(verificationId);
    if (!verification || verification.state !== VerificationState.TASK_SENT) return;

    const group = await getGroupById(verification.groupId);
    if (!group) return;

    await transitionState(verificationId, VerificationState.RESPONSE_RECEIVED, { responseText });

    // Step ① — onchain log (stub until contract is deployed)
    await transitionState(verificationId, VerificationState.STEP1_FIRED);
    // TODO: call escrow contract logAttempt(sessionId, groupId, advertiserId)

    await transitionState(verificationId, VerificationState.SCORING);
    const taskText = group.verificationTaskText;
    const scoreResult = await scoreWithKimi(taskText, responseText);

    if (passesThreshold(scoreResult)) {
      await transitionState(verificationId, VerificationState.PASSED, {
        kimiScore: scoreResult.score,
      });

      // Step ② — payout (stub until contract is deployed)
      // TODO: releasePayout(sessionId, ownerWallet, lockedBidPrice)

      try {
        await ctx.api.unbanChatMember(Number(group.tgGroupId), Number(tgUserId));
      } catch {
        /* user may already be a member */
      }

      await ctx.reply("✅ Verified! You can return to the group.");
      logger.info({ verificationId, score: scoreResult.score, method: scoreResult.method }, "User passed");
    } else {
      await transitionState(verificationId, VerificationState.FAILED, {
        kimiScore: scoreResult.score,
      });
      await ctx.reply("Your response didn't meet the verification threshold. You can try again in 24 hours.");
      try {
        await ctx.api.banChatMember(Number(group.tgGroupId), Number(tgUserId));
        await ctx.api.unbanChatMember(Number(group.tgGroupId), Number(tgUserId));
      } catch (err) {
        logger.warn({ err }, "Failed to kick failed verification user");
      }
    }
  });
}
