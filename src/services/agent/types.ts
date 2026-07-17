/** Types for Canvas Edge — the autonomous, risk-managed sports-trading agent. */

export type ExecutionMode = "simulated" | "live";
export type StrategyKind = "value-edge" | "goal-trigger";

export interface RiskLimits {
  /** Hard ceiling on any single stake (USDC). */
  maxStakeUsd: number;
  /** Fraction of full Kelly to stake (default 0.5). */
  kellyFraction: number;
  /** Minimum edge (EV per $1) required to place a bet. */
  minEdge: number;
  /** Stop trading for the session once realized loss reaches this. */
  dailyLossCapUsd: number;
  /** Stop trading if bankroll falls below this fraction of the starting bankroll. */
  ruinStopFraction: number;
}

export interface AgentDecision {
  id: string;
  ts: number;
  strategy: StrategyKind;
  matchId: string;
  matchLabel: string;
  outcome: string;
  selectionLabel: string;
  fairProb: number;
  decimalOdds: number;
  edge: number;
  kellyStake: number;
  ruinProb: number;
  sharpe: number;
  action: "bet" | "skip" | "blocked";
  reason: string;
  /** On-chain verification of the triggering event (goal-trigger strategy). */
  verified?: boolean;
  proofRef?: string;
}

export interface AgentPosition {
  id: string;
  ts: number;
  matchId: string;
  selectionLabel: string;
  outcome: string;
  stake: number;
  decimalOdds: number;
  fairProb: number;
  status: "open" | "won" | "lost";
  pnl: number;
  mode: ExecutionMode;
  orderPrompt: string;
  jobId?: string;
  strategy: StrategyKind;
}

export interface AgentState {
  running: boolean;
  startedAt: number | null;
  lastTickTs: number | null;
  mode: ExecutionMode;
  source: string;
  startingBankroll: number;
  bankroll: number;
  realizedPnl: number;
  risk: RiskLimits;
  blockedReason: string | null;
  decisions: AgentDecision[];
  positions: AgentPosition[];
}

export const DEFAULT_RISK: RiskLimits = {
  maxStakeUsd: 100,
  kellyFraction: 0.5,
  minEdge: 0.03,
  dailyLossCapUsd: 300,
  ruinStopFraction: 0.5,
};
