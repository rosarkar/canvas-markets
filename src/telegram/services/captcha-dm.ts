import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";

import { config } from "@/config/index.js";
import { buildCaptchaCallbackData } from "@/services/captcha-questions.js";
import {
  TaskType,
  type PreferenceMcPayload,
  type PreferenceWebAppPayload,
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
  return lines.join("\n");
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
      case TaskType.OPEN_TEXT: {
        const payload = task.payload as { prompt: string };
        await api.sendMessage(
          userId,
          `${header}${payload.prompt}\n\n_Reply with your answer — a sentence or two is enough._`,
          { parse_mode: "Markdown" },
        );
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
