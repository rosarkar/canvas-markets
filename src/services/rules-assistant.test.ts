import { describe, expect, it, vi } from "vitest";

import { buildInitialRulesPrompt, draftOrReviseRules, formatRulesList } from "./rules-assistant.js";

vi.mock("./scoring.js", () => ({
  callKimi: vi.fn(),
}));

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
});
