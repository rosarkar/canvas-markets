import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";

import type { CaptchaQuestion } from "@/services/captcha-questions.js";
import { buildCaptchaCallbackData } from "@/services/captcha-questions.js";

export async function sendCaptchaDm(
  api: Api,
  userId: number,
  verificationId: string,
  captcha: CaptchaQuestion,
  groupTitle: string,
): Promise<boolean> {
  const keyboard = new InlineKeyboard();
  for (const option of captcha.options) {
    keyboard.text(
      option.label,
      buildCaptchaCallbackData(verificationId, option.id),
    );
  }

  try {
    await api.sendMessage(
      userId,
      `Verification for **${groupTitle}**:\n\n${captcha.prompt}\n\n` +
        "Tap the correct answer below.",
      { reply_markup: keyboard, parse_mode: "Markdown" },
    );
    return true;
  } catch {
    return false;
  }
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