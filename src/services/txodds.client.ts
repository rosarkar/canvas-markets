/**
 * TxODDS odds feed — the pricing/oracle source for the risk desk.
 *
 * A single `OddsFeed` interface with two implementations chosen at runtime:
 *  - `FixtureFeed`: sample World Cup 2026 data (default, no key needed).
 *  - `LiveFeed`:    the real TxODDS HTTPS feed, selected when TXODDS_API_KEY is set.
 *
 * The rest of the app depends only on the interface, so going live is a one-env-var
 * swap. Fair probabilities are de-vigged from the sharp TxODDS line; the edge is
 * measured against the tradeable on-chain price.
 */
import { config } from "@/config/index.js";
import { logger } from "@/utils/logger.js";
import { devigMultiplicative } from "@/services/risk/index.js";
import { FIXTURE_MATCHES, type FixtureMatch } from "@/services/txodds.fixtures.js";

export type FeedSource = "txodds-live" | "fixture";

export interface MarketOutcome {
  key: string;
  label: string;
  /** Fair win probability, de-vigged from the sharp TxODDS line. */
  fairProb: number;
  /** Tradeable decimal odds on the settlement venue. */
  decimalOdds: number;
  /** Market's own implied probability (1/decimalOdds). */
  impliedProb: number;
  /** fairProb·decimalOdds − 1: expected value per unit staked. */
  edge: number;
}

export interface MarketView {
  key: string;
  label: string;
  outcomes: MarketOutcome[];
}

export interface MatchSummary {
  id: string;
  competition: string;
  stage: string;
  home: string;
  away: string;
  kickoff: string;
  status: "scheduled" | "live" | "finished";
}

export interface MatchOdds extends MatchSummary {
  markets: MarketView[];
  /** Best positive edge available across this match's markets (for ranking/UI). */
  bestEdge: number;
  source: FeedSource;
}

export interface OddsFeed {
  readonly source: FeedSource;
  getMatches(): Promise<MatchOdds[]>;
  getMatch(id: string): Promise<MatchOdds | undefined>;
}

/** Map a fixture record into the computed, de-vigged view served to the app. */
function fixtureToMatchOdds(m: FixtureMatch, source: FeedSource): MatchOdds {
  let bestEdge = -Infinity;
  const markets: MarketView[] = m.markets.map((mk) => {
    const fair = devigMultiplicative(mk.outcomes.map((o) => o.txodds));
    const outcomes: MarketOutcome[] = mk.outcomes.map((o, i) => {
      const fairProb = fair[i];
      const edge = fairProb * o.market - 1;
      if (edge > bestEdge) bestEdge = edge;
      return {
        key: o.key,
        label: o.label,
        fairProb,
        decimalOdds: o.market,
        impliedProb: 1 / o.market,
        edge,
      };
    });
    return { key: mk.key, label: mk.label, outcomes };
  });
  return {
    id: m.id,
    competition: m.competition,
    stage: m.stage,
    home: m.home,
    away: m.away,
    kickoff: m.kickoff,
    status: m.status,
    markets,
    bestEdge,
    source,
  };
}

/** Sample-data feed — the default when no TxODDS key is configured. */
export class FixtureFeed implements OddsFeed {
  readonly source: FeedSource = "fixture";

  async getMatches(): Promise<MatchOdds[]> {
    return FIXTURE_MATCHES.map((m) => fixtureToMatchOdds(m, this.source));
  }

  async getMatch(id: string): Promise<MatchOdds | undefined> {
    const m = FIXTURE_MATCHES.find((x) => x.id === id);
    return m ? fixtureToMatchOdds(m, this.source) : undefined;
  }
}

/**
 * Live TxODDS feed. The exact response schema is provided with hackathon
 * credentials; the mapping below is the single place to adapt to it. Until then
 * the factory never selects this path, so the demo always has data.
 */
export class LiveFeed implements OddsFeed {
  readonly source: FeedSource = "txodds-live";
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`TxODDS ${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async getMatches(): Promise<MatchOdds[]> {
    // TODO(hackathon-creds): map the real TxODDS soccer feed here. Expected to
    // fetch World Cup fixtures + 1X2/OU odds and reuse `fixtureToMatchOdds`'s
    // de-vig logic. Kept explicit so the swap is a single, reviewable change.
    throw new Error("LiveFeed not wired — supply the TxODDS hackathon schema, then map it here.");
  }

  async getMatch(id: string): Promise<MatchOdds | undefined> {
    void id;
    throw new Error("LiveFeed not wired — supply the TxODDS hackathon schema, then map it here.");
  }
}

let cached: OddsFeed | null = null;

/** Returns the live feed when a TxODDS key is present, else the fixture feed. */
export function getOddsFeed(): OddsFeed {
  if (cached) return cached;
  if (config.markets.txoddsApiKey) {
    logger.info("TxODDS key present — using live feed");
    cached = new LiveFeed(config.markets.txoddsApiKey, config.markets.txoddsBaseUrl);
  } else {
    logger.info("No TxODDS key — using sample World Cup fixtures");
    cached = new FixtureFeed();
  }
  return cached;
}
