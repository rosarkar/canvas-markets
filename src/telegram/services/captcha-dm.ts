import type { Api, Bot } from "grammy";
import { InlineKeyboard } from "grammy";

import { config } from "@/config/index.js";
import type { GroupRow } from "@/adapters/groups.adapter.js";
import { buildCaptchaCallbackData } from "@/services/captcha-questions.js";
import {
  TaskType,
  type BinaryReasoningPayload,
  type PreferenceMcPayload,
  type PreferenceWebAppPayload,
  type RankReasoningPayload,
  type ResolvedVerificationTask,
  type TriviaMcPayload,
} from "@/services/verification-tasks.js";

function miniAppBaseUrl(): string {
  if (process.env.MINI_APP_BASE_URL?.trim()) {
    return process.env.MINI_APP_BASE_URL.trim().replace(/\/$/, "");
  }
  const webhook = config.telegram.webhookUrl;
  try {
    const url = new URL(webhook);
    return url.origin;
  } catch {
    return "http://localhost:3000";
  }
}

function buildMcKeyboard(
  verificationId: string,
  options: { id: string; label: string }[],
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const option of options) {
    keyboard.text(option.label, buildCaptchaCallbackData(verificationId, option.id)).row();
  }
  return keyboard;
}

function formatPreferencePrompt(payload: PreferenceMcPayload): string {
  const lines = [payload.prompt, "", "Choose the option that best describes you:"];
  for (const opt of payload.options) {
    if (opt.description) {
      lines.push(`• **${opt.label}** — ${opt.description}`);
    } else {
      lines.push(`• **${opt.label}**`);
    }
  }
  if (payload.sponsorName) {
    lines.push("", `_Sponsored by ${payload.sponsorName} — no wrong answer_`);
  }
  return lines.join("\n");
}

function formatRankReasoningPrompt(payload: RankReasoningPayload): string {
  const letters = payload.items.map((item, i) => String.fromCharCode(65 + i));
  const exampleOrder = [...letters].reverse().join(", ");
  const lines = [
    payload.prompt,
    "",
    ...payload.items.map((item, i) => `${letters[i]}. ${item.label}${item.description ? ` — ${item.description}` : ""}`),
    "",
    `_Reply with your order (e.g. ${exampleOrder}), then add one sentence on your top pick._`,
  ];
  return lines.join("\n");
}

function formatBinaryReasoningPrompt(payload: BinaryReasoningPayload): string {
  const letters = ["A", "B"];
  const lines = [
    payload.prompt,
    "",
    ...payload.options.map((opt, i) => `${letters[i]}. ${opt.label}`),
    "",
    "_Reply with A or B, then add one sentence on why._",
  ];
  return lines.join("\n");
}

/** Fallback only — most groups have real rules in groups.rules (set via the owner's post-registration rules prompt). */
const PLACEHOLDER_ADMISSION_RULES = [
  "Be respectful",
  "No spam or self-promotion without permission",
  "Keep it on topic",
];

