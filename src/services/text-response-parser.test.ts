import { describe, expect, it } from "vitest";

import {
  extractOptionAndReasoning,
  extractRankingAndReasoning,
  isThinResponse,
} from "./text-response-parser.js";

describe("isThinResponse", () => {
  it("flags short, low-word-count replies as thin", () => {
    expect(isThinResponse("art and community")).toBe(true);
  });

  it("does not flag a substantive reply", () => {
    expect(
      isThinResponse(
        "Art quality and whether the founders have shipped before. PFPs without a roadmap are a pass for me.",
      ),
    ).toBe(false);
  });
});

describe("extractRankingAndReasoning", () => {
  it("splits a ranking-only reply with no reasoning", () => {
    const { ranking, reasoning } = extractRankingAndReasoning("A, C, D, B");
    expect(ranking).toBe("A, C, D, B");
    expect(reasoning).toBe("");
  });

  it("splits ranking + reasoning separated by a dash", () => {
    const { ranking, reasoning } = extractRankingAndReasoning(
      "A, C, D, B — All Too Well hits hardest because it makes you feel like you lived it.",
    );
    expect(ranking).toBe("A, C, D, B");
    expect(reasoning).toContain("All Too Well hits hardest");
  });

  it("returns null ranking for free text with no list", () => {
    const { ranking } = extractRankingAndReasoning("I don't really know honestly");
    expect(ranking).toBeNull();
  });
});

describe("extractOptionAndReasoning", () => {
  const options = [
    { id: "yes", label: "Yes — useful as a first pass before a human audit" },
    { id: "no", label: "No — I wouldn't trust it for anything security-critical" },
  ];

  it("extracts leading letter and reasoning", () => {
    const { optionId, reasoning } = extractOptionAndReasoning(
      "A — catches the obvious stuff fast. Still need a Spearbit review before mainnet.",
      options,
    );
    expect(optionId).toBe("yes");
    expect(reasoning).toContain("catches the obvious stuff fast");
  });

  it("returns null optionId when no letter or label match is found", () => {
    const { optionId } = extractOptionAndReasoning("not sure tbh", options);
    expect(optionId).toBeNull();
  });
});
