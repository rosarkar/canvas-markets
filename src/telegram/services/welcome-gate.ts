import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";

import {
  getGroupById,
  updateLastWelcomeMessageId,
} from "@/adapters/groups.adapter.js";
import { logger } from "@/utils/logger.js";

export async function deletePreviousWelcome(
  api: Api,
  chatId: number,
  groupId: number,
): Promise<void> {
  const group = await getGroupById(groupId);
  if (!group?.lastWelcomeMessageId) return;

  try {
    await api.deleteMessage(chatId, Number(group.lastWelcomeMessageId));
  } catch {
    /* message may already be gone */
  }
}

export async function sendWelcomeGateMessage(
  api: Api,
  chatId: number,
  groupId: number,
  userFirstName: string,
  groupTitle: string,
  verificationId: string,
  botUsername: string,
): Promise<number | null> {
  await deletePreviousWelcome(api, chatId, groupId);

  const deepLink = `https://t.me/${botUsername}?start=verify_${verificationId}`;
  const keyboard = new InlineKeyboard().url("Verify to join →", deepLink);

  try {
    const msg = await api.sendMessage(
      chatId,
      `👋 Hey ${userFirstName}! **${groupTitle}** requires a quick verification before you can chat.\n\nTap below — takes about 30 seconds.`,
      { reply_markup: keyboard, parse_mode: "Markdown" },
    );
    await updateLastWelcomeMessageId(groupId, msg.message_id);
    return msg.message_id;
  } catch (err) {
    logger.warn({ err, chatId, groupId }, "Failed to post welcome gate message");
    return null;
  }
}

export async function deleteWelcomeGateMessage(
  api: Api,
  chatId: number,
  groupId: number,
): Promise<void> {
  await deletePreviousWelcome(api, chatId, groupId);
  await updateLastWelcomeMessageId(groupId, null);
}
