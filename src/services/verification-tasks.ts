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
  RANK_REASONING: "rank_reasoning",
  BINARY_REASONING: "binary_reasoning",
} as const;

export type TaskType = (typeof TaskType)[keyof typeof TaskType];

/** Task types selectable by advertisers in the /buy template flow. */
export const ADVERTISER_TASK_TYPES: TaskType[] = [
  TaskType.PREFERENCE_MC,
  TaskType.RANK_REASONING,
  TaskType.BINARY_REASONING,
  TaskType.OPEN_TEXT,
];

export interface TaskOption {
  id: string;
  label: string;
  description?: string;
}

export interface AgentOffer {
  message: string;
  ctaLabel: string;
  ctaUrl: string;
}

export interface TriviaMcPayload {
  prompt: string;
  options: TaskOption[];
  correctOptionId: string;
  questionId: string;
}

export interface OpenTextPayload {
  prompt: string;
  /** Sent once if the first reply looks too thin to score. */
  rePromptText?: string;
  /** Conversational captcha: serialized enriched sponsor brief for the dialogue agent's later turns. */
  brief?: string;
}

export interface PreferenceMcPayload {
  prompt: string;
  options: TaskOption[];
  sponsorName?: string;
  agentOffer?: AgentOffer;
}

export interface PreferenceWebAppPayload {
  prompt: string;
  options: TaskOption[];
}

export interface RankReasoningPayload {
  prompt: string;
  items: TaskOption[];
  /** Sent once if the first reply is a ranking with no reasoning sentence. */
  rePromptText?: string;
}

export interface BinaryReasoningPayload {
  prompt: string;
  options: [TaskOption, TaskOption];
  /** Extra payout (microunits, as a string) when the reply includes genuine reasoning. */
  bonusMicroUnits?: string;
}

export type TaskPayload =
  | TriviaMcPayload
  | OpenTextPayload
  | PreferenceMcPayload
  | PreferenceWebAppPayload
  | RankReasoningPayload
  | BinaryReasoningPayload;

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

/** Build a resolved task straight from a saved/ad-hoc template's type + payload. */
export function taskFromTemplate(taskType: TaskType, payload: TaskPayload): ResolvedVerificationTask {
  return { taskType, payload };
}

/**
 * Resolve which verification task to serve for a join.
 * Priority: advertiser's saved template → advertiser task_text → group fallback → random trivia captcha.
 */
export function resolveVerificationTask(
  group: GroupRow,
  topBid: TopBid | null,
  template?: { taskType: TaskType; payload: TaskPayload } | null,
): ResolvedVerificationTask {
  if (template) {
    return taskFromTemplate(template.taskType, template.payload);
  }

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

/** Assigns A, B, C... ids to a list of typed-in labels for rank/binary/preference templates. */
export function labelOptions(labels: { label: string; description?: string }[]): TaskOption[] {
  return labels.map((entry, index) => ({
    id: String.fromCharCode(65 + index).toLowerCase(),
    label: entry.label,
    description: entry.description,
  }));
}
