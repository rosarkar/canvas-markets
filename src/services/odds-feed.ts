/**
 * Odds-feed resolver — picks the real TxLINE (Solana) feed when enabled and
 * reachable, otherwise falls back to the labelled sample/ TxODDS feed. One
 * async entry point so every surface (markets, agent, fan) shares the choice.
 */
import { config } from "@/config/index.js";
import { logger } from "@/utils/logger.js";
import { getOddsFeed as getTxoddsFeed, type OddsFeed } from "@/services/txodds.client.js";
import { TxLineFeed } from "@/services/txline/feed.js";

let cached: OddsFeed | null = null;
let resolvedSource: "txline-live" | "sample-fixtures" | null = null;
let resolvedAt: number | null = null;
let lastError: string | null = null;

export async function resolveOddsFeed(): Promise<OddsFeed> {
  if (cached) return cached;
  if (config.solana.useTxline) {
    try {
      const feed = new TxLineFeed();
      await feed.ensureReady();
      logger.info("Odds source: live TxLINE (Solana, on-chain-verified)");
      cached = feed;
      resolvedSource = "txline-live";
      resolvedAt = Date.now();
      lastError = null;
      return feed;
    } catch (err) {
      lastError = (err as Error).message;
      logger.warn(
        { err: lastError },
        "TxLINE feed unavailable (e.g. no devnet SOL) — falling back to sample fixtures",
      );
    }
  }
  cached = getTxoddsFeed();
  resolvedSource = "sample-fixtures";
  resolvedAt = Date.now();
  return cached;
}

/**
 * Snapshot of how the odds feed resolved for this process — surfaced by the
 * `/api/feed-status` debug route so live-vs-fixture can be diagnosed without
 * reading server logs. The choice is cached per process, so this reflects what
 * the running instance actually decided at first resolve.
 */
export function getFeedStatus(): {
  useTxline: boolean;
  resolved: boolean;
  resolvedSource: "txline-live" | "sample-fixtures" | null;
  resolvedAt: number | null;
  lastError: string | null;
} {
  return {
    useTxline: config.solana.useTxline,
    resolved: cached !== null,
    resolvedSource,
    resolvedAt,
    lastError,
  };
}

/** Reset the cached feed (used by tests / after config changes). */
export function resetOddsFeed(): void {
  cached = null;
  resolvedSource = null;
  resolvedAt = null;
  lastError = null;
}
