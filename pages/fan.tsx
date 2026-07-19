import Head from 'next/head'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import Nav from '../components/Nav'

interface FanOutcome {
  key: string
  label: string
  fairProb: number
  decimalOdds: number
}

interface FanMatch {
  id: string
  home: string
  away: string
  stage: string
  status: string
  settled: boolean
  outcomes: FanOutcome[]
}

interface Player {
  handle: string
  points: number
  wins: number
  losses: number
  streak: number
  bestStreak: number
  predictions: number
}

interface Prediction {
  id: string
  matchId: string
  matchLabel: string
  selectionLabel: string
  decimalOdds: number
  stakePoints: number
  status: 'open' | 'won' | 'lost' | 'void'
  payoutPoints: number
  verified?: boolean
}

interface SettleResult {
  matchLabel: string
  winningLabel: string
  score: string
  proof?: { verified: boolean; rootPda?: string }
}

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', padding: 14, marginBottom: 12 }
// Secondary button: white fill, black border, black text.
const btn: React.CSSProperties = { fontSize: 12, padding: '6px 14px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }
// Primary action: black fill, white text.
const btnFill: React.CSSProperties = { ...btn, background: 'var(--text)', color: 'var(--bg)', border: '1px solid var(--text)' }
const inp: React.CSSProperties = { fontSize: 13, background: 'var(--surface)', border: '1px solid var(--border)', padding: '8px 10px', color: 'var(--text)' }
const cell: React.CSSProperties = { padding: '6px 8px', fontSize: 12, borderBottom: '1px solid var(--border)', textAlign: 'left' }
const th: React.CSSProperties = { ...cell, color: 'var(--muted)', fontSize: 11 }

const STATUS_COLORS: Record<string, string> = { open: 'var(--blue)', won: 'var(--green)', lost: 'var(--red)', void: 'var(--muted-2)' }

export default function FanPage() {
  const [name, setName] = useState('')
  const [joined, setJoined] = useState<string | null>(null)
  const [matches, setMatches] = useState<FanMatch[]>([])
  const [me, setMe] = useState<{ player: Player; predictions: Prediction[]; rank: number | null } | null>(null)
  const [leaders, setLeaders] = useState<Player[]>([])
  const [stake, setStake] = useState(100)
  const [settling, setSettling] = useState<string | null>(null)
  const [lastSettle, setLastSettle] = useState<SettleResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (player?: string) => {
    try {
      const [board, lb] = await Promise.all([
        fetch('/api/fan/board').then(r => r.json()),
        fetch('/api/fan/leaderboard').then(r => r.json()),
      ])
      setMatches(board.matches ?? [])
      setLeaders(lb.players ?? [])
      const handle = player ?? joined
      if (handle) {
        setMe(await fetch(`/api/fan/me?player=${encodeURIComponent(handle)}`).then(r => r.json()))
      }
      setError(null)
    } catch {
      setError('Backend unreachable — check CANVAS_FAN_URL')
    }
  }, [joined])

  useEffect(() => {
    const saved = localStorage.getItem('canvas-cup-player')
    if (saved) {
      setJoined(saved)
      setName(saved)
      refresh(saved)
    } else {
      refresh()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function join() {
    const n = name.trim()
    if (!n) return
    localStorage.setItem('canvas-cup-player', n)
    setJoined(n)
    refresh(n)
  }

  async function predict(matchId: string, outcome: string) {
    if (!joined) return
    try {
      const res = await fetch('/api/fan/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player: joined, matchId, outcome, stakePoints: stake }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'prediction failed')
        return
      }
      setError(null)
      await refresh()
    } catch {
      setError('prediction failed')
    }
  }

  async function settle(matchId: string) {
    setSettling(matchId)
    try {
      const res = await fetch('/api/fan/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId }),
      })
      const d = await res.json()
      if (!res.ok) {
        setError(d.error ?? 'settlement failed')
      } else {
        setLastSettle(d)
        setError(null)
        await refresh()
      }
    } catch {
      setError('settlement failed')
    }
    setSettling(null)
  }

  return (
    <>
      <Head><title>Canvas Cup — Prediction Game</title></Head>
      <div style={{ padding: '1.5rem clamp(1rem, 3vw, 3rem)' }}>
        <Nav />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Points prediction game — provably-fair, Merkle-anchored settlement</span>
          <Link href="/judges" title="What's real vs simulated — verify on-chain" style={{
            marginLeft: 'auto', fontSize: 11, fontWeight: 600, padding: '4px 10px', textDecoration: 'none',
            color: 'var(--text)', border: '1px solid var(--border)',
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}>
            Verify on-chain
          </Link>
        </div>

        {error && <div style={{ ...card, borderColor: 'var(--red)', color: 'var(--red)', fontSize: 13 }}>{error}</div>}

        {!joined ? (
          <div style={{ ...card, display: 'flex', gap: 8, alignItems: 'center', maxWidth: 440 }}>
            <input
              value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && join()}
              placeholder="Pick a handle to join…" style={{ ...inp, flex: 1 }}
            />
            <button onClick={join} style={btnFill}>Join the Cup</button>
          </div>
        ) : (
          <div style={{ ...card, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{me?.player.handle ?? joined}</div>
            {[
              { label: 'Points', value: me ? String(me.player.points) : '—' },
              { label: 'Streak', value: me ? `${me.player.streak}🔥` : '—' },
              { label: 'Record', value: me ? `${me.player.wins}W–${me.player.losses}L` : '—' },
              { label: 'Rank', value: me?.rank ? `#${me.rank}` : 'unranked' },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.label}</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{s.value}</div>
              </div>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>stake</span>
              <input type="number" value={stake} onChange={e => setStake(Number(e.target.value))} style={{ ...inp, width: 80, padding: '4px 8px', fontSize: 12 }} />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>pts</span>
            </div>
          </div>
        )}

        {lastSettle && (
          <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13 }}>
              <b>{lastSettle.matchLabel}</b> settled {lastSettle.score} — {lastSettle.winningLabel} wins
            </span>
            <span style={{
              fontSize: 11, padding: '3px 8px', fontWeight: 600,
              color: lastSettle.proof?.verified ? 'var(--green)' : 'var(--muted)',
              border: `1px solid ${lastSettle.proof?.verified ? 'var(--green)' : 'var(--border)'}`,
            }}>
              {lastSettle.proof?.verified ? '✓ verified on-chain' : 'demonstration tier'}
            </span>
            <button onClick={() => setLastSettle(null)} style={{ ...btn, marginLeft: 'auto', padding: '3px 10px' }}>✕</button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 12, alignItems: 'start' }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              Match board {joined ? '— tap an outcome to predict' : '— join to play'}
            </div>
            {matches.map(m => (
              <div key={m.id} style={{ ...card, padding: 0, opacity: m.settled ? 0.55 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <span style={{ fontWeight: 500, fontSize: 14 }}>{m.home} vs {m.away}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>{m.stage}</span>
                  </div>
                  {m.settled ? (
                    <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>settled</span>
                  ) : (
                    <button onClick={() => settle(m.id)} disabled={settling === m.id} style={{ ...btn, padding: '3px 10px', fontSize: 11 }}>
                      {settling === m.id ? 'settling…' : 'Simulate result'}
                    </button>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, padding: 8 }}>
                  {m.outcomes.map(o => (
                    <button
                      key={o.key}
                      onClick={() => predict(m.id, o.key)}
                      disabled={!joined || m.settled}
                      style={{
                        border: '1px solid var(--border)', padding: '8px 4px', textAlign: 'center',
                        cursor: joined && !m.settled ? 'pointer' : 'default', background: 'var(--surface)',
                      }}
                    >
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{o.label}</div>
                      <div style={{ fontSize: 16, fontWeight: 600 }}>{o.decimalOdds.toFixed(2)}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted-2)' }}>{(o.fairProb * 100).toFixed(0)}% fair</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!matches.length && !error && <div style={{ ...card, color: 'var(--muted-2)', fontSize: 13 }}>Loading board…</div>}
          </div>

          <div>
            {/* Leaderboard */}
            <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>Leaderboard</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>#</th><th style={th}>Player</th><th style={th}>Points</th><th style={th}>Streak</th></tr></thead>
                <tbody>
                  {leaders.map((p, i) => (
                    <tr key={p.handle} style={{ background: p.handle === joined ? 'var(--accent-bg)' : 'transparent' }}>
                      <td style={{ ...cell, color: 'var(--muted-2)' }}>{i + 1}</td>
                      <td style={cell}>{p.handle}</td>
                      <td style={{ ...cell, fontWeight: 600 }}>{p.points}</td>
                      <td style={cell}>{p.streak > 0 ? `${p.streak}🔥` : '—'}</td>
                    </tr>
                  ))}
                  {!leaders.length && <tr><td style={{ ...cell, color: 'var(--muted-2)' }} colSpan={4}>No players yet — be the first.</td></tr>}
                </tbody>
              </table>
            </div>

            {/* My predictions */}
            {joined && (
              <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>Your predictions</div>
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={th}>Pick</th><th style={th}>Stake</th><th style={th}>Status</th><th style={th}>Payout</th></tr></thead>
                    <tbody>
                      {(me?.predictions ?? []).slice().reverse().map(p => (
                        <tr key={p.id}>
                          <td style={cell} title={p.matchLabel}>{p.selectionLabel} @ {p.decimalOdds.toFixed(2)}</td>
                          <td style={cell}>{p.stakePoints}</td>
                          <td style={{ ...cell, color: STATUS_COLORS[p.status], fontSize: 11, fontWeight: 600 }}>
                            {p.status}{p.verified ? ' ✓' : ''}
                          </td>
                          <td style={{ ...cell, color: p.payoutPoints > 0 ? 'var(--green)' : 'var(--muted-2)' }}>
                            {p.status === 'open' ? '—' : p.payoutPoints}
                          </td>
                        </tr>
                      ))}
                      {!me?.predictions.length && <tr><td style={{ ...cell, color: 'var(--muted-2)' }} colSpan={4}>No predictions yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ fontSize: 11, color: 'var(--muted-2)', textAlign: 'center', padding: 8 }}>
          Points game · settlement provably fair · not financial advice
        </div>
      </div>
      <style>{`button:hover:not(:disabled) { opacity: .8; } input:focus { outline: none; border-color: var(--text) !important; }`}</style>
    </>
  )
}
