import { beforeEach, describe, expect, it, vi } from "vitest";

import { getNextAgentTurn } from "./captcha-agent.js";
import { callKimi } from "./scoring.js";

vi.mock("./scoring.js", () => ({
  callKimi: vi.fn(),
}));

// logger transitively requires the full .env config — stub it out for unit tests.
vi.mock("@/utils/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const mockedCallKimi = vi.mocked(callKimi);

const baseParams = {
  advertiserBrief: "What DeFi protocols do you use for yield?",
  groupContext: "Base Yield Farmers — DeFi yield strategies",
};

beforeEach(() => {
  mockedCallKimi.mockReset();
});

describe("getNextAgentTurn", () => {
  it("first turn returns an opening message and shouldClose: false", async () => {
    mockedCallKimi.mockResolvedValue(
      '{"message": "Hey! Which protocol are you farming yield on right now?", "shouldClose": false}',
    );

    const turn = await getNextAgentTurn({
      ...baseParams,
      conversationHistory: [],
      isFirstTurn: true,
    });

    expect(turn.message).toBe("Hey! Which protocol are you farming yield on right now?");
    expect(turn.shouldClose).toBe(false);
    expect(mockedCallKimi).toHaveBeenCalledTimes(1);
  });

  it("probes again on a thin subsequent response", async () => {
    mockedCallKimi.mockResolvedValue(
      '{"message": "Can you name a specific protocol and what you like about it?", "shouldClose": false}',
    );

    const turn = await getNextAgentTurn({
      ...baseParams,
      conversationHistory: [
        { role: "assistant", content: "Which protocol are you farming yield on?" },
        { role: "user", content: "sounds good" },
      ],
      isFirstTurn: false,
    });

    expect(turn.shouldClose).toBe(false);
    expect(turn.message).toContain("specific protocol");
  });

  it("turn 3 always sets shouldClose: true, even if the model says otherwise", async () => {
    // The model tries to keep probing on what would be its 3rd message — the code caps it.
    mockedCallKimi.mockResolvedValue('{"message": "One more question...", "shouldClose": false}');

    const turn = await getNextAgentTurn({
      ...baseParams,
      conversationHistory: [
        { role: "assistant", content: "Which protocol are you farming yield on?" },
        { role: "user", content: "idk" },
        { role: "assistant", content: "Can you name one specific protocol?" },
        { role: "user", content: "not really" },
      ],
      isFirstTurn: false,
    });

    expect(turn.shouldClose).toBe(true);
  });

  it("closes without calling the model when the history already has 3 agent turns", async () => {
    const turn = await getNextAgentTurn({
      ...baseParams,
      conversationHistory: [
        { role: "assistant", content: "q1" },
        { role: "user", content: "a1" },
        { role: "assistant", content: "q2" },
        { role: "user", content: "a2" },
        { role: "assistant", content: "q3" },
        { role: "user", content: "a3" },
      ],
      isFirstTurn: false,
    });

    expect(turn).toEqual({ message: "", shouldClose: true });
    expect(mockedCallKimi).not.toHaveBeenCalled();
  });

  it("fails closed when the model returns unparseable JSON", async () => {
    mockedCallKimi.mockResolvedValue("Sure! Here is my next question: what do you think?");

    const turn = await getNextAgentTurn({
      ...baseParams,
      conversationHistory: [
        { role: "assistant", content: "q1" },
        { role: "user", content: "a1" },
      ],
      isFirstTurn: false,
    });

    expect(turn).toEqual({ message: "", shouldClose: true });
  });

  it("fails closed when callKimi throws", async () => {
    mockedCallKimi.mockRejectedValue(new Error("Kimi HTTP 500"));

    const turn = await getNextAgentTurn({
      ...baseParams,
      conversationHistory: [],
      isFirstTurn: true,
    });

    expect(turn).toEqual({ message: "", shouldClose: true });
  });

  it("tolerates markdown-fenced JSON", async () => {
    mockedCallKimi.mockResolvedValue('```json\n{"message": "Opening question?", "shouldClose": false}\n```');

    const turn = await getNextAgentTurn({
      ...baseParams,
      conversationHistory: [],
      isFirstTurn: true,
    });

    expect(turn.message).toBe("Opening question?");
    expect(turn.shouldClose).toBe(false);
  });
});
