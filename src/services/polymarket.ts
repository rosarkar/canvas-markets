/**
 * Polymarket odds source — the *tradeable* side of the edge.
 *
 * We already de-vig a fair probability from the sharp TxLINE/TxODDS line
 * (`fairProb`). Polymarket is where a bet can actually be placed, so its implied
 * probability is the price we measure that fair value against:
 *
 *   polymarketEdge = fairProb − polymarketProb
 *
 * A positive number means TxLINE thinks the outcome is *underpriced* on
 * Polymarket (the market gives it less chance than the sharp line does).
 *
 * Source: the public Gamma API (https://gamma-api.polymarket.com). World Cup
 * match markets appear near kickoff as an event titled "Home vs. Away" whose
 * outcomes are Home / Draw / Away. Two shapes are handled:
 *   1. a single market with three outcomes ["Home","Draw","Away"];
 *   2. three grouped binary Yes/No markets, one per outcome, each carrying its
 *      outcome name in `groupItemTitle` (the "Yes" price is that prob).
 *
 * Everything here degrades to `null` rather than throwing: if the API is down,
 * slow, or simply has no market for a fixture, the feed is unaffected.
 */
import { logger } from "@/utils/logger.js";
import { type MatchOdds } from "@/services/txodds.client.js";

const GAMMA_BASE = process.env.POLYMARKET_GAMMA_URL ?? "https://gamma-api.polymarket.com";
/** Gamma tag for the tournament; overridable if Polymarket re-slugs it. */
const WORLD_CUP_TAG = process.env.POLYMARKET_WC_TAG ?? "world-cup";
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60_000;

/** Implied probabilities for a 1X2 market, normalised to sum to 1. */
export interface PolymarketMatchProbs {
  HOME: number;
  DRAW: number;
  AWAY: number;
}

interface GammaMarket {
  question?: string;
  groupItemTitle?: string;
  outcomes?: string; // JSON-encoded string array, e.g. "[\"Yes\",\"No\"]"
  outcomePrices?: string; // JSON-encoded string array, e.g. "[\"0.6\",\"0.4\"]"
  active?: boolean;
  closed?: boolean;
}

interface GammaEvent {
  title?: string;
  slug?: string;
  closed?: boolean;
  markets?: GammaMarket[];
}

let cache: { at: number; events: GammaEvent[] } | null = null;

/** Strip accents/punctuation/casing so "United States" ≈ "usa" comparisons work. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Common country aliases where our fixture name and Polymarket's label differ. */
const ALIASES: Record<string, string[]> = {
  usa: ["united states", "united states of america", "us"],
  "united states": ["usa", "us"],
  netherlands: ["holland"],
  "south korea": ["korea republic", "korea"],
};

function labelsMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const aliasA = ALIASES[na] ?? [];
  const aliasB = ALIASES[nb] ?? [];
  return aliasA.some((x) => normalize(x) === nb) || aliasB.some((x) => normalize(x) === na);
}

