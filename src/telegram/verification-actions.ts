import type { Api } from "grammy";

import { logger } from "@/utils/logger.js";

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
