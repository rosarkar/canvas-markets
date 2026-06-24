import type { Api, Bot } from "grammy";
import { InlineKeyboard } from "grammy";

import {
  getGroupById,
  getGroupsByOwnerTgId,
  updateGroupRules,
  type GroupRow,
} from "@/adapters/groups.adapter.js";
import {
  buildInitialRulesPrompt,
  draftOrReviseRules,
  formatRulesList,
} from "@/services/rules-assistant.js";
import type { KimiMessage } from "@/services/scoring.js";
import { logger } from "@/utils/logger.js";

type Stage = "awaiting_intro" | "revising";

interface RulesSession {
  groupId: number;
  groupTitle: string;
  stage: Stage;
  messages: KimiMessage[];
  latestRules: string[];
}

const sessions = new Map<number, RulesSession>();

export function hasActiveRulesSession(userId: number): boolean {
  return sessions.has(userId);
}

const INTRO_PROMPT =
  "Two quick things, in one message: what's the group for, and is there anything you've had " +
  "problems with (or want to prevent) — spam, scam links, price calls, tone, anything?";

/** Kicks off the rules conversation in DM. Returns false if the owner can't be reached. */
export async function startRulesSetup(
  api: Api,
  ownerTgId: number,
  group: GroupRow,
  groupTitle: string,
): Promise<boolean> {
  sessions.set(ownerTgId, {
    groupId: group.groupId,
    groupTitle,
    stage: "awaiting_intro",
    messages: [],
    latestRules: [],
  });

  try {
    await api.sendMessage(
      ownerTgId,
      `🛡️ Let's set up rules for **${groupTitle}**.\n\n${INTRO_PROMPT}`,
      { parse_mode: "Markdown" },
    );
    return true;
  } catch {
    sessions.delete(ownerTgId);
    return false;
  }
}

async function draftAndSend(
  ctx: { reply: (text: string, extra?: object) => Promise<unknown> },
  fromId: number,
  session: RulesSession,
): Promise<void> {
  try {
    const rules = await draftOrReviseRules(session.messages);
    session.messages.push({ role: "assistant", content: JSON.stringify({ rules }) });
    session.latestRules = rules;
    session.stage = "revising";
    sessions.set(fromId, session);

    await ctx.reply(
      `Here's a draft rule set for **${session.groupTitle}**:\n\n${formatRulesList(rules)}\n\n` +
        'Want to change anything? Tell me in plain language (e.g. "drop rule 2" or "add something about scam links"), or type **confirm** if this looks good.',
      { parse_mode: "Markdown" },
    );
  } catch (err) {
    logger.error({ err, fromId }, "Kimi rules drafting failed");
    await ctx.reply(
      "Sorry, I couldn't draft rules right now — Kimi may be unavailable. Try again in a bit with /rules.",
    );
    sessions.delete(fromId);
  }
}

export function registerRulesSetupHandler(bot: Bot): void {
  bot.command("rules", async (ctx) => {
    const fromId = ctx.from?.id;
    if (!fromId || ctx.chat?.type !== "private") {
      await ctx.reply("Send /rules to me in a private chat to set up your group's rules.");
      return;
    }

    const groups = await getGroupsByOwnerTgId(BigInt(fromId));
    if (groups.length === 0) {
      await ctx.reply("No registered groups found for your account. Register a group first with /register inside it.");
      return;
    }

    if (groups.length === 1) {
      const group = groups[0]!;
      let title = group.groupTitle ?? "your group";
      try {
        const chat = await ctx.api.getChat(Number(group.tgGroupId));
        if (chat.type !== "private" && "title" in chat) title = chat.title ?? title;
      } catch {
        /* ignore */
      }
      const started = await startRulesSetup(ctx.api, fromId, group, title);
      if (!started) await ctx.reply("Could not start the rules conversation. Try again.");
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const group of groups) {
      let title = group.groupTitle ?? `Group #${group.groupId}`;
      try {
        const chat = await ctx.api.getChat(Number(group.tgGroupId));
        if (chat.type !== "private" && "title" in chat) title = chat.title ?? title;
      } catch {
        /* ignore */
      }
      keyboard.text(title, `rules:pick:${group.groupId}:${encodeURIComponent(title)}`).row();
    }
    await ctx.reply("Which group are these rules for?", { reply_markup: keyboard });
  });

  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith("rules:pick:")) {
      await next();
      return;
    }
    const fromId = ctx.from.id;
    const parts = data.split(":");
    const groupId = Number(parts[2]);
    const title = decodeURIComponent(parts[3] ?? `Group #${groupId}`);

    const group = await getGroupById(groupId);
    if (!group || group.ownerTgId !== BigInt(fromId)) {
      await ctx.answerCallbackQuery({ text: "Group not found.", show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    const started = await startRulesSetup(ctx.api, fromId, group, title);
    if (!started) await ctx.reply("Could not start the rules conversation. Try again.");
  });

  bot.on("message:text", async (ctx, next) => {
    const fromId = ctx.from?.id;
    if (!fromId || ctx.chat?.type !== "private") {
      await next();
      return;
    }

    const session = sessions.get(fromId);
    if (!session || ctx.message.text.startsWith("/")) {
      await next();
      return;
    }

    const text = ctx.message.text.trim();

    if (session.stage === "awaiting_intro") {
      const group = await getGroupById(session.groupId);
      const topic = group?.verificationTaskText?.trim() || "general crypto community";
      session.messages.push({
        role: "user",
        content: buildInitialRulesPrompt(session.groupTitle, topic, text),
      });
      await draftAndSend(ctx, fromId, session);
      return;
    }

    // stage === "revising"
    if (text.toLowerCase() === "confirm") {
      if (session.latestRules.length === 0) {
        await ctx.reply("No draft to confirm yet — let's start over. Send /rules.");
        sessions.delete(fromId);
        return;
      }
      await updateGroupRules(session.groupId, session.latestRules);
      await ctx.reply(
        `✅ Saved! Here's the final rule set for **${session.groupTitle}**:\n\n` +
          `${formatRulesList(session.latestRules)}\n\n` +
          "New members will see these before completing verification.",
        { parse_mode: "Markdown" },
      );
      logger.info(
        { groupId: session.groupId, fromId, ruleCount: session.latestRules.length },
        "Group rules confirmed and saved",
      );
      sessions.delete(fromId);
      return;
    }

    session.messages.push({ role: "user", content: text });
    await draftAndSend(ctx, fromId, session);
  });
}
