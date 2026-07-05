import { Bot } from "grammy";

import { getGroupByTgId, getGroupById } from "@/adapters/groups.adapter.js";
import {
  getActiveDmVerificationForUser,
  getActiveVerificationForUser,
  getVerificationByToken,
  hasPassedVerification,
  transitionState,
} from "@/adapters/verification.adapter.js";
import { VerificationState } from "@/services/verification-states.js";
import { hasActiveBuyAgentSession } from "@/telegram/handlers/buy-agent.js";
import { hasActiveBuySession } from "@/telegram/handlers/buy.js";
import { hasActivePendingMenuWallet } from "@/telegram/handlers/menu.js";
import { hasActivePendingRulesPrompt } from "@/telegram/handlers/register.js";
import { parseWebAppData } from "@/telegram/handlers/webapp-data.js";
import {
  completeVerificationFail,
  completeVerificationPass,
} from "@/telegram/services/verification-complete.js";
import { processTextVerificationResponse } from "@/telegram/services/process-text-response.js";
import { logger } from "@/utils/logger.js";

export function registerMessageHandler(bot: Bot): void {
  bot.on("message", async (ctx, next) => {
    const chat = ctx.chat;
    const from = ctx.from;
    if (!from || from.is_bot) {
      await next();
      return;
    }

    // Mini App completion data (preference_webapp tasks)
    if (chat.type === "private" && ctx.message.web_app_data?.data) {
      const handled = await handleWebAppData(ctx);
      if (handled) return;
      await next();
      return;
    }

    // Open-text/rank/binary-reasoning verification replies in DM
    if (chat.type === "private" && ctx.message.text && !ctx.message.text.startsWith("/")) {
      if (
        !hasActiveBuySession(from.id) &&
        !hasActiveBuyAgentSession(from.id) &&
        !hasActivePendingRulesPrompt(from.id) &&
        !hasActivePendingMenuWallet(from.id)
      ) {
        const text = ctx.message.text.trim();
        const handled = await handleDmTextResponse(ctx, text);
        if (handled) return;
      }
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

async function handleDmTextResponse(
  ctx: { from: { id: number }; api: import("grammy").Bot["api"]; reply: (text: string, extra?: object) => Promise<unknown> },
  text: string,
): Promise<boolean> {
  if (!text) return false;

  const verification = await getActiveDmVerificationForUser(BigInt(ctx.from.id));
  if (!verification) return false;

  const group = await getGroupById(verification.groupId);
  if (!group) return false;

  const groupTitle = group.groupTitle ?? "the group";

  const result = await processTextVerificationResponse(ctx.api, verification, text);

  if (result.outcome === "re_prompted") {
    // Re-prompt message was already sent inside processTextVerificationResponse.
    return true;
  }

  if (result.outcome === "already_processed") {
    // A concurrent update won the compare-and-swap — it owns all user-facing replies.
    return true;
  }

  // On "passed", no reply here — completeVerificationPass (called inside
  // processTextVerificationResponse) sends the rules-agreement DM, which gates
  // admission until the user taps "I agree".
  if (result.outcome !== "passed") {
    await ctx.reply(
      `❌ Verification unsuccessful for **${groupTitle}**. You can try again in 24 hours.`,
      { parse_mode: "Markdown" },
    );
  }

  return true;
}

async function handleWebAppData(ctx: {
  from: { id: number };
  me: { username?: string };
  message: { web_app_data?: { data: string } };
  api: import("grammy").Bot["api"];
  reply: (text: string, extra?: object) => Promise<unknown>;
}): Promise<boolean> {
  const raw = ctx.message.web_app_data?.data;
  if (!raw) return false;

  const parsed = parseWebAppData(raw);
  if (!parsed) return false;

  const verification = await getVerificationByToken(parsed.verificationId);
  if (!verification) return false;
  if (verification.tgUserId !== BigInt(ctx.from.id)) return false;
  if (
    verification.state !== VerificationState.TASK_SENT &&
    verification.state !== VerificationState.DEEP_LINK_SENT
  ) {
    return false;
  }

  const group = await getGroupById(verification.groupId);
  if (!group) return false;

  // Compare-and-swap: bail if a concurrent update already claimed this verification.
  const claimed = await transitionState(verification.verificationId, VerificationState.RESPONSE_RECEIVED, {
    responseText: parsed.optionLabel,
    expectedState: [VerificationState.TASK_SENT, VerificationState.DEEP_LINK_SENT],
  });
  if (!claimed) return true;

  // No Telegram round trips: title from the group row, username from ctx.me (cached).
  const groupTitle = group.groupTitle ?? "the group";
  const botUsername = ctx.me.username ?? "CanvasProtocolBot";

  const marked = await transitionState(verification.verificationId, VerificationState.PASSED, {
    expectedState: VerificationState.RESPONSE_RECEIVED,
  });
  if (!marked) return true;
  await completeVerificationPass(ctx.api, verification.verificationId, group, groupTitle, botUsername);

  // No reply here — completeVerificationPass sends the rules-agreement DM, which
  // gates admission until the user taps "I agree".
  logger.info(
    { verificationId: verification.verificationId, optionId: parsed.optionId },
    "User passed webapp verification",
  );
  return true;
}
