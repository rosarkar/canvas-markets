export function devig(odds: number[]): number[] {
  const sum = odds.reduce((a, o) => a + 1 / o, 0)
  return odds.map(o => 1 / o / sum)
}

export function edge(fairProb: number, marketOdds: number): number {
  return fairProb * marketOdds - 1
}

export function kelly(fairProb: number, marketOdds: number): number {
  const b = marketOdds - 1
  const f = (fairProb * marketOdds - 1) / b
  return Math.max(0, f)
}

export function halfKellyStake(fairProb: number, marketOdds: number, bankroll: number): number {
  return kelly(fairProb, marketOdds) * 0.5 * bankroll
}

export interface Outcome {
  key: string
  label: string
  txodds: number
  market: number
  fairProb?: number
  edge?: number
  /** Polymarket implied probability for this outcome, or null if no market. */
  polymarketProb?: number | null
  /** fairProb − polymarketProb: positive means underpriced on Polymarket. */
  polymarketEdge?: number | null
}

export interface Match {
  id: string
  stage: string
  home: string
  away: string
  status: 'scheduled' | 'live' | 'finished'
  outcomes: Outcome[]
  ou: Outcome[]
}

export const SAMPLE_MATCHES: Match[] = [
  {
    id: 'arg-mex', stage: 'Group C', home: 'Argentina', away: 'Mexico', status: 'live',
    outcomes: [
      { key: 'HOME', label: 'Argentina', txodds: 1.65, market: 1.85 },
      { key: 'DRAW', label: 'Draw', txodds: 3.8, market: 3.75 },
      { key: 'AWAY', label: 'Mexico', txodds: 5.5, market: 5.4 },
    ],
    ou: [
      { key: 'OVER', label: 'Over 2.5', txodds: 1.95, market: 2.05 },
      { key: 'UNDER', label: 'Under 2.5', txodds: 1.9, market: 1.85 },
    ],
  },
  {
    id: 'fra-usa', stage: 'Group D', home: 'France', away: 'USA', status: 'scheduled',
    outcomes: [
      { key: 'HOME', label: 'France', txodds: 1.5, market: 1.55 },
      { key: 'DRAW', label: 'Draw', txodds: 4.2, market: 4.1 },
      { key: 'AWAY', label: 'USA', txodds: 6.5, market: 7.2 },
    ],
    ou: [
      { key: 'OVER', label: 'Over 2.5', txodds: 1.8, market: 1.82 },
      { key: 'UNDER', label: 'Under 2.5', txodds: 2.05, market: 2.0 },
    ],
  },
  {
    id: 'bra-ger', stage: 'Round of 16', home: 'Brazil', away: 'Germany', status: 'scheduled',
    outcomes: [
      { key: 'HOME', label: 'Brazil', txodds: 2.3, market: 2.45 },
      { key: 'DRAW', label: 'Draw', txodds: 3.4, market: 3.35 },
      { key: 'AWAY', label: 'Germany', txodds: 3.1, market: 3.05 },
    ],
    ou: [
      { key: 'OVER', label: 'Over 2.5', txodds: 1.75, market: 1.9 },
      { key: 'UNDER', label: 'Under 2.5', txodds: 2.1, market: 2.0 },
    ],
  },
  {
    id: 'esp-por', stage: 'Quarter-final', home: 'Spain', away: 'Portugal', status: 'scheduled',
    outcomes: [
      { key: 'HOME', label: 'Spain', txodds: 2.15, market: 2.3 },
      { key: 'DRAW', label: 'Draw', txodds: 3.3, market: 3.25 },
      { key: 'AWAY', label: 'Portugal', txodds: 3.5, market: 3.4 },
    ],
    ou: [
      { key: 'OVER', label: 'Over 2.5', txodds: 1.85, market: 1.95 },
      { key: 'UNDER', label: 'Under 2.5', txodds: 2.0, market: 1.9 },
    ],
  },
  {
    id: 'arg-fra', stage: 'Final', home: 'Argentina', away: 'France', status: 'scheduled',
    outcomes: [
      { key: 'HOME', label: 'Argentina', txodds: 2.7, market: 2.95 },
      { key: 'DRAW', label: 'Draw', txodds: 3.2, market: 3.15 },
      { key: 'AWAY', label: 'France', txodds: 2.65, market: 2.6 },
    ],
    ou: [
      { key: 'OVER', label: 'Over 2.5', txodds: 2.05, market: 2.15 },
      { key: 'UNDER', label: 'Under 2.5', txodds: 1.8, market: 1.75 },
    ],
  },
]

export function enrichMatches(matches: Match[]): Match[] {
  return matches.map(m => {
    const outcomeFps = devig(m.outcomes.map(o => o.txodds))
    const ouFps = devig(m.ou.map(o => o.txodds))
    return {
      ...m,
      outcomes: m.outcomes.map((o, i) => ({
        ...o,
        fairProb: outcomeFps[i],
        edge: edge(outcomeFps[i], o.market),
      })),
      ou: m.ou.map((o, i) => ({
        ...o,
        fairProb: ouFps[i],
        edge: edge(ouFps[i], o.market),
      })),
    }
  })
}