/** Parse a Gamma JSON-string array field into a real array (tolerant of arrays). */
function parseArray(field: string | undefined): string[] {
  if (!field) return [];
  if (Array.isArray(field)) return field as string[];
  try {
    const parsed = JSON.parse(field);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Flatten an event's markets into (label → implied probability) pairs, covering
 * both the single-3-outcome and grouped-binary shapes.
 */
function outcomeProbs(event: GammaEvent): Map<string, number> {
  const probs = new Map<string, number>();
  for (const mk of event.markets ?? []) {
    if (mk.closed) continue;
    const outcomes = parseArray(mk.outcomes);
    const prices = parseArray(mk.outcomePrices).map(Number);
    if (outcomes.length !== prices.length || outcomes.length === 0) continue;

    const isBinaryYesNo =
      outcomes.length === 2 && outcomes.every((o) => /^(yes|no)$/i.test(o));

    if (isBinaryYesNo) {
      // Grouped market: the outcome name lives in groupItemTitle; use "Yes" price.
      const title = mk.groupItemTitle?.trim();
      if (!title) continue;
      const yesIdx = outcomes.findIndex((o) => /^yes$/i.test(o));
      const p = prices[yesIdx];
      if (Number.isFinite(p)) probs.set(title, p);
    } else {
      // Multi-outcome market: each outcome label maps to its own price.
      outcomes.forEach((label, i) => {
        const p = prices[i];
        if (label && Number.isFinite(p)) probs.set(label, p);
      });
    }
  }
  return probs;
}

const DRAW_LABELS = ["draw", "tie"];

/** Extract HOME/DRAW/AWAY implied probs for one fixture, or null if unavailable. */
function extractMatchProbs(
  event: GammaEvent,
  home: string,
  away: string,
): PolymarketMatchProbs | null {
  const probs = outcomeProbs(event);
  if (probs.size === 0) return null;

  let homeP: number | undefined;
  let awayP: number | undefined;
  let drawP: number | undefined;
  for (const [label, p] of probs) {
    if (homeP === undefined && labelsMatch(label, home)) homeP = p;
    else if (awayP === undefined && labelsMatch(label, away)) awayP = p;
    else if (drawP === undefined && DRAW_LABELS.some((d) => normalize(label) === d)) drawP = p;
  }
  if (homeP === undefined || awayP === undefined || drawP === undefined) return null;

  const sum = homeP + drawP + awayP;
  if (!(sum > 0)) return null;
  // Normalise so the three sum to 1 (Gamma prices can drift slightly off 1).
  return { HOME: homeP / sum, DRAW: drawP / sum, AWAY: awayP / sum };
}

/** Does this event look like the given fixture (both team names present)? */
function eventMatchesFixture(event: GammaEvent, home: string, away: string): boolean {
  const title = event.title ?? "";
  if (labelsContain(title, home) && labelsContain(title, away)) return true;
  // Fall back to the outcome labels if the title is not a clean "A vs B".
  const labels = [...outcomeProbs(event).keys()];
  const hasHome = labels.some((l) => labelsMatch(l, home));
  const hasAway = labels.some((l) => labelsMatch(l, away));
  return hasHome && hasAway;
}

/** Whether `team` (or an alias) appears as a token-run inside `text`. */
function labelsContain(text: string, team: string): boolean {
  const nt = normalize(text);
  const candidates = [team, ...(ALIASES[normalize(team)] ?? [])];
  return candidates.some((c) => {
    const nc = normalize(c);
    return nc.length > 0 && nt.includes(nc);
  });
}

/** Fetch (and cache) the World Cup events from Gamma. Returns [] on any failure. */
async function fetchWorldCupEvents(): Promise<GammaEvent[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.events;
  try {
    const url = `${GAMMA_BASE}/events?closed=false&limit=500&tag_slug=${encodeURIComponent(WORLD_CUP_TAG)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Gamma /events → HTTP ${res.status}`);
    const events = (await res.json()) as GammaEvent[];
    const list = Array.isArray(events) ? events : [];
    cache = { at: Date.now(), events: list };
    return list;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "Polymarket Gamma fetch failed — polymarketProb will be null",
    );
    return [];
  }
}

/**
 * Look up Polymarket implied probabilities for a single fixture.
 * Returns null when Polymarket has no matching market (feed stays intact).
 */
export async function getPolymarketProbs(
  home: string,
  away: string,
): Promise<PolymarketMatchProbs | null> {
  const events = await fetchWorldCupEvents();
  for (const event of events) {
    if (event.closed) continue;
    if (!eventMatchesFixture(event, home, away)) continue;
    const probs = extractMatchProbs(event, home, away);
    if (probs) return probs;
  }
  return null;
}

/**
 * Enrich matches in place with Polymarket implied probability and the resulting
 * edge on each 1X2 (Match Result) outcome. Never throws; outcomes without a
 * Polymarket market get `polymarketProb: null` / `polymarketEdge: null`.
 */
export async function enrichWithPolymarket(matches: MatchOdds[]): Promise<MatchOdds[]> {
  await Promise.all(
    matches.map(async (match) => {
      let probs: PolymarketMatchProbs | null = null;
      try {
        probs = await getPolymarketProbs(match.home, match.away);
      } catch (err) {
        logger.warn(
          { err: (err as Error).message, match: `${match.home} vs ${match.away}` },
          "Polymarket enrichment failed for match",
        );
      }
      for (const market of match.markets) {
        // Only the 1X2 / Match Result market maps cleanly to Home/Draw/Away.
        const is1X2 = market.key === "1X2";
        for (const outcome of market.outcomes) {
          const pm =
            is1X2 && probs && (outcome.key === "HOME" || outcome.key === "DRAW" || outcome.key === "AWAY")
              ? probs[outcome.key]
              : null;
          outcome.polymarketProb = pm;
          outcome.polymarketEdge = pm === null ? null : outcome.fairProb - pm;
        }
      }
    }),
  );
  return matches;
}
