import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildInitialRulesPrompt,
  draftOrReviseRules,
  formatRulesList,
  isOffTopicRulesDraft,
} from "./rules-assistant.js";

vi.mock("./scoring.js", () => ({
  callKimi: vi.fn(),
}));

beforeEach(async () => {
  const { callKimi } = await import("./scoring.js");
  vi.mocked(callKimi).mockReset();
});

describe("formatRulesList", () => {
  it("numbers rules starting at 1", () => {
    expect(formatRulesList(["No spam", "English only"])).toBe("1. No spam\n2. English only");
  });
});

describe("buildInitialRulesPrompt", () => {
  it("includes the group title, topic, and owner's reply", () => {
    const prompt = buildInitialRulesPrompt("Lennox Cartel", "DeFi trading", "Keep it serious, no shilling");
    expect(prompt).toContain("Lennox Cartel");
    expect(prompt).toContain("DeFi trading");
    expect(prompt).toContain("Keep it serious, no shilling");
  });
});

describe("draftOrReviseRules", () => {
  it("parses a valid {rules: [...]} JSON response", async () => {
    const { callKimi } = await import("./scoring.js");
    vi.mocked(callKimi).mockResolvedValueOnce(JSON.stringify({ rules: ["No spam", "No unsolicited DMs"] }));

    const rules = await draftOrReviseRules([{ role: "user", content: "draft something" }]);
    expect(rules).toEqual(["No spam", "No unsolicited DMs"]);
  });

  it("throws on malformed JSON so the caller can show a retry message", async () => {
    const { callKimi } = await import("./scoring.js");
    vi.mocked(callKimi).mockResolvedValueOnce("not json");

    await expect(draftOrReviseRules([{ role: "user", content: "draft something" }])).rejects.toThrow();
  });

  it("throws when the rules array is empty", async () => {
    const { callKimi } = await import("./scoring.js");
    vi.mocked(callKimi).mockResolvedValueOnce(JSON.stringify({ rules: [] }));

    await expect(draftOrReviseRules([{ role: "user", content: "draft something" }])).rejects.toThrow();
  });

  it("does not retry when the draft is on-topic — exactly one Kimi call", async () => {
    const { callKimi } = await import("./scoring.js");
    vi.mocked(callKimi).mockResolvedValueOnce(
      JSON.stringify({ rules: ["No spam or self-promotion", "Be respectful — no harassment"] }),
    );

    const rules = await draftOrReviseRules([{ role: "user", content: "draft something" }]);
    expect(rules).toEqual(["No spam or self-promotion", "Be respectful — no harassment"]);
    expect(callKimi).toHaveBeenCalledTimes(1);
  });

  it("rejects an off-topic draft and retries once with a corrective instruction", async () => {
    const { callKimi } = await import("./scoring.js");
    vi.mocked(callKimi)
      .mockResolvedValueOnce(
        JSON.stringify({
          rules: [
            "ETH is currently trading around $3,200 and looking bullish",
            "Bitcoin dominance is rising this week",
          ],
        }),
      )
      .mockResolvedValueOnce(JSON.stringify({ rules: ["No spam or self-promotion", "English only"] }));

    const rules = await draftOrReviseRules([{ role: "user", content: "draft something" }]);

    expect(rules).toEqual(["No spam or self-promotion", "English only"]);
    expect(callKimi).toHaveBeenCalledTimes(2);

    const retryMessages = vi.mocked(callKimi).mock.calls[1]![0];
    expect(retryMessages[retryMessages.length - 1]).toEqual(
      expect.objectContaining({ role: "system", content: expect.stringContaining("did not look like community management rules") }),
    );
  });

  it("throws if the retry is also off-topic, without retrying a third time", async () => {
    const { callKimi } = await import("./scoring.js");
    vi.mocked(callKimi)
      .mockResolvedValueOnce(JSON.stringify({ rules: ["BTC just hit a new all-time high"] }))
      .mockResolvedValueOnce(JSON.stringify({ rules: ["ETH price forecast for next week"] }));

    await expect(draftOrReviseRules([{ role: "user", content: "draft something" }])).rejects.toThrow();
    expect(callKimi).toHaveBeenCalledTimes(2);
  });
});

describe("isOffTopicRulesDraft", () => {
  it("flags a draft where every rule reads as market/price commentary", () => {
    expect(
      isOffTopicRulesDraft([
        "ETH is currently trading around $3,200 and looking bullish",
        "Bitcoin dominance is rising this week",
      ]),
    ).toBe(true);
  });

  it("does not flag normal community rules", () => {
    expect(
      isOffTopicRulesDraft([
        "No spam or self-promotion",
        "No unsolicited DMs to members",
        "Be respectful — no harassment",
      ]),
    ).toBe(false);
  });

  it("does not flag a draft with at least one real rule mixed in", () => {
    expect(isOffTopicRulesDraft(["No spam or self-promotion", "ETH is looking bullish today"])).toBe(false);
  });

  it("does not flag an empty list (handled separately as a different failure)", () => {
    expect(isOffTopicRulesDraft([])).toBe(false);
  });
});