/** Shown after verification passes — gates final admission on a single "I agree" tap. */
export async function sendAdmissionRulesDm(
  api: Api,
  userId: number,
  verificationId: string,
  group: GroupRow,
  groupTitle: string,
): Promise<boolean> {
  const rules = group.rules.length > 0 ? group.rules : PLACEHOLDER_ADMISSION_RULES;
  const lines = [
    "✓ Verified — you're good to go.",
    "",
    `Before you join, here are the rules for **${groupTitle}**:`,
    "",
    ...rules.map((rule) => `- ${rule}`),
    "",
    "Tap below to agree and enter.",
  ];
  const keyboard = new InlineKeyboard().text("I agree ✓", `rules_agree:${verificationId}`);
  try {
    await api.sendMessage(userId, lines.join("\n"), {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
    return true;
  } catch {
    return false;
  }
}

export async function sendVerificationTaskDm(
  api: Api,
  userId: number,
  verificationId: string,
  task: ResolvedVerificationTask,
  groupTitle: string,
): Promise<boolean> {
  const header = `🔍 **${groupTitle}** — quick verification\n\n`;

  try {
    switch (task.taskType) {
      // TODO: for groups with no active advertiser campaign, Kimi scoring is currently still applied.
      // In future: bypass Kimi for no-advertiser groups and admit directly on any non-empty response.
      case TaskType.OPEN_TEXT: {
        const payload = task.payload as { prompt: string };
        await api.sendMessage(
          userId,
          `👋 Hey! You just requested to join **${groupTitle}**.\n\n` +
            `This group uses Canvas to verify new members before letting anyone in.\n\n` +
            `To get access, answer one quick question:\n\n` +
            `${payload.prompt}\n\n` +
            `No right or wrong answer — just tell us in your own words.`,
          { parse_mode: "Markdown" },
        );
        return true;
      }

      case TaskType.RANK_REASONING: {
        const payload = task.payload as RankReasoningPayload;
        await api.sendMessage(userId, `${header}${formatRankReasoningPrompt(payload)}`, {
          parse_mode: "Markdown",
        });
        return true;
      }

      case TaskType.BINARY_REASONING: {
        const payload = task.payload as BinaryReasoningPayload;
        await api.sendMessage(userId, `${header}${formatBinaryReasoningPrompt(payload)}`, {
          parse_mode: "Markdown",
        });
        return true;
      }

      case TaskType.TRIVIA_MC: {
        const payload = task.payload as TriviaMcPayload;
        const keyboard = buildMcKeyboard(verificationId, payload.options);
        await api.sendMessage(
          userId,
          `${header}${payload.prompt}\n\n_Tap the correct answer below._`,
          { reply_markup: keyboard, parse_mode: "Markdown" },
        );
        return true;
      }

      case TaskType.PREFERENCE_MC: {
        const payload = task.payload as PreferenceMcPayload;
        const keyboard = buildMcKeyboard(verificationId, payload.options);
        await api.sendMessage(userId, `${header}${formatPreferencePrompt(payload)}`, {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        });
        return true;
      }

      case TaskType.PREFERENCE_WEBAPP: {
        const payload = task.payload as PreferenceWebAppPayload;
        const base = miniAppBaseUrl();
        const params = new URLSearchParams({
          v: verificationId,
          prompt: payload.prompt,
        });
        const webAppUrl = `${base}/mini-app/preference?${params.toString()}`;
        const keyboard = new InlineKeyboard().webApp("Open verification", webAppUrl);
        await api.sendMessage(
          userId,
          `${header}${payload.prompt}\n\n_Tap below to complete._`,
          { reply_markup: keyboard, parse_mode: "Markdown" },
        );
        return true;
      }

      default:
        return false;
    }
  } catch {
    return false;
  }
}

/** @deprecated Use sendVerificationTaskDm */
export async function sendCaptchaDm(
  api: Api,
  userId: number,
  verificationId: string,
  captcha: { prompt: string; options: { id: string; label: string }[] },
  groupTitle: string,
): Promise<boolean> {
  return sendVerificationTaskDm(
    api,
    userId,
    verificationId,
    {
      taskType: TaskType.TRIVIA_MC,
      payload: {
        prompt: captcha.prompt,
        options: captcha.options,
        correctOptionId: "",
        questionId: "",
      },
    },
    groupTitle,
  );
}

/** After a preference_mc pass, offer the advertiser's follow-up CTA (or skip) if the template has one. */
export async function sendAgentOfferFollowUp(
  api: Api,
  userId: number,
  task: ResolvedVerificationTask,
): Promise<void> {
  if (task.taskType !== TaskType.PREFERENCE_MC) return;
  const offer = (task.payload as PreferenceMcPayload).agentOffer;
  if (!offer) return;

  const keyboard = new InlineKeyboard().url(offer.ctaLabel, offer.ctaUrl).text("Skip", "offer:skip");
  try {
    await api.sendMessage(userId, offer.message, { reply_markup: keyboard });
  } catch {
    /* user may have blocked the bot */
  }
}

/** Dismisses the agent-offer keyboard when the user taps "Skip". */
export function registerAgentOfferSkipHandler(bot: Bot): void {
  bot.on("callback_query:data", async (ctx, next) => {
    if (ctx.callbackQuery.data !== "offer:skip") {
      await next();
      return;
    }
    await ctx.answerCallbackQuery();
    try {
      await ctx.editMessageReplyMarkup();
    } catch {
      /* ignore */
    }
  });
}

export async function getGroupInviteLink(api: Api, chatId: number): Promise<string | null> {
  try {
    return await api.exportChatInviteLink(chatId);
  } catch {
    try {
      const created = await api.createChatInviteLink(chatId);
      return created.invite_link;
    } catch {
      return null;
    }
  }
}
