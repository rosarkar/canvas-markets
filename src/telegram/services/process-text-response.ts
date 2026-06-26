import type { Api } from "grammy";

import { getGroupById } from "@/adapters/groups.adapter.js";
import {
  bumpAttemptCount,
  transitionState,
  type VerificationRow,
} from "@/adapters/verification.adapter.js";
import { scoreWithKimi, passesThreshold } from "@/services/scoring.js";
import {
  TaskType,
  parseTaskPayload,
  type BinaryReasoningPayload,
  type OpenTextPayload,
  type RankReasoningPayload,
} from "@/services/verification-tasks.js";
import {
  extractOptionAndReasoning,
  extractRankingAndReasoning,
  isThinResponse,
} from "@/services/text-response-parser.js";
import { VerificationState } from "@/services/verification-states.js";
import {
  completeVerificationFail,
  completeVerificationPass,
} from "@/telegram/services/verification-complete.js";
import { logger } from "@/utils/logger.js";

export type TextVerificationOutcome =
  | { outcome: "passed"; score: number }
  | { outcome: "failed"; score: number }
  | { outcome: "re_prompted" };

const DEFAULT_OPEN_TEXT_REPROMPT = "Can you say a bit more? A specific detail or two helps.";
const DEFAULT_RANK_REPROMPT =
  "Almost there. Can you add one sentence on why you ranked your top pick first?";
const DEFAULT_BINARY_REPROMPT = "Got it — can you add one sentence on why? Just a few words is fine.";
const DEFAULT_BINARY_NO_OPTION_REPROMPT =
  'Start your reply with the letter of the option you\'re picking (e.g. "A — ...").';

async function sendRePrompt(api: Api, verification: VerificationRow, text: string): Promise<void> {
  await bumpAttemptCount(verification.verificationId);
  try {
    await api.sendMessage(Number(verification.tgUserId), text);
  } catch {
    /* user may have blocked the bot — they simply won't see the re-prompt */
  }
}

async function finalize(
  api: Api,
  verification: VerificationRow,
  scoringPrompt: string,
  responseText: string,
  bonusMicroUnits?: bigint,
): Promise<TextVerificationOutcome> {
  await transitionState(verification.verificationId, VerificationState.RESPONSE_RECEIVED, {
    responseText,
  });
  await transitionState(verification.verificationId, VerificationState.SCORING);

  const result = await scoreWithKimi(scoringPrompt, responseText);
  const passed = passesThreshold(result);

  const group = await getGroupById(verification.groupId);
  if (!group) throw new Error("Group not found");
  const chat = await api.getChat(Number(group.tgGroupId));
  const groupTitle =
    chat.type !== "private" && "title" in chat ? (chat.title ?? "the group") : "the group";
  const me = await api.getMe();
  const botUsername = me.username ?? "CanvasProtocolBot";

  if (passed) {
    await transitionState(verification.verificationId, VerificationState.PASSED, {
      kimiScore: result.score,
      bonusMicroUnits,
    });
    await completeVerificationPass(api, verification.verificationId, group, groupTitle, botUsername);
    logger.info(
      { verificationId: verification.verificationId, score: result.score, method: result.method },
      "User passed text verification",
    );
  } else {
    await transitionState(verification.verificationId, VerificationState.KIMI_FAILED, {
      kimiScore: result.score,
    });
    await transitionState(verification.verificationId, VerificationState.FAILED);
    await completeVerificationFail(api, verification, group);
    logger.info(
      { verificationId: verification.verificationId, score: result.score, method: result.method },
      "User failed text verification",
    );
  }

  return passed
    ? { outcome: "passed", score: result.score }
    : { outcome: "failed", score: result.score };
}

/**
 * Handles a DM text reply for open_text, rank_reasoning, and binary_reasoning tasks.
 * Each type gets exactly one re-prompt if the first reply is too thin/incomplete
 * (gated by attempt_count) before falling through to Kimi scoring.
 */
export async function processTextVerificationResponse(
  api: Api,
  verification: VerificationRow,
  responseText: string,
): Promise<TextVerificationOutcome> {
  const taskType = (verification.taskType as TaskType) ?? TaskType.OPEN_TEXT;
  const canRePrompt = verification.attemptCount < 2;

  if (taskType === TaskType.RANK_REASONING) {
    const payload = parseTaskPayload(taskType, verification.taskPayload) as RankReasoningPayload | null;
    const { ranking, reasoning } = extractRankingAndReasoning(responseText);

    if (canRePrompt && (!ranking || isThinResponse(reasoning, 10, 2))) {
      await sendRePrompt(api, verification, payload?.rePromptText ?? DEFAULT_RANK_REPROMPT);
      return { outcome: "re_prompted" };
    }

    return finalize(api, verification, payload?.prompt ?? "Rank these items.", responseText);
  }

  if (taskType === TaskType.BINARY_REASONING) {
    const payload = parseTaskPayload(taskType, verification.taskPayload) as BinaryReasoningPayload | null;
    const options = payload?.options ?? [];
    const { optionId, reasoning } = extractOptionAndReasoning(responseText, options);

    if (canRePrompt && !optionId) {
      await sendRePrompt(api, verification, DEFAULT_BINARY_NO_OPTION_REPROMPT);
      return { outcome: "re_prompted" };
    }
    if (canRePrompt && isThinResponse(reasoning, 10, 2)) {
      await sendRePrompt(api, verification, DEFAULT_BINARY_REPROMPT);
      return { outcome: "re_prompted" };
    }

    const hasReasoning = !isThinResponse(reasoning, 10, 2);
    const bonus = hasReasoning && payload?.bonusMicroUnits ? BigInt(payload.bonusMicroUnits) : undefined;
    return finalize(api, verification, payload?.prompt ?? "Pick an option.", responseText, bonus);
  }

  // OPEN_TEXT, and legacy verifications created before task_type existed.
  const payload = parseTaskPayload(TaskType.OPEN_TEXT, verification.taskPayload) as OpenTextPayload | null;
  let prompt = payload?.prompt;
  if (!prompt) {
    const group = await getGroupById(verification.groupId);
    prompt = group?.verificationTaskText ?? "Tell us about yourself.";
  }

  if (canRePrompt && isThinResponse(responseText)) {
    await sendRePrompt(api, verification, payload?.rePromptText ?? DEFAULT_OPEN_TEXT_REPROMPT);
    return { outcome: "re_prompted" };
  }

  return finalize(api, verification, prompt, responseText);
}
