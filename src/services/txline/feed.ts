/**
 * TxLineFeed — adapts the real TxLINE Solana data to our existing `OddsFeed`
 * interface, so the risk engine, markets UI, trading agent, and fan app all
 * consume live on-chain-verified World Cup data with zero downstream changes.
 *
 * StablePrice (`OddsPayload.Pct[]`) is already de-margined, so it maps straight
 * to `fairProb`; `Prices[]` are the tradeable decimal odds. If the on-chain
 * subscription can't be established (e.g. no devnet SOL), callers fall back to
 * the labelled sample `FixtureFeed`.
 */
import { config } from "@/config/index.js";
import { logger } from "@/utils/logger.js";
import type {
  FeedSource,
  MarketOutcome,
  MarketView,
  MatchOdds,
  OddsFeed,
} from "@/services/txodds.client.js";
import { TXLINE_NETWORKS } from "./program.js";
import { loadOrCreateKeypair } from "./wallet.js";
import { TxLineClient, type TxLineFixture, type TxLineOddsPayload } from "./client.js";

/** Map TxLINE outcome labels to our canonical keys. */
function outcomeKey(name: string, index: number, count: number): string {
  const n = name.trim().toLowerCase();
  if (["1", "home", "h"].includes(n)) return "HOME";
  if (["x", "draw", "d", "tie"].includes(n)) return "DRAW";
  if (["2", "away", "a"].includes(n)) return "AWAY";
  if (/over/.test(n)) return "OVER_2_5";
  if (/under/.test(n)) return "UNDER_2_5";
  // Positional fallback for a 3-way market.
  if (count === 3) return ["HOME", "DRAW", "AWAY"][index] ?? name.toUpperCase();
  return name.toUpperCase();
}

/** Pick the full-time 1X2 result market from a fixture's odds payloads. */
function pickMainMarket(odds: TxLineOddsPayload[]): TxLineOddsPayload | undefined {
  // Only the 1X2 match-result market. A "draw" outcome is the reliable signal;
  // never fall back to a 2-way market (e.g. Asian handicap) as the match result.
  const is1x2 = (o: TxLineOddsPayload) =>
    /1x2/i.test(o.SuperOddsType ?? "") || Boolean(o.PriceNames?.some((n) => /draw/i.test(n)));
  return (
    odds.find((o) => is1x2(o) && !o.InRunning) ??
    odds.find((o) => is1x2(o)) ??
    odds.find((o) => o.PriceNames?.length === 3 && !o.InRunning) ??
    odds.find((o) => o.PriceNames?.length === 3)
  );
}

function toMatchOdds(fx: TxLineFixture, odds: TxLineOddsPayload[], source: FeedSource): MatchOdds {
  const home = fx.Participant1IsHome ? fx.Participant1 : fx.Participant2;
  const away = fx.Participant1IsHome ? fx.Participant2 : fx.Participant1;
  const main = pickMainMarket(odds);
  const markets: MarketView[] = [];
  let bestEdge = -Infinity;

  if (main && main.PriceNames?.length) {
    const n = main.PriceNames.length;
    // 1X2 display labels are the teams (raw feed names are "part1"/"draw"/"part2").
    const label3 = [home, "Draw", away];
    const outcomes: MarketOutcome[] = main.PriceNames.map((name, i) => {
      // TxLINE Prices are milli-odds (3333 → 3.333); Pct is a percentage string
      // ("30.003"). Normalise both, guarding malformed/missing values.
      const rawPrice = Number(main.Prices?.[i]) || 0;
      const decimalOdds = rawPrice > 100 ? rawPrice / 1000 : rawPrice;
      const rawPct = Number(main.Pct?.[i]);
      const fairProb = Number.isFinite(rawPct) ? (rawPct > 1 ? rawPct / 100 : rawPct) : 0;
      const edge = decimalOdds > 0 && fairProb > 0 ? fairProb * decimalOdds - 1 : 0;
      if (edge > bestEdge) bestEdge = edge;
      return {
        key: outcomeKey(name, i, n),
        label: n === 3 ? (label3[i] ?? name) : name,
        fairProb,
        decimalOdds,
        impliedProb: decimalOdds > 0 ? 1 / decimalOdds : 0,
        edge,
      };
    });
    markets.push({ key: "1X2", label: "Match Result", outcomes });
  }

  return {
    id: `txl-${fx.FixtureId}`,
    competition: fx.Competition,
    stage: fx.Competition,
    home,
    away,
    kickoff: new Date(fx.StartTime * (fx.StartTime > 1e12 ? 1 : 1000)).toISOString(),
    status: main?.InRunning ? "live" : "scheduled",
    markets,
    bestEdge: Number.isFinite(bestEdge) ? bestEdge : 0,
    source,
  };
}

export class TxLineFeed implements OddsFeed {
  readonly source: FeedSource = "txodds-live";
  private client: TxLineClient | null = null;
  private fixtureIdByMatch = new Map<string, number>();

  /** Establish the on-chain subscription + API token. Throws on failure. */
  async ensureReady(): Promise<void> {
    if (this.client?.isActivated()) return;
    const cfg = TXLINE_NETWORKS[config.solana.network];
    const { keypair } = loadOrCreateKeypair(config.solana.devnetSecretKey);
    const client = new TxLineClient(cfg, keypair);
    await client.connect(4); // subscribe + activate (needs SOL)
    this.client = client;
    logger.info("TxLineFeed ready (live TxLINE data)");
  }

  private async load(): Promise<MatchOdds[]> {
    if (!this.client) await this.ensureReady();
    const client = this.client!;
    const fixtures = await client.getFixtures();
    const now = Date.now() / 1000;
    const upcoming = fixtures
      .filter((f) => /world cup|friendl/i.test(f.Competition))
      .sort((a, b) => a.StartTime - b.StartTime)
      .slice(0, 16);
    const list = upcoming.length ? upcoming : fixtures.slice(0, 16);

    const out: MatchOdds[] = [];
    for (const fx of list) {
      let odds: TxLineOddsPayload[] = [];
      try {
        odds = await client.getOdds(fx.FixtureId);
      } catch {
        /* no odds yet for this fixture */
      }
      const mo = toMatchOdds(fx, odds, this.source);
      this.fixtureIdByMatch.set(mo.id, fx.FixtureId);
      out.push(mo);
    }
    void now;
    return out;
  }

  async getMatches(): Promise<MatchOdds[]> {
    return this.load();
  }

  async getMatch(id: string): Promise<MatchOdds | undefined> {
    const all = await this.load();
    return all.find((m) => m.id === id);
  }

  /** Expose the underlying TxLINE fixture id for a match (for score verification). */
  fixtureIdFor(matchId: string): number | undefined {
    return this.fixtureIdByMatch.get(matchId);
  }

  get txClient(): TxLineClient | null {
    return this.client;
  }
}
