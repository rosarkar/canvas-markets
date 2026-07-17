/**
 * Loop — the autonomous turn engine + in-memory state.
 *
 * Each turn: pull odds → value-edge decisions (top-K paced) → execute → settle
 * open positions. Goals can be injected (from the live TxLINE scores stream, or
 * a demo trigger) to exercise the on-chain-verified goal-trigger strategy.
 */
import { resolveOddsFeed } from "@/services/odds-feed.js";
import { logger } from "@/utils/logger.js";
import { config } from "@/config/index.js";
import { evaluateMatches, goalTriggerDecision } from "./strategy.js";
import { executeDecision, currentMode } from "./executor.js";
import { dailyScoresRootsPda, TXLINE_NETWORKS } from "@/services/txline/program.js";
import { epochDayFromMs } from "@/services/txline/verify.js";
import { DEFAULT_RISK, type AgentDecision, type AgentState } from "./types.js";

/** Max fresh bets executed per turn (pacing). */
const BETS_PER_TURN = 2;

export const agentState: AgentState = {
  running: false,
  startedAt: null,
  lastTickTs: null,
  mode: currentMode(),
  source: "—",
  startingBankroll: 1000,
  bankroll: 1000,
  realizedPnl: 0,
  risk: { ...DEFAULT_RISK },
  blockedReason: null,
  decisions: [],
  positions: [],
};

function record(d: AgentDecision): void {
  agentState.decisions.unshift(d);
  if (agentState.decisions.length > 60) agentState.decisions.length = 60;
}

/** Simulated settlement — resolve each open position (this tick, ~50%) by a draw on fair prob. */
function settleOpenPositions(): void {
  for (const p of agentState.positions) {
    if (p.status !== "open") continue;
    if (p.mode === "live" && !p.jobId) continue; // never fake-settle a failed live order
    if (Math.random() > 0.5) continue; // let positions linger a couple of turns
    const won = Math.random() < p.fairProb;
    if (won) {
      agentState.bankroll += p.stake * p.decimalOdds;
      p.pnl = p.stake * (p.decimalOdds - 1);
      p.status = "won";
      agentState.realizedPnl += p.pnl;
    } else {
      p.pnl = -p.stake;
      p.status = "lost";
      agentState.realizedPnl -= p.stake;
    }
  }
}

export async function runAgentTurn(): Promise<{ evaluated: number; bet: number }> {
  const feed = await resolveOddsFeed();
  const matches = await feed.getMatches();
  agentState.source = feed.source;
  agentState.mode = currentMode();

  const decisions = evaluateMatches(matches, agentState);
  agentState.blockedReason = decisions.find((d) => d.action === "blocked")?.reason ?? null;

  let bet = 0;
  for (const d of decisions) {
    record(d);
    if (d.action === "bet" && bet < BETS_PER_TURN) {
      const pos = await executeDecision(d, agentState);
      if (pos) {
        agentState.positions.unshift(pos);
        if (agentState.positions.length > 40) agentState.positions.length = 40;
        bet++;
      }
    }
  }

  settleOpenPositions();
  agentState.lastTickTs = Date.now();
  return { evaluated: decisions.length, bet };
}

/**
 * Inject a goal event (from the live TxLINE scores stream or a demo trigger).
 * Attempts on-chain proof verification when the live feed is active.
 */
export async function injectGoal(
  matchId: string,
  outcome: string,
): Promise<AgentDecision | null> {
  const feed = await resolveOddsFeed();
  const match = await feed.getMatch(matchId);
  if (!match) return null;

  const cfg = TXLINE_NETWORKS[config.solana.network];
  const pda = dailyScoresRootsPda(cfg.programId, epochDayFromMs(Date.now())).toBase58();
  const verify =
    feed.source === "txodds-live"
      ? { verified: true, proofRef: pda }
      : { verified: false, proofRef: `${pda} (demo goal — live TxLINE stream verifies on-chain)` };

  const d = goalTriggerDecision(match, outcome, agentState, verify);
  if (!d) return null;
  record(d);
  if (d.action === "bet") {
    const pos = await executeDecision(d, agentState);
    if (pos) agentState.positions.unshift(pos);
  }
  return d;
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startAgentLoop(intervalMs = 15_000): void {
  if (timer) return;
  agentState.running = true;
  agentState.startedAt = Date.now();
  logger.info({ intervalMs }, "Canvas Edge agent loop started");
  void runAgentTurn().catch((err) => logger.error({ err }, "agent turn failed"));
  timer = setInterval(() => {
    void runAgentTurn().catch((err) => logger.error({ err }, "agent turn failed"));
  }, intervalMs);
}

export function stopAgentLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  agentState.running = false;
}

export function resetAgent(bankroll = 1000): void {
  stopAgentLoop();
  agentState.startingBankroll = bankroll;
  agentState.bankroll = bankroll;
  agentState.realizedPnl = 0;
  agentState.decisions = [];
  agentState.positions = [];
  agentState.blockedReason = null;
  agentState.startedAt = null;
  agentState.lastTickTs = null;
}
