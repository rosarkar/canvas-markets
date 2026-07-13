import type { Api } from "grammy";

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
): Promise<number | null> {
  await deletePreviousWelcome(api, chatId, groupId);

  try {
    const msg = await api.sendMessage(
      chatId,
      `A new member is completing verification.`,
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
