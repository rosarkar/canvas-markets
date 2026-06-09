import type { Api } from "grammy";

import type { GroupRow } from "@/adapters/groups.adapter.js";
import { updatePortalInviteLink } from "@/adapters/groups.adapter.js";
import { logger } from "@/utils/logger.js";

export async function createPortalInviteLink(
  api: Api,
  group: GroupRow,
): Promise<string | null> {
  try {
    const link = await api.createChatInviteLink(Number(group.tgGroupId), {
      creates_join_request: true,
      name: "Canvas verification portal",
    });
    await updatePortalInviteLink(group.groupId, link.invite_link);
    return link.invite_link;
  } catch (err) {
    logger.warn({ err, groupId: group.groupId }, "Failed to create portal invite link");
    return null;
  }
}
