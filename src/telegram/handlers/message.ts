import { Bot } from "grammy";

import { getGroupByTgId, getGroupById } from "@/adapters/groups.adapter.js";
import {
  getActiveDmVerificationForUser,
  getActiveRulesGateVerificationForUser,
  getActiveVerificationForUser,
  getVerificationByToken,
  hasPassedVerification,
  transitionState,
} from "@/adapters/verification.adapter.js";
import { VerificationState } from "@/services/verification-states.js";
import { hasActiveBuyAgentSession } from "@/telegram/handlers/buy-agent.js";
import { hasActiveBuySession } from "@/telegram/handlers/buy.js";
import { hasActiveRulesSession } from "@/telegram/handlers/rules-setup.js";
import { parseWebAppData } from "@/telegram/handlers/webapp-data.js";
import { resendVerificationDm } from "@/telegram/services/begin-verification.js";
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

    // Rules-gate "I agree" / open-text verification replies in DM
    if (chat.type === "private" && ctx.message.text && !ctx.message.text.startsWith("/")) {
      if (
        !hasActiveBuySession(from.id) &&
        !hasActiveBuyAgentSession(from.id) &&
        !hasActiveRulesSession(from.id)
      ) {
        const text = ctx.message.text.trim();
        const handledRules = await handleRulesAgreementResponse(ctx, text);
        if (handledRules) return;
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

  const chat = await ctx.api.getChat(Number(group.tgGroupId));
  const groupTitle =
    chat.type !== "private" && "title" in chat ? (chat.title ?? "the group") : "the group";

  const result = await processTextVerificationResponse(ctx.api, verification, text);

  if (result.outcome === "re_prompted") {
    // Re-prompt message was already sent inside processTextVerificationResponse.
    return true;
  }

  if (result.outcome === "passed") {
    await ctx.reply(
      verification.entryType === "join_request"
        ? `✅ You're in! Your join request for **${groupTitle}** has been approved.`
        : `✅ You're in! You can now chat in **${groupTitle}**.`,
      { parse_mode: "Markdown" },
    );
  } else {
    await ctx.reply(
      `❌ Verification unsuccessful for **${groupTitle}**. You can try again in 24 hours.`,
      { parse_mode: "Markdown" },
    );
  }

  return true;
}

function isAgreementText(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!]+$/, "");
  return normalized === "i agree" || normalized.startsWith("i agree");
}

async function handleRulesAgreementResponse(
  ctx: { from: { id: number }; api: import("grammy").Bot["api"]; reply: (text: string, extra?: object) => Promise<unknown> },
  text: string,
): Promise<boolean> {
  if (!text) return false;

  const verification = await getActiveRulesGateVerificationForUser(BigInt(ctx.from.id));
  if (!verification) return false;

  if (!isAgreementText(text)) {
    await ctx.reply("Please type **I agree** to continue.", { parse_mode: "Markdown" });
    return true;
  }

  const group = await getGroupById(verification.groupId);
  if (!group) return false;

  await transitionState(verification.verificationId, VerificationState.TASK_SENT);

  const chat = await ctx.api.getChat(Number(group.tgGroupId));
  const groupTitle =
    chat.type !== "private" && "title" in chat ? (chat.title ?? "the group") : "the group";

  const sent = await resendVerificationDm(ctx.api, ctx.from.id, verification.verificationId, groupTitle);
  if (!sent) {
    logger.warn(
      { verificationId: verification.verificationId },
      "Failed to send task DM after rules agreement",
    );
  }
  return true;
}

async function handleWebAppData(ctx: {
  from: { id: number };
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

  await transitionState(verification.verificationId, VerificationState.RESPONSE_RECEIVED, {
    responseText: parsed.optionLabel,
  });

  const chat = await ctx.api.getChat(Number(group.tgGroupId));
  const groupTitle =
    chat.type !== "private" && "title" in chat ? (chat.title ?? "the group") : "the group";
  const me = await ctx.api.getMe();
  const botUsername = me.username ?? "CanvasProtocolBot";

  await transitionState(verification.verificationId, VerificationState.PASSED);
  await completeVerificationPass(ctx.api, verification.verificationId, group, groupTitle, botUsername);

  await ctx.reply(`✅ You're in! You can now chat in **${groupTitle}**.`, { parse_mode: "Markdown" });
  logger.info(
    { verificationId: verification.verificationId, optionId: parsed.optionId },
    "User passed webapp verification",
  );
  return true;
}
