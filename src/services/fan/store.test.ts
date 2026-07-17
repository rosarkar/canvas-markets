import { beforeEach, describe, expect, it } from "vitest";
import { _reset, addPrediction, getOrCreatePlayer, leaderboard, settleMatch } from "./store.js";

const base = {
  matchId: "m1",
  matchLabel: "A v B",
  outcome: "HOME",
  selectionLabel: "A",
  decimalOdds: 2.0,
};

describe("fan store", () => {
  beforeEach(() => _reset());

  it("debits stake points on prediction", () => {
    const { player } = addPrediction({ player: "alice", ...base, stakePoints: 100 });
    expect(player.points).toBe(900); // 1000 start − 100
  });

  it("pays winners stake × odds and grows the streak", () => {
    addPrediction({ player: "alice", ...base, stakePoints: 100 });
    const sum = settleMatch("m1", "HOME", { verified: true, proofRef: "pda" });
    expect(sum.settled).toBe(1);
    expect(sum.winners).toBe(1);
    const p = getOrCreatePlayer("alice");
    expect(p.points).toBe(1100); // 900 + 100×2.0
    expect(p.wins).toBe(1);
    expect(p.streak).toBe(1);
  });

  it("burns the stake and resets streak on a wrong pick", () => {
    addPrediction({ player: "bob", ...base, stakePoints: 300 });
    settleMatch("m1", "AWAY", { verified: false, proofRef: "pda" });
    const p = getOrCreatePlayer("bob");
    expect(p.points).toBe(700); // 1000 − 300, no payout
    expect(p.losses).toBe(1);
    expect(p.streak).toBe(0);
  });

  it("caps a stake at the player's available points", () => {
    const { prediction } = addPrediction({ player: "carol", ...base, stakePoints: 99_999 });
    expect(prediction.stakePoints).toBe(1000);
  });

  it("ranks the leaderboard by points", () => {
    addPrediction({ player: "hi", ...base, stakePoints: 100 });
    settleMatch("m1", "HOME", { verified: true, proofRef: "pda" }); // hi → 1100
    addPrediction({ player: "lo", ...base, matchId: "m2", stakePoints: 400 });
    settleMatch("m2", "AWAY", { verified: true, proofRef: "pda" }); // lo → 600
    const board = leaderboard();
    expect(board[0].handle).toBe("hi");
    expect(board[board.length - 1].handle).toBe("lo");
  });
});
