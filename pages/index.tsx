import Head from 'next/head'
import Link from 'next/link'
import { useState, useRef, useEffect, useCallback } from 'react'
import Nav from '../components/Nav'
import { enrichMatches, SAMPLE_MATCHES, kelly, type Match, type Outcome } from '../lib/risk'

const SAMPLE = enrichMatches(SAMPLE_MATCHES)

// --- Live TxLINE feed (GET /api/markets → Railway → on-chain Solana data) ---
interface ApiOutcome { key: string; label: string; fairProb: number; decimalOdds: number; edge: number }
interface ApiMarket { key: string; label: string; outcomes: ApiOutcome[] }
interface ApiMatch { id: string; competition?: string; stage?: string; home: string; away: string; status?: Match['status']; markets: ApiMarket[] }
interface Provenance { onChain?: boolean; rootExplorerUrl?: string; network?: string }

/** Map the live on-chain MatchOdds payload into the board's Match shape. Priced
 *  fixtures get their 1X2 outcomes; unpriced fixtures are kept with no outcomes
 *  (rendered as "awaiting line") so the board shows the full on-chain slate. */
function liveMatchesFrom(apiMatches: ApiMatch[]): Match[] {
  return apiMatches.map((m): Match => {
    const mk = (m.markets || []).find(k => (k.outcomes || []).length >= 2)
    const outcomes: Outcome[] = mk
      ? mk.outcomes.map(o => ({
          key: o.key,
          label: o.label,
          txodds: Number(o.decimalOdds) || 0,
          market: Number(o.decimalOdds) || 0,
          fairProb: Number(o.fairProb) || 0,
          edge: Number(o.edge) || 0,
        }))
      : []
    return {
      id: m.id,
      stage: m.stage || m.competition || 'World Cup',
      home: m.home,
      away: m.away,
      status: m.status ?? 'scheduled',
      outcomes,
      ou: [],
    }
  })
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

function buildSystemPrompt(matches: Match[], sel: { match: Match; outcome: Outcome } | null): string {
  const lines = [
    'You are Canvas Markets — a sharp, concise World Cup betting copilot.',
    'You help users find positive-EV bets, size positions with Kelly criterion, understand ruin probability, and hedge positions.',
    'Be specific. Use exact numbers from the data. No filler. No disclaimers in responses.',
    'Format: plain text only, no markdown, no bullet symbols.',
    '',
    'Live match data:',
  ]
  matches.filter(m => m.outcomes.length).forEach(m => {
    lines.push(`${m.home} vs ${m.away} (${m.stage}${m.status === 'live' ? ' — LIVE' : ''})`)
    ;[...m.outcomes, ...m.ou].forEach(o => {
      const e = ((o.edge ?? 0) * 100).toFixed(1)
      const fp = ((o.fairProb ?? 0) * 100).toFixed(1)
      const k = (kelly(o.fairProb ?? 0, o.market) * 50).toFixed(0)
      lines.push(`  ${o.label}: ${o.market} odds | ${fp}% fair | ${e.startsWith('-') ? '' : '+'}${e}% edge | half-Kelly on $1k = $${k}`)
    })
  })
  if (sel) {
    lines.push('', `User is looking at: ${sel.outcome.label} — ${sel.match.home} vs ${sel.match.away}`)
    lines.push(`Edge: ${((sel.outcome.edge ?? 0) * 100).toFixed(1)}%, fair prob ${((sel.outcome.fairProb ?? 0) * 100).toFixed(1)}%`)
  }
  lines.push('', 'Keep responses under 100 words. Be direct.')
  return lines.join('\n')
}

/** The single highest-edge outcome across the whole board, for the Top pick bar. */
function topPickFrom(matches: Match[]): { match: Match; outcome: Outcome } | null {
  let best: { match: Match; outcome: Outcome } | null = null
  matches.forEach(m => {
    [...m.outcomes, ...m.ou].forEach(o => {
      if (!best || (o.edge ?? -Infinity) > (best.outcome.edge ?? -Infinity)) best = { match: m, outcome: o }
    })
  })
  return best
}

/** A short, natural analysis prompt for a given outcome. */
function promptFor(match: Match, outcome: Outcome): string {
  const e = (outcome.edge ?? 0) * 100
  const sign = e >= 0 ? '+' : ''
  return `Analyse ${outcome.label} — ${match.home} vs ${match.away} (${outcome.market.toFixed(2)} odds, ${sign}${e.toFixed(1)}% edge). Size it and flag the risk.`
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<{ match: Match; outcome: Outcome } | null>(null)
  const [bankroll, setBankroll] = useState(1000)
  const [matches, setMatches] = useState<Match[]>(SAMPLE)
  const [feed, setFeed] = useState<{ live: boolean; provenance?: Provenance }>({ live: false })
  const chatRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [messages, loading])

  const addAgentMessage = useCallback((text: string) => {
    setMessages(prev => [...prev, { role: 'assistant', content: text }])
  }, [])

  useEffect(() => {
    addAgentMessage('Pick an outcome on the board or ask me anything — best edges right now, how much to stake, how to hedge a position.')
  }, [addAgentMessage])

  // Pull the live on-chain TxLINE board; keep labelled sample fixtures if it's
  // unavailable or has no priced matches yet (never mislabel sample as live).
  useEffect(() => {
    let cancelled = false
    fetch('/api/markets')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { source?: string; provenance?: Provenance; matches?: ApiMatch[] }) => {
        if (cancelled) return
        const live = liveMatchesFrom(data.matches ?? [])
        const priced = live.filter(m => m.outcomes.length)
        if (data.source === 'txodds-live' && priced.length) {
          setMatches(live)
          setFeed({ live: true, provenance: data.provenance })
        }
      })
      .catch(() => { /* keep sample */ })
    return () => { cancelled = true }
  }, [])

  async function send(userText?: string) {
    const text = userText ?? input.trim()
    if (!text || loading) return
    setInput('')
    const userMsg: Message = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: buildSystemPrompt(matches, selected),
          messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await res.json()
      addAgentMessage(data.text ?? 'Something went wrong.')
    } catch {
      addAgentMessage('Connection error. Try again.')
    }
    setLoading(false)
  }

  // Tapping an outcome auto-populates the agent input with that match + outcome.
  function pickOutcome(match: Match, outcome: Outcome) {
    setSelected({ match, outcome })
    setInput(promptFor(match, outcome))
    inputRef.current?.focus()
  }

  // Top pick "Analyse →" sends the highest-edge outcome straight to the agent.
  function analyse(match: Match, outcome: Outcome) {
    setSelected({ match, outcome })
    send(promptFor(match, outcome))
  }

  const chips = [
    'Best edge right now?',
    `Size my bankroll at $${bankroll}`,
    'How do I hedge this?',
    'Explain Kelly sizing',
    'What is my ruin risk?',
  ]

  const top = topPickFrom(matches)

  return (
    <>
      <Head>
        <title>Canvas Markets — World Cup Terminal</title>
        <meta name="description" content="Risk-managed World Cup betting copilot. TxLINE StablePrice odds, Kelly sizing, Monte Carlo ruin analysis, Bankr settlement." />
      </Head>

      <div style={{ padding: '1.5rem clamp(1rem, 3vw, 3rem)' }}>
        <Nav />
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>
            Risk-managed World Cup copilot — TxLINE StablePrice, Kelly sizing, Bankr settlement
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <Link href="/judges" title="What's real vs simulated — verify on-chain" style={{
              fontSize: 11, fontWeight: 600, padding: '4px 10px', textDecoration: 'none',
              color: 'var(--text)', border: '1px solid var(--border)',
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}>
              Verify on-chain
            </Link>
            <span style={{
              fontSize: 11, padding: '3px 8px', border: '1px solid var(--border)',
              color: feed.live ? 'var(--green)' : 'var(--muted)',
            }}>
              {feed.live ? 'Live · TxLINE StablePrice' : 'Sample fixtures'}
            </span>
            {feed.live && feed.provenance?.rootExplorerUrl && (
              <a href={feed.provenance.rootExplorerUrl} target="_blank" rel="noreferrer" style={{
                fontSize: 11, padding: '3px 8px', textDecoration: 'none',
                border: '1px solid var(--border)', color: 'var(--text)',
              }}>
                on-chain ✓
              </a>
            )}
            <span style={{ fontSize: 11, padding: '3px 8px', border: '1px solid var(--border)', color: 'var(--muted)' }}>Simulated settlement</span>
          </div>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: '1.5rem', alignItems: 'start' }}>
          <div>
            {top && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14,
                background: 'var(--text)', color: 'var(--bg)', border: '1px solid var(--text)', padding: '12px 16px',
              }}>
                <span style={{ fontSize: 11, color: 'var(--bg)', opacity: .7, letterSpacing: '.02em' }}>Top pick</span>
                <span style={{ fontSize: 14, fontWeight: 500 }}>
                  {top.outcome.label} — {top.match.home} vs {top.match.away}
                </span>
                <span style={{
                  fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em',
                  color: (top.outcome.edge ?? 0) >= 0 ? 'var(--green)' : 'var(--red)',
                }}>
                  {(top.outcome.edge ?? 0) >= 0 ? '+' : ''}{((top.outcome.edge ?? 0) * 100).toFixed(1)}%
                </span>
                <button onClick={() => analyse(top.match, top.outcome)} style={{
                  marginLeft: 'auto', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bg)', padding: '6px 14px',
                }}>
                  Analyse →
                </button>
              </div>
            )}

            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
              World Cup board — tap an outcome to analyse
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>
              {matches.map(m => (
                <div key={m.id} style={{
                  background: 'var(--surface)',
                  border: `1px solid var(--border)`,
                  outline: selected?.match.id === m.id ? '1px solid var(--border)' : 'none',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{m.home} vs {m.away}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{m.stage}</div>
                    </div>
                    {m.status === 'live' && (
                      <span style={{ fontSize: 10, padding: '2px 7px', border: '1px solid var(--green)', color: 'var(--green)' }}>live</span>
                    )}
                  </div>
                  {m.outcomes.length > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, padding: 8 }}>
                      {m.outcomes.map(o => <OutcomeCell key={o.key} m={m} o={o} selected={selected} onPick={pickOutcome} />)}
                    </div>
                  ) : (
                    <div style={{ padding: '12px', fontSize: 12, color: 'var(--muted-2)' }}>
                      Awaiting on-chain line…
                    </div>
                  )}
                  {m.ou.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, color: 'var(--muted-2)', padding: '2px 12px' }}>O/U 2.5</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: '4px 8px 8px' }}>
                        {m.ou.map(o => <OutcomeCell key={o.key} m={m} o={o} selected={selected} onPick={pickOutcome} />)}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', position: 'sticky', top: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Agent</span>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>bankroll</span>
                <input
                  type="number"
                  value={bankroll}
                  onChange={e => setBankroll(Number(e.target.value))}
                  style={{ width: 70, fontSize: 12, background: 'var(--surface)', border: '1px solid var(--border)', padding: '3px 6px', color: 'var(--text)' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
              {chips.map(c => (
                <button key={c} onClick={() => send(c)} style={{
                  fontSize: 11, padding: '3px 8px', border: '1px solid var(--border)',
                  cursor: 'pointer', color: 'var(--text)', background: 'var(--surface)',
                }}>
                  {c}
                </button>
              ))}
            </div>

            <div ref={chatRef} style={{ height: 460, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {messages.map((m, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted-2)', marginBottom: 3 }}>{m.role === 'user' ? 'You' : 'Agent'}</div>
                  <div style={{
                    padding: '7px 10px', maxWidth: '90%', fontSize: 13, lineHeight: 1.5,
                    background: 'var(--surface)', color: 'var(--text)',
                    border: '1px solid var(--border)',
                  }}>
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted-2)', marginBottom: 3 }}>Agent</div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    {[0, 150, 300].map(d => (
                      <div key={d} style={{ width: 5, height: 5, background: 'var(--text)', animation: `bounce .9s ${d}ms infinite` }} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 6, padding: 10, borderTop: '1px solid var(--border)' }}>
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && send()}
                placeholder="Ask about any position…"
                style={{
                  flex: 1, fontSize: 13, background: 'var(--surface)', border: '1px solid var(--border)',
                  padding: '8px 10px', color: 'var(--text)',
                }}
              />
              <button onClick={() => send()} disabled={loading} style={{
                padding: '8px 16px', border: '1px solid var(--border)',
                background: 'var(--text)', color: 'var(--bg)', fontSize: 13, cursor: 'pointer',
              }}>
                Send
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }
        button:hover { opacity: .8; }
        input:focus { outline: none; border-color: var(--text) !important; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: var(--border); }
      `}</style>
    </>
  )
}

// One outcome cell — edge is the largest number (green if positive, red if
// negative), decimal odds smaller and secondary. Selected cell inverts to black.
function OutcomeCell({ m, o, selected, onPick }: {
  m: Match
  o: Outcome
  selected: { match: Match; outcome: Outcome } | null
  onPick: (m: Match, o: Outcome) => void
}) {
  const isSel = selected?.outcome.key === o.key && selected?.match.id === m.id
  const isPos = (o.edge ?? 0) > 0
  const edgeColor = isPos ? 'var(--green)' : 'var(--red)'
  return (
    <button onClick={() => onPick(m, o)} style={{
      border: '1px solid var(--border)', padding: '8px 4px', textAlign: 'center', cursor: 'pointer',
      background: isSel ? 'var(--text)' : 'var(--surface)', color: isSel ? 'var(--bg)' : 'var(--text)',
      display: 'flex', flexDirection: 'column', gap: 3,
    }}>
      <div style={{ fontSize: 11, color: isSel ? 'var(--bg)' : 'var(--muted)', opacity: isSel ? .7 : 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', color: edgeColor }}>
        {isPos ? '+' : ''}{((o.edge ?? 0) * 100).toFixed(1)}%
      </div>
      <div style={{ fontSize: 11, color: isSel ? 'var(--bg)' : 'var(--muted-2)', opacity: isSel ? .7 : 1 }}>{o.market.toFixed(2)} odds</div>
    </button>
  )
}
