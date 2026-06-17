import type { Api } from "grammy";

import { getGroupById } from "@/adapters/groups.adapter.js";
import {
  type VerificationRow,
  transitionState,
} from "@/adapters/verification.adapter.js";
import { scoreWithKimi, passesThreshold } from "@/services/scoring.js";
import { TaskType, type OpenTextPayload, parseTaskPayload } from "@/services/verification-tasks.js";
import { VerificationState } from "@/services/verification-states.js";
import {
  completeVerificationFail,
  completeVerificationPass,
} from "@/telegram/services/verification-complete.js";
import { logger } from "@/utils/logger.js";

export async function processOpenTextResponse(
  api: Api,
  verification: VerificationRow,
  responseText: string,
): Promise<{ passed: boolean; score: number }> {
  const group = await getGroupById(verification.groupId);
  if (!group) throw new Error("Group not found");

  const payload = parseTaskPayload(
    (verification.taskType as TaskType) ?? TaskType.OPEN_TEXT,
    verification.taskPayload,
  ) as OpenTextPayload | null;
  const prompt = payload?.prompt ?? group.verificationTaskText;

  await transitionState(verification.verificationId, VerificationState.RESPONSE_RECEIVED, {
    responseText,
  });
  await transitionState(verification.verificationId, VerificationState.SCORING);

  const result = await scoreWithKimi(prompt, responseText);
  const passed = passesThreshold(result);

  const chat = await api.getChat(Number(group.tgGroupId));
  const groupTitle =
    chat.type !== "private" && "title" in chat ? (chat.title ?? "the group") : "the group";
  const me = await api.getMe();
  const botUsername = me.username ?? "CanvasProtocolBot";

  if (passed) {
    await transitionState(verification.verificationId, VerificationState.PASSED, {
      kimiScore: result.score,
    });
    await completeVerificationPass(api, verification, group, groupTitle, botUsername);
    logger.info(
      { verificationId: verification.verificationId, score: result.score, method: result.method },
      "User passed open-text verification",
    );
  } else {
    await transitionState(verification.verificationId, VerificationState.KIMI_FAILED, {
      kimiScore: result.score,
    });
    await transitionState(verification.verificationId, VerificationState.FAILED);
    await completeVerificationFail(api, verification, group);
    logger.info(
      { verificationId: verification.verificationId, score: result.score, method: result.method },
      "User failed open-text verification",
    );
  }

  return { passed, score: result.score };
}
