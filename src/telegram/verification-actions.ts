import type { Api } from "grammy";

import { getLastRealAttemptAt } from "@/adapters/verification.adapter.js";
import { logger } from "@/utils/logger.js";

const HOUR_MS = 3_600_000;
const COOLDOWN_WINDOWS_MS = {
  group_cooldown_24h: 24 * HOUR_MS,
  attempt_limit_12h: 12 * HOUR_MS,
} as const;

/**
 * Best-effort DM telling a turned-away user why and when they can retry. Most rejected
 * users have already started the bot (that's how they got into cooldown), so this
 * usually lands. Never throws — a DM failure must not break the rejection flow.
 */
export async function notifyCooldownRejection(
  api: Api,
  tgUserId: bigint,
  groupId: number,
  groupTitle: string,
  reason: keyof typeof COOLDOWN_WINDOWS_MS,
): Promise<void> {
  try {
    const lastAttempt = await getLastRealAttemptAt(tgUserId, groupId);
    const retryAt = (lastAttempt?.getTime() ?? Date.now()) + COOLDOWN_WINDOWS_MS[reason];
    const hoursLeft = Math.max(1, Math.ceil((retryAt - Date.now()) / HOUR_MS));
    await api.sendMessage(
      Number(tgUserId),
      `⏳ You recently attempted verification for **${groupTitle}** — you can try again in about ${hoursLeft} hour${hoursLeft === 1 ? "" : "s"}.`,
      { parse_mode: "Markdown" },
    );
  } catch {
    /* user never started the bot or blocked it — rejection proceeds regardless */
  }
}

const MUTED_PERMISSIONS = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
  can_manage_topics: false,
};

const FULL_PERMISSIONS = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
  can_change_info: false,
  can_invite_users: true,
  can_pin_messages: false,
  can_manage_topics: true,
};

export async function suspendUserPendingVerification(
  api: Api,
  chatId: number | bigint,
  userId: number | bigint,
): Promise<void> {
  try {
    await api.banChatMember(Number(chatId), Number(userId));
  } catch (err) {
    logger.warn({ err, chatId, userId }, "Failed to suspend user pending verification");
  }
}

export async function allowUserRejoin(
  api: Api,
  chatId: number | bigint,
  userId: number | bigint,
): Promise<void> {
  try {
    await api.unbanChatMember(Number(chatId), Number(userId));
  } catch (err) {
    logger.warn({ err, chatId, userId }, "Failed to unban verified user");
  }
}

export async function restrictUserForCaptcha(
  api: Api,
  chatId: number | bigint,
  userId: number | bigint,
): Promise<void> {
  try {
    await api.restrictChatMember(Number(chatId), Number(userId), MUTED_PERMISSIONS);
  } catch (err) {
    logger.warn({ err, chatId, userId }, "Failed to restrict user for captcha");
  }
}

export async function admitUser(
  api: Api,
  chatId: number | bigint,
  userId: number | bigint,
): Promise<void> {
  try {
    await api.restrictChatMember(Number(chatId), Number(userId), FULL_PERMISSIONS);
  } catch (err) {
    logger.warn({ err, chatId, userId }, "Failed to unrestrict verified user");
  }
}

export async function rejectUser(
  api: Api,
  chatId: number | bigint,
  userId: number | bigint,
): Promise<void> {
  try {
    await api.banChatMember(Number(chatId), Number(userId));
    await api.unbanChatMember(Number(chatId), Number(userId));
  } catch (err) {
    logger.warn({ err, chatId, userId }, "Failed to kick user after failed captcha");
  }
}

export async function approveJoinRequest(
  api: Api,
  chatId: number | bigint,
  userId: number | bigint,
): Promise<void> {
  try {
    await api.approveChatJoinRequest(Number(chatId), Number(userId));
  } catch (err) {
    logger.warn({ err, chatId, userId }, "Failed to approve join request");
  }
}

export async function declineJoinRequest(
  api: Api,
  chatId: number | bigint,
  userId: number | bigint,
): Promise<void> {
  try {
    await api.declineChatJoinRequest(Number(chatId), Number(userId));
  } catch (err) {
    logger.warn({ err, chatId, userId }, "Failed to decline join request");
  }
}
