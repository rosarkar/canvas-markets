import { describe, expect, it } from "vitest";

import type { TopBid } from "../adapters/bidding.js";
import type { GroupRow } from "../adapters/groups.adapter.js";
import {
  defaultPreferenceTask,
  isPassingMcAnswer,
  resolveVerificationTask,
  TaskType,
} from "./verification-tasks.js";

const baseGroup: GroupRow = {
  groupId: 1,
  tgGroupId: 100n,
  ownerWallet: "0x0000000000000000000000000000000000000001",
  ownerTgId: 1n,
  verificationTaskText: "In one sentence: what do you use DeFi for?",
  isActive: true,
  registeredAt: new Date(),
  lastWelcomeMessageId: null,
  portalInviteLink: null,
};

describe("resolveVerificationTask", () => {
  it("prefers advertiser task_text", () => {
    const topBid: TopBid = {
      advertiserId: 1,
      groupId: 1,
      bidPerVerification: 350_000n,
      remainingBudget: 3_500_000n,
      taskText: "Would you use Moonwell or Aerodrome?",
      advertiserTgId: 99n,
    };
    const task = resolveVerificationTask(baseGroup, topBid);
    expect(task.taskType).toBe(TaskType.PREFERENCE_MC);
    expect((task.payload as { prompt: string }).prompt).toBe(topBid.taskText);
  });

  it("uses group fallback when no advertiser", () => {
    const group = {
      ...baseGroup,
      verificationTaskText: "Tell us your favorite Base protocol.",
    };
    const task = resolveVerificationTask(group, null);
    expect(task.taskType).toBe(TaskType.OPEN_TEXT);
    expect((task.payload as { prompt: string }).prompt).toContain("Base protocol");
  });

  it("uses open_text for default group fallback task", () => {
    const task = resolveVerificationTask(baseGroup, null);
    expect(task.taskType).toBe(TaskType.OPEN_TEXT);
    expect((task.payload as { prompt: string }).prompt).toContain("DeFi");
  });

  it("falls back to trivia when group has no task text", () => {
    const group = { ...baseGroup, verificationTaskText: "" };
    const task = resolveVerificationTask(group, null);
    expect(task.taskType).toBe(TaskType.TRIVIA_MC);
    expect(task.captchaQuestionId).toBeTruthy();
  });
});

describe("isPassingMcAnswer", () => {
  it("passes any option for preference tasks", () => {
    expect(isPassingMcAnswer(TaskType.PREFERENCE_MC, null, "yield")).toBe(true);
  });

  it("requires exact match for trivia", () => {
    expect(isPassingMcAnswer(TaskType.TRIVIA_MC, "green", "green")).toBe(true);
    expect(isPassingMcAnswer(TaskType.TRIVIA_MC, "green", "blue")).toBe(false);
  });
});

describe("defaultPreferenceTask", () => {
  it("includes three options", () => {
    const task = defaultPreferenceTask("Pick your style");
    expect(task.taskType).toBe(TaskType.PREFERENCE_MC);
    expect((task.payload as { options: unknown[] }).options).toHaveLength(3);
  });
});
