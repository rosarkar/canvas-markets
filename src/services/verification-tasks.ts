import type { TopBid } from "@/adapters/bidding.js";
import type { GroupRow } from "@/adapters/groups.adapter.js";
import {
  type CaptchaQuestion,
  pickRandomCaptcha,
} from "@/services/captcha-questions.js";

export const TaskType = {
  TRIVIA_MC: "trivia_mc",
  OPEN_TEXT: "open_text",
  PREFERENCE_MC: "preference_mc",
  PREFERENCE_WEBAPP: "preference_webapp",
} as const;

export type TaskType = (typeof TaskType)[keyof typeof TaskType];

export interface TaskOption {
  id: string;
  label: string;
  description?: string;
}

export interface TriviaMcPayload {
  prompt: string;
  options: TaskOption[];
  correctOptionId: string;
  questionId: string;
}

export interface OpenTextPayload {
  prompt: string;
}

export interface PreferenceMcPayload {
  prompt: string;
  options: TaskOption[];
}

export interface PreferenceWebAppPayload {
  prompt: string;
  options: TaskOption[];
}

export type TaskPayload =
  | TriviaMcPayload
  | OpenTextPayload
  | PreferenceMcPayload
  | PreferenceWebAppPayload;

export interface ResolvedVerificationTask {
  taskType: TaskType;
  payload: TaskPayload;
  /** For trivia_mc backward compat with captcha_question_id column */
  captchaQuestionId?: string;
  captchaCorrectOption?: string;
}

function openTextTask(prompt: string): ResolvedVerificationTask {
  return {
    taskType: TaskType.OPEN_TEXT,
    payload: { prompt },
  };
}

function triviaFromQuestion(captcha: CaptchaQuestion): ResolvedVerificationTask {
  return {
    taskType: TaskType.TRIVIA_MC,
    payload: {
      prompt: captcha.prompt,
      options: captcha.options,
      correctOptionId: captcha.correctOptionId,
      questionId: captcha.id,
    },
    captchaQuestionId: captcha.id,
    captchaCorrectOption: captcha.correctOptionId,
  };
}

/** Default DeFi preference task when an advertiser funds a campaign without custom UI. */
export function defaultPreferenceTask(taskText: string): ResolvedVerificationTask {
  return {
    taskType: TaskType.PREFERENCE_MC,
    payload: {
      prompt: taskText,
      options: [
        {
          id: "yield",
          label: "Earn yield",
          description: "Lend, stake, or farm for passive returns",
        },
        {
          id: "trade",
          label: "Trade actively",
          description: "Swap, perps, or market-make on DEXs",
        },
        {
          id: "explore",
          label: "Explore new protocols",
          description: "Try new apps, bridges, and launches on Base",
        },
      ],
    },
  };
}

/**
 * Resolve which verification task to serve for a join.
 * Priority: advertiser task_text → group fallback → random trivia captcha.
 */
export function resolveVerificationTask(
  group: GroupRow,
  topBid: TopBid | null,
): ResolvedVerificationTask {
  const advertiserText = topBid?.taskText?.trim();
  if (advertiserText) {
    return defaultPreferenceTask(advertiserText);
  }

  const groupText = group.verificationTaskText?.trim();
  if (groupText) {
    return openTextTask(groupText);
  }

  return triviaFromQuestion(pickRandomCaptcha());
}

export function parseTaskPayload(
  taskType: TaskType,
  raw: unknown,
): TaskPayload | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as TaskPayload;
}

export function isPassingMcAnswer(
  taskType: TaskType,
  correctOptionId: string | null,
  selectedOptionId: string,
): boolean {
  if (taskType === TaskType.PREFERENCE_MC || taskType === TaskType.PREFERENCE_WEBAPP) {
    return true;
  }
  return correctOptionId === selectedOptionId;
}
