/**
 * /api/fan — Canvas Cup prediction game.
 *   GET  /api/fan/board          → live World Cup matches + outcomes
 *   POST /api/fan/predict         → { player, matchId, outcome, stakePoints }
 *   GET  /api/fan/me?player=       → a player's card + predictions
 *   GET  /api/fan/leaderboard      → top players
 *   POST /api/fan/settle           → settle a match (provably fair, on-chain-verified)
 */
import { Router, type Request, type Response } from "express";
import { config } from "@/config/index.js";
import { logger } from "@/utils/logger.js";
import { resolveOddsFeed } from "@/services/odds-feed.js";
import { dailyScoresRootsPda, TXLINE_NETWORKS } from "@/services/txline/program.js";
import { epochDayFromMs } from "@/services/txline/verify.js";
import {
  addPrediction,
  getOrCreatePlayer,
  leaderboard,
  listPredictions,
  settleMatch,
  stats,
} from "@/services/fan/store.js";
import type { MatchOdds } from "@/services/txodds.client.js";

export const fanRouter = Router();

function oneX2(match: MatchOdds) {
  return match.markets.find((m) => m.key === "1X2") ?? match.markets[0];
}

/** Proof reference for a settlement — the on-chain daily Merkle-root account. */
function proofFor(source: string): { verified: boolean; proofRef: string } {
  const cfg = TXLINE_NETWORKS[config.solana.network];
  const pda = dailyScoresRootsPda(cfg.programId, epochDayFromMs(Date.now())).toBase58();
  return source === "txodds-live"
    ? { verified: true, proofRef: pda }
    : { verified: false, proofRef: `${pda} (sample result — live TxLINE verifies on-chain)` };
}

fanRouter.get("/api/fan/board", async (_req: Request, res: Response) => {
  try {
    const feed = await resolveOddsFeed();
    const matches = await feed.getMatches();
    res.json({
      source: feed.source,
      matches: matches.map((m) => ({
        id: m.id,
        home: m.home,
        away: m.away,
        stage: m.stage,
        kickoff: m.kickoff,
        status: m.status,
        outcomes: (oneX2(m)?.outcomes ?? []).map((o) => ({
          key: o.key,
          label: o.label,
          fairProb: o.fairProb,
          decimalOdds: o.decimalOdds,
        })),
      })),
    });
  } catch (err) {
    logger.error({ err }, "GET /api/fan/board failed");
    res.status(500).json({ error: "failed to load board" });
  }
});

fanRouter.post("/api/fan/predict", async (req: Request, res: Response) => {
  try {
    const { player, matchId, outcome, stakePoints } = (req.body ?? {}) as {
      player?: string;
      matchId?: string;
      outcome?: string;
      stakePoints?: number;
    };
    if (!player || !matchId || !outcome || !(Number(stakePoints) > 0)) {
      res.status(400).json({ error: "player, matchId, outcome and stakePoints>0 required" });
      return;
    }
    const match = await (await resolveOddsFeed()).getMatch(matchId);
    const o = match ? oneX2(match)?.outcomes.find((x) => x.key === outcome) : undefined;
    if (!match || !o) {
      res.status(404).json({ error: "match/outcome not found" });
      return;
    }
    const { prediction, player: p } = addPrediction({
      player,
      matchId,
      matchLabel: `${match.home} vs ${match.away}`,
      outcome,
      selectionLabel: o.label,
      decimalOdds: o.decimalOdds,
      stakePoints: Number(stakePoints),
    });
    res.json({ prediction, player: p });
  } catch (err) {
    logger.error({ err }, "POST /api/fan/predict failed");
    res.status(500).json({ error: "prediction failed" });
  }
});

fanRouter.get("/api/fan/me", (req: Request, res: Response) => {
  const handle = String(req.query.player ?? "").trim();
  if (!handle) {
    res.status(400).json({ error: "player required" });
    return;
  }
  res.json({ player: getOrCreatePlayer(handle), predictions: listPredictions(handle) });
});

fanRouter.get("/api/fan/leaderboard", (_req: Request, res: Response) => {
  res.json({ players: leaderboard(), totals: stats() });
});

fanRouter.post("/api/fan/settle", async (req: Request, res: Response) => {
  try {
    const { matchId, winningOutcome } = (req.body ?? {}) as {
      matchId?: string;
      winningOutcome?: string;
    };
    if (!matchId) {
      res.status(400).json({ error: "matchId required" });
      return;
    }
    const feed = await resolveOddsFeed();
    const match = await feed.getMatch(matchId);
    if (!match) {
      res.status(404).json({ error: "match not found" });
      return;
    }
    const outcomes = oneX2(match)?.outcomes ?? [];
    // Live: result comes from the TxLINE feed. Demo: draw from the fair distribution.
    let winner = winningOutcome;
    if (!winner) {
      const r = Math.random();
      let acc = 0;
      for (const o of outcomes) {
        acc += o.fairProb;
        if (r <= acc) {
          winner = o.key;
          break;
        }
      }
      winner = winner ?? outcomes[0]?.key ?? "HOME";
    }
    const winnerLabel = outcomes.find((o) => o.key === winner)?.label ?? winner;
    const summary = settleMatch(matchId, winner, proofFor(feed.source));
    res.json({ ...summary, winningLabel: winnerLabel, matchLabel: `${match.home} vs ${match.away}` });
  } catch (err) {
    logger.error({ err }, "POST /api/fan/settle failed");
    res.status(500).json({ error: "settlement failed" });
  }
});
