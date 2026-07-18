import Head from 'next/head'
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
          txodds: o.decimalOdds,
          market: o.decimalOdds,
          fairProb: o.fairProb,
          edge: o.edge,
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

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<{ match: Match; outcome: Outcome } | null>(null)
  const [bankroll, setBankroll] = useState(1000)
  const [matches, setMatches] = useState<Match[]>(SAMPLE)
  const [feed, setFeed] = useState<{ live: boolean; provenance?: Provenance }>({ live: false })
  const chatRef = useRef<HTMLDivElement>(null)

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

  function selectOutcome(match: Match, outcome: Outcome) {
    setSelected({ match, outcome })
    const e = (outcome.edge ?? 0) * 100
    const fp = (outcome.fairProb ?? 0) * 100
    const stake = kelly(outcome.fairProb ?? 0, outcome.market) * 0.5 * bankroll
    const msg = e > 0
      ? `Selected ${outcome.label} — ${match.home} vs ${match.away}. Edge: +${e.toFixed(1)}%, fair prob ${fp.toFixed(1)}%, half-Kelly stake $${stake.toFixed(0)} on a $${bankroll} bankroll. Want the full risk breakdown or hedge?`
      : `${outcome.label} — ${match.home} vs ${match.away}: edge ${e.toFixed(1)}%, fair prob ${fp.toFixed(1)}%. This is the de-margined fair line, so there's little to no edge. Want me to size it or hedge anyway?`
    addAgentMessage(msg)
  }

  const chips = [
    'Best edge right now?',
    `Size my bankroll at $${bankroll}`,
    'How do I hedge this?',
    'Explain Kelly sizing',
    'What is my ruin risk?',
  ]

  return (
    <>
      <Head>
        <title>Canvas Markets — World Cup Risk Desk</title>
        <meta name="description" content="Risk-managed World Cup betting copilot. TxLINE StablePrice odds, Kelly sizing, Monte Carlo ruin analysis, Bankr settlement." />
      </Head>

      <div style={{ padding: '1.5rem clamp(1rem, 3vw, 3rem)' }}>
        <Nav />
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: '1.5rem', borderBottom: '0.5px solid var(--border)', paddingBottom: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>
            Risk-managed World Cup copilot — TxLINE StablePrice → Kelly sizing → Bankr settlement
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{
              fontSize: 11, padding: '3px 8px', borderRadius: 6,
              border: `0.5px solid ${feed.live ? 'rgba(74,222,128,.35)' : 'var(--border)'}`,
              color: feed.live ? 'var(--green)' : 'var(--muted)',
              background: feed.live ? 'rgba(74,222,128,.08)' : 'var(--surface)',
            }}>
              {feed.live ? '● Live · TxLINE StablePrice' : 'Sample fixtures'}
            </span>
            {feed.live && feed.provenance?.rootExplorerUrl && (
              <a href={feed.provenance.rootExplorerUrl} target="_blank" rel="noreferrer" style={{
                fontSize: 11, padding: '3px 8px', borderRadius: 6, textDecoration: 'none',
                border: '0.5px solid rgba(233,168,76,.3)', color: 'var(--accent)', background: 'var(--accent-bg)',
              }}>
                on-chain ✓
              </a>
            )}
            <span style={{ fontSize: 11, padding: '3px 8px', border: '0.5px solid var(--border)', borderRadius: 6, color: 'var(--muted)', background: 'var(--surface)' }}>Simulated settlement</span>
          </div>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: '1.5rem', alignItems: 'start' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
              World Cup board — tap an outcome to analyse
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 10 }}>
              {matches.map(m => (
                <div key={m.id} style={{
                  background: 'var(--surface)',
                  border: `0.5px solid ${selected?.match.id === m.id ? 'rgba(233,168,76,.5)' : 'var(--border)'}`,
                  borderRadius: 10,
                  overflow: 'hidden',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '0.5px solid var(--border)' }}>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{m.home} vs {m.away}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{m.stage}</div>
                    </div>
                    {m.status === 'live' && (
                      <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(74,222,128,.1)', color: 'var(--green)', border: '0.5px solid rgba(74,222,128,.3)' }}>● live</span>
                    )}
                  </div>
                  {m.outcomes.length > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4, padding: '8px 8px' }}>
                      {m.outcomes.map(o => {
                        const isSel = selected?.outcome.key === o.key && selected?.match.id === m.id
                        const isPos = (o.edge ?? 0) > 0
                        return (
                          <button key={o.key} onClick={() => selectOutcome(m, o)} style={{
                            border: `0.5px solid ${isSel ? 'var(--accent)' : isPos ? 'rgba(74,222,128,.3)' : 'var(--border)'}`,
                            borderRadius: 6, padding: '7px 4px', textAlign: 'center', cursor: 'pointer',
                            background: isSel ? 'var(--accent-bg)' : isPos ? 'rgba(74,222,128,.05)' : 'var(--surface-2)',
                            transition: 'all .15s',
                          }}>
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</div>
                            <div style={{ fontSize: 13, fontWeight: 500 }}>{o.market.toFixed(2)}</div>
                            <div style={{ fontSize: 10, color: isPos ? 'var(--green)' : 'var(--muted-2)', marginTop: 1 }}>
                              {isPos ? '+' : ''}{((o.edge ?? 0) * 100).toFixed(1)}%
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <div style={{ padding: '12px', fontSize: 12, color: 'var(--muted-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--muted-2)' }} />
                      Awaiting on-chain line…
                    </div>
                  )}
                  {m.ou.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, color: 'var(--muted-2)', padding: '2px 12px', textTransform: 'uppercase', letterSpacing: '.05em' }}>O/U 2.5</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: '4px 8px 8px' }}>
                        {m.ou.map(o => {
                          const isSel = selected?.outcome.key === o.key && selected?.match.id === m.id
                          const isPos = (o.edge ?? 0) > 0
                          return (
                            <button key={o.key} onClick={() => selectOutcome(m, o)} style={{
                              border: `0.5px solid ${isSel ? 'var(--accent)' : isPos ? 'rgba(74,222,128,.3)' : 'var(--border)'}`,
                              borderRadius: 6, padding: '6px 4px', textAlign: 'center', cursor: 'pointer',
                              background: isSel ? 'var(--accent-bg)' : isPos ? 'rgba(74,222,128,.05)' : 'var(--surface-2)',
                              transition: 'all .15s',
                            }}>
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{o.label}</div>
                              <div style={{ fontSize: 13, fontWeight: 500 }}>{o.market.toFixed(2)}</div>
                              <div style={{ fontSize: 10, color: isPos ? 'var(--green)' : 'var(--muted-2)', marginTop: 1 }}>
                                {isPos ? '+' : ''}{((o.edge ?? 0) * 100).toFixed(1)}%
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, display: 'flex', flexDirection: 'column', position: 'sticky', top: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '0.5px solid var(--border)' }}>
              <i className="ti ti-robot" aria-hidden="true" style={{ fontSize: 14, color: 'var(--accent)' }} />
              <span style={{ fontSize: 13, fontWeight: 500 }}>Risk agent</span>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>bankroll</span>
                <input
                  type="number"
                  value={bankroll}
                  onChange={e => setBankroll(Number(e.target.value))}
                  style={{ width: 70, fontSize: 12, background: 'var(--surface-2)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '3px 6px', color: 'var(--text)' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '6px 10px', borderBottom: '0.5px solid var(--border)' }}>
              {chips.map(c => (
                <button key={c} onClick={() => send(c)} style={{
                  fontSize: 11, padding: '3px 8px', border: '0.5px solid var(--border)', borderRadius: 20,
                  cursor: 'pointer', color: 'var(--muted)', background: 'var(--surface-2)',
                }}>
                  {c}
                </button>
              ))}
            </div>

            <div ref={chatRef} style={{ height: 460, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {messages.map((m, i) => (
                <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, fontWeight: 600, flexShrink: 0,
                    background: m.role === 'user' ? 'var(--surface-2)' : 'var(--accent-bg)',
                    color: m.role === 'user' ? 'var(--muted)' : 'var(--accent)',
                  }}>
                    {m.role === 'user' ? 'U' : 'CV'}
                  </div>
                  <div style={{
                    borderRadius: m.role === 'user' ? '10px 2px 10px 10px' : '2px 10px 10px 10px',
                    padding: '7px 10px', maxWidth: '85%', fontSize: 13, lineHeight: 1.5,
                    background: m.role === 'user' ? 'rgba(233,168,76,.1)' : 'var(--surface-2)',
                    color: m.role === 'user' ? 'var(--accent)' : 'var(--text)',
                    border: '0.5px solid var(--border)',
                  }}>
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'var(--accent)' }}>CV</div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '10px 12px', background: 'var(--surface-2)', borderRadius: '2px 10px 10px 10px', border: '0.5px solid var(--border)' }}>
                    {[0, 150, 300].map(d => (
                      <div key={d} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--muted)', animation: `bounce .9s ${d}ms infinite` }} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 6, padding: 10, borderTop: '0.5px solid var(--border)' }}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && send()}
                placeholder="Ask about any position…"
                style={{
                  flex: 1, fontSize: 13, background: 'var(--surface-2)', border: '0.5px solid var(--border)',
                  borderRadius: 8, padding: '8px 10px', color: 'var(--text)',
                }}
              />
              <button onClick={() => send()} disabled={loading} style={{
                padding: '8px 14px', border: '0.5px solid var(--border)', borderRadius: 8,
                background: 'var(--surface-2)', color: 'var(--accent)', fontSize: 13, cursor: 'pointer',
              }}>
                <i className="ti ti-arrow-right" aria-hidden="true" />
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted-2)', textAlign: 'center', padding: '4px 10px 8px' }}>
              Not financial advice · settlement simulated
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }
        button:hover { opacity: .85; }
        input:focus { outline: none; border-color: var(--accent) !important; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
      `}</style>
    </>
  )
}
