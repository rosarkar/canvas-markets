import Head from 'next/head'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import Nav from '../components/Nav'

interface RiskLimits {
  maxStakeUsd: number
  kellyFraction: number
  minEdge: number
  dailyLossCapUsd: number
  ruinStopFraction: number
}

interface AgentDecision {
  id: string
  ts: number
  strategy: string
  matchLabel: string
  selectionLabel: string
  edge: number
  kellyStake: number
  action: 'bet' | 'skip' | 'blocked'
  reason: string
  verified?: boolean
}

interface AgentPosition {
  id: string
  ts: number
  selectionLabel: string
  strategy: string
  stake: number
  decimalOdds: number
  status: 'open' | 'won' | 'lost'
  pnl: number
}

interface AgentStateView {
  running: boolean
  mode: string
  source: string
  bankroll: number
  startingBankroll: number
  realizedPnl: number
  openPositions: number
  risk: RiskLimits
  blockedReason: string | null
  decisions: AgentDecision[]
  positions: AgentPosition[]
}

interface AgentMatch {
  id: string
  home: string
  away: string
  outcomes: { key: string; label: string }[]
}

const cell: React.CSSProperties = { padding: '6px 8px', fontSize: 12, borderBottom: '1px solid var(--border)', textAlign: 'left' }
const th: React.CSSProperties = { ...cell, color: 'var(--muted)', fontSize: 11 }
const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', padding: 14, marginBottom: 12 }
// Secondary button: white fill, black border, black text.
const btn: React.CSSProperties = { fontSize: 12, padding: '6px 14px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }
// Primary action: black fill, white text.
const btnFill: React.CSSProperties = { ...btn, background: '#000', color: '#fff', border: '1px solid #000' }
// Kill switch: red fill, white text.
const btnKill: React.CSSProperties = { ...btn, background: '#dc2626', color: '#fff', border: '1px solid #dc2626' }
const inp: React.CSSProperties = { fontSize: 12, background: 'var(--surface)', border: '1px solid var(--border)', padding: '4px 8px', color: 'var(--text)', width: 80 }

async function api(path: string, body?: unknown) {
  const res = await fetch(`/api/agent/${path}`, body === undefined
    ? undefined
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json()
}

const ACTION_COLORS: Record<string, string> = { bet: 'var(--green)', skip: 'var(--muted-2)', blocked: 'var(--red)' }
const STATUS_COLORS: Record<string, string> = { open: 'var(--blue)', won: 'var(--green)', lost: 'var(--red)' }

const RISK_SLIDERS: { key: keyof RiskLimits; label: string; min: number; max: number; step: number; fmt: (v: number) => string }[] = [
  { key: 'minEdge', label: 'Min edge', min: 0, max: 0.15, step: 0.005, fmt: v => `${(v * 100).toFixed(1)}%` },
  { key: 'kellyFraction', label: 'Kelly fraction', min: 0.1, max: 1, step: 0.05, fmt: v => `${v.toFixed(2)}×` },
  { key: 'maxStakeUsd', label: 'Max stake', min: 10, max: 500, step: 10, fmt: v => `$${v}` },
  { key: 'dailyLossCapUsd', label: 'Daily loss cap', min: 50, max: 1000, step: 25, fmt: v => `$${v}` },
  { key: 'ruinStopFraction', label: 'Ruin stop', min: 0.1, max: 0.9, step: 0.05, fmt: v => `${(v * 100).toFixed(0)}% of start` },
]

export default function AgentPage() {
  const [state, setState] = useState<AgentStateView | null>(null)
  const [matches, setMatches] = useState<AgentMatch[]>([])
  const [bankrollInput, setBankrollInput] = useState(1000)
  const [goalMatch, setGoalMatch] = useState('')
  const [goalOutcome, setGoalOutcome] = useState('HOME')
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    try {
      setState(await api('state'))
      setError(null)
    } catch {
      setError('Backend unreachable — check CANVAS_AGENT_URL')
    }
  }, [])

  useEffect(() => {
    refresh()
    api('matches').then(d => {
      setMatches(d.matches ?? [])
      if (d.matches?.[0]) setGoalMatch(d.matches[0].id)
    }).catch(() => {})
  }, [refresh])

  useEffect(() => {
    if (state?.running && !pollRef.current) {
      pollRef.current = setInterval(refresh, 3000)
    } else if (!state?.running && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [state?.running, refresh])

  async function act(path: string, body?: unknown) {
    try {
      await api(path, body ?? {})
      await refresh()
    } catch {
      setError(`${path} failed`)
    }
  }

  function setRisk(key: keyof RiskLimits, value: number) {
    if (!state) return
    setState({ ...state, risk: { ...state.risk, [key]: value } })
  }

  const selMatch = matches.find(m => m.id === goalMatch)

  return (
    <>
      <Head><title>Canvas Edge — Autonomous Agent</title></Head>
      <div style={{ padding: '1.5rem clamp(1rem, 3vw, 3rem)' }}>
        <Nav />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Autonomous risk-limited betting agent — TxLINE StablePrice, Kelly-sized, kill switch</span>
          <Link href="/judges" title="What's real vs simulated — verify on-chain" style={{
            marginLeft: 'auto', fontSize: 11, fontWeight: 600, padding: '4px 10px', textDecoration: 'none',
            color: 'var(--text)', border: '1px solid var(--border)',
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}>
            Verify on-chain
          </Link>
        </div>

        {error && (
          <div style={{ ...card, borderColor: 'var(--red)', color: 'var(--red)', fontSize: 13 }}>{error}</div>
        )}

        {/* Controls */}
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => act(state?.running ? 'stop' : 'start')} style={btnFill}>
            {state?.running ? 'Stop' : 'Start'}
          </button>
          <button onClick={() => act('tick')} style={btnFill}>Step</button>
          <button onClick={() => act('reset', { bankroll: bankrollInput })} style={btnFill}>Reset</button>
          <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>bankroll</span>
          <input type="number" value={bankrollInput} onChange={e => setBankrollInput(Number(e.target.value))} style={inp} />
          <button
            onClick={() => act('stop').then(() => act('risk', { maxStakeUsd: 0 }))}
            style={{ ...btnKill, marginLeft: 'auto' }}
          >
            Kill switch
          </button>
          {state && (
            <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>
              {state.mode} · {state.source}{state.blockedReason ? ` · blocked: ${state.blockedReason}` : ''}
            </span>
          )}
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 12 }}>
          {[
            { label: 'Bankroll', value: state ? `$${state.bankroll.toFixed(2)}` : '—' },
            { label: 'Realized P&L', value: state ? `${state.realizedPnl >= 0 ? '+' : ''}$${state.realizedPnl.toFixed(2)}` : '—', color: state ? (state.realizedPnl >= 0 ? 'var(--green)' : 'var(--red)') : undefined },
            { label: 'Open positions', value: state ? String(state.openPositions) : '—' },
            { label: 'Decisions', value: state ? String(state.decisions.length) : '—' },
          ].map(s => (
            <div key={s.label} style={card}>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: s.color ?? 'var(--text)' }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 12, alignItems: 'start' }}>
          <div>
            {/* Risk sliders */}
            <div style={card}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>Risk limits</div>
              {RISK_SLIDERS.map(s => (
                <div key={s.key} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: 'var(--muted)' }}>{s.label}</span>
                    <span style={{ color: 'var(--accent)' }}>{state ? s.fmt(state.risk[s.key]) : '—'}</span>
                  </div>
                  <input
                    type="range" min={s.min} max={s.max} step={s.step}
                    value={state?.risk[s.key] ?? s.min}
                    onChange={e => setRisk(s.key, Number(e.target.value))}
                    onMouseUp={() => state && act('risk', { [s.key]: state.risk[s.key] })}
                    onTouchEnd={() => state && act('risk', { [s.key]: state.risk[s.key] })}
                    style={{ width: '100%', accentColor: 'var(--accent)' }}
                  />
                </div>
              ))}
            </div>

            {/* Inject goal */}
            <div style={card}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>Goal event trigger</div>
              <select value={goalMatch} onChange={e => setGoalMatch(e.target.value)} style={{ ...inp, width: '100%', marginBottom: 6 }}>
                {matches.map(m => <option key={m.id} value={m.id}>{m.home} vs {m.away}</option>)}
              </select>
              <select value={goalOutcome} onChange={e => setGoalOutcome(e.target.value)} style={{ ...inp, width: '100%', marginBottom: 8 }}>
                {(selMatch?.outcomes ?? []).map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <button onClick={() => act('goal', { matchId: goalMatch, outcome: goalOutcome })} style={{ ...btn, width: '100%' }}>
                Inject goal
              </button>
            </div>
          </div>

          <div>
            {/* Decision feed */}
            <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>Decision feed</div>
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={th}>Time</th><th style={th}>Strategy</th><th style={th}>Match</th><th style={th}>Pick</th><th style={th}>Edge</th><th style={th}>Action</th>
                  </tr></thead>
                  <tbody>
                    {(state?.decisions ?? []).slice().reverse().map(d => (
                      <tr key={d.id}>
                        <td style={{ ...cell, color: 'var(--muted-2)' }}>{new Date(d.ts).toLocaleTimeString()}</td>
                        <td style={{ ...cell, color: 'var(--muted)' }}>{d.strategy}{d.verified ? ' ✓' : ''}</td>
                        <td style={cell}>{d.matchLabel}</td>
                        <td style={cell}>{d.selectionLabel}</td>
                        <td style={{ ...cell, color: d.edge > 0 ? 'var(--green)' : 'var(--red)' }}>{d.edge > 0 ? '+' : ''}{(d.edge * 100).toFixed(1)}%</td>
                        <td style={{ ...cell, color: ACTION_COLORS[d.action], fontSize: 11, fontWeight: 600 }} title={d.reason}>{d.action}</td>
                      </tr>
                    ))}
                    {!state?.decisions.length && (
                      <tr><td style={{ ...cell, color: 'var(--muted-2)' }} colSpan={6}>No decisions yet — start the loop or step once.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Positions */}
            <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>Positions</div>
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={th}>Pick</th><th style={th}>Strategy</th><th style={th}>Stake</th><th style={th}>Odds</th><th style={th}>Status</th><th style={th}>P&L</th>
                  </tr></thead>
                  <tbody>
                    {(state?.positions ?? []).slice().reverse().map(p => (
                      <tr key={p.id}>
                        <td style={cell}>{p.selectionLabel}</td>
                        <td style={{ ...cell, color: 'var(--muted)' }}>{p.strategy}</td>
                        <td style={cell}>${p.stake.toFixed(2)}</td>
                        <td style={cell}>{p.decimalOdds.toFixed(2)}</td>
                        <td style={{ ...cell, color: STATUS_COLORS[p.status], fontSize: 11, fontWeight: 600 }}>{p.status}</td>
                        <td style={{ ...cell, color: p.pnl > 0 ? 'var(--green)' : p.pnl < 0 ? 'var(--red)' : 'var(--muted-2)' }}>
                          {p.status === 'open' ? '—' : `${p.pnl >= 0 ? '+' : ''}$${p.pnl.toFixed(2)}`}
                        </td>
                      </tr>
                    ))}
                    {!state?.positions.length && (
                      <tr><td style={{ ...cell, color: 'var(--muted-2)' }} colSpan={6}>No positions yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div style={{ fontSize: 11, color: 'var(--muted-2)', textAlign: 'center', padding: 8 }}>
          Not financial advice · settlement simulated
        </div>
      </div>
      <style>{`button:hover { opacity: .8; } input:focus, select:focus { outline: none; border-color: #000 !important; }`}</style>
    </>
  )
}
