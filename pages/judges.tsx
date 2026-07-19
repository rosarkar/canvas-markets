import Head from 'next/head'
import Link from 'next/link'
import Nav from '../components/Nav'

const WALLET = 'EKRgJifhv4xsfRNFnSLY93NDoLVa39udENVQLC59s4sg'
const WALLET_EXPLORER = `https://explorer.solana.com/address/${WALLET}?cluster=devnet`

const card: React.CSSProperties = { background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, padding: 18 }
const h2: React.CSSProperties = { fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 600, marginBottom: 4 }
const kicker: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }
const cell: React.CSSProperties = { padding: '10px 12px', fontSize: 13, borderBottom: '0.5px solid var(--border)', verticalAlign: 'top', textAlign: 'left' }
const th: React.CSSProperties = { ...cell, fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }

function Tier({ color, bg, brc, label }: { color: string; bg: string; brc: string; label: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, color, background: bg, border: `0.5px solid ${brc}`, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

const TIERS = {
  live: { color: 'var(--green)', bg: 'rgba(74,222,128,.08)', brc: 'rgba(74,222,128,.35)', label: '● Verified on-chain' },
  anchor: { color: 'var(--accent)', bg: 'var(--accent-bg)', brc: 'rgba(233,168,76,.35)', label: '◆ Root-anchored' },
  sim: { color: 'var(--muted)', bg: 'var(--surface-2)', brc: 'var(--border)', label: '○ Simulated / sample' },
}

const MATRIX: { component: string; tier: keyof typeof TIERS; detail: string }[] = [
  { component: 'On-chain subscription', tier: 'live', detail: 'A Solana `subscribe` transaction from our wallet mints the TxLINE API token. No token, no data — the access itself is on-chain.' },
  { component: 'Odds & fair probabilities', tier: 'live', detail: 'TxLINE StablePrice — the de-margined fair line, fetched live. Because it is already the fair price, live edges sit near 0% (honest, not a bug).' },
  { component: 'Fixtures & teams', tier: 'live', detail: 'Pulled live from TxLINE across a multi-day window (devnet ships a small demo slate; mainnet L12 carries the full realtime World Cup).' },
  { component: 'Score / settlement proof', tier: 'anchor', detail: 'A Merkle proof is checked against the `daily_scores_merkle_roots` account on Solana; each result is labelled verified-on-chain, root-anchored, or demonstration.' },
  { component: 'Bet settlement (Bankr)', tier: 'sim', detail: 'We compose the exact Bankr Agent order and show it, but no funds move by default. Set MARKETS_LIVE_SETTLEMENT + a Bankr key to execute for real.' },
  { component: 'Sample fixtures', tier: 'sim', detail: 'Shown only when the live feed has no priced match yet — and always labelled "Sample fixtures", never as live.' },
]

export default function Judges() {
  return (
    <>
      <Head><title>Canvas Markets — Judge Walkthrough</title></Head>
      <div style={{ padding: '1.5rem clamp(1rem, 3vw, 3rem)' }}>
        <Nav />

        <div style={{ maxWidth: 1180, margin: '0 auto' }}>
          <header style={{ borderBottom: '0.5px solid var(--border)', paddingBottom: '1.25rem', marginBottom: '1.5rem' }}>
            <div style={{ ...kicker, marginBottom: 6 }}>Judge Walkthrough</div>
            <h1 style={{ fontFamily: 'var(--serif)', fontSize: 34, fontWeight: 600, lineHeight: 1.1, marginBottom: 8 }}>
              What&rsquo;s real, what&rsquo;s simulated,<br />and how to verify it yourself.
            </h1>
            <p style={{ fontSize: 15, color: 'var(--muted)', maxWidth: 680 }}>
              Every number on this site carries an honesty tier. We never label sample data as on-chain-verified —
              the whole point of Canvas Markets is trustworthy, provably-sourced World Cup risk.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <Tier {...TIERS.live} /><Tier {...TIERS.anchor} /><Tier {...TIERS.sim} />
            </div>
          </header>

          {/* The three surfaces */}
          <div style={{ ...kicker }}>The three surfaces</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: '2rem' }}>
            {[
              { href: '/', name: 'Terminal', desc: 'Live TxLINE StablePrice board with a Kelly-sizing, ruin-aware copilot.' },
              { href: '/agent', name: 'Risk Calculator', desc: 'An autonomous, risk-limited betting agent — goal-triggered, with a kill switch.' },
              { href: '/fan', name: 'Canvas Cup', desc: 'A points prediction game settled with provably-fair, Merkle-anchored results.' },
            ].map(s => (
              <Link key={s.href} href={s.href} style={{ ...card, display: 'block' }}>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{s.name} <span style={{ color: 'var(--accent)' }}>→</span></div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>{s.desc}</div>
              </Link>
            ))}
          </div>

          {/* Real vs simulated matrix */}
          <div style={{ ...kicker }}>Real vs simulated — the full matrix</div>
          <div style={{ ...card, padding: 0, overflow: 'hidden', marginBottom: '2rem' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr><th style={th}>Component</th><th style={th}>Tier</th><th style={th}>What it means</th></tr>
                </thead>
                <tbody>
                  {MATRIX.map(row => (
                    <tr key={row.component}>
                      <td style={{ ...cell, fontWeight: 500, whiteSpace: 'nowrap' }}>{row.component}</td>
                      <td style={cell}><Tier {...TIERS[row.tier]} /></td>
                      <td style={{ ...cell, color: 'var(--muted)' }}>{row.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: '2rem' }}>
            {/* How to read the board */}
            <div style={card}>
              <div style={h2}>How to read the board</div>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>
                <li><b style={{ color: 'var(--green)' }}>● Live · TxLINE StablePrice</b> — the board is on live on-chain data. <b style={{ color: 'var(--text)' }}>Sample fixtures</b> means the feed had no line and we fell back (labelled).</li>
                <li><b style={{ color: 'var(--accent)' }}>on-chain ✓</b> — opens the Solana account anchoring that day&rsquo;s TxLINE data.</li>
                <li>Each outcome shows <b style={{ color: 'var(--text)' }}>decimal odds</b>, <b style={{ color: 'var(--text)' }}>fair %</b>, and <b style={{ color: 'var(--text)' }}>edge</b>. Live edges hover near <b style={{ color: 'var(--text)' }}>0%</b> — StablePrice <i>is</i> the de-vigged fair line, so there is no vig to beat. That is the honest number.</li>
                <li><b style={{ color: 'var(--text)' }}>Awaiting on-chain line…</b> — a real fixture that has no published book yet.</li>
              </ul>
            </div>

            {/* Verify it yourself */}
            <div style={card}>
              <div style={h2}>Verify it yourself</div>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 12 }}>
                Our subscription wallet on Solana devnet — open it in Explorer and you&rsquo;ll see the
                <code style={{ color: 'var(--text)' }}> subscribe</code> transactions that mint API access:
              </p>
              <a href={WALLET_EXPLORER} target="_blank" rel="noreferrer" style={{
                display: 'inline-block', marginTop: 10, fontSize: 12, wordBreak: 'break-all',
                padding: '8px 10px', borderRadius: 8, border: '0.5px solid rgba(233,168,76,.3)',
                color: 'var(--accent)', background: 'var(--accent-bg)',
              }}>
                {WALLET} ↗
              </a>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 12 }}>
                On the Terminal, the <b style={{ color: 'var(--accent)' }}>on-chain ✓</b> chip links to the day&rsquo;s
                <code style={{ color: 'var(--text)' }}> daily_scores_merkle_roots</code> account — the exact place the live root anchors.
              </p>
            </div>
          </div>

          {/* Settlement route */}
          <div style={{ ...card, marginBottom: '2rem' }}>
            <div style={{ ...kicker, marginBottom: 8 }}>Settlement route — cross-chain, stated precisely</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 13 }}>
              {['TxLINE StablePrice (Solana)', 'de-vig', 'Kelly-sized', 'Bankr executes', 'Polymarket · USDC on Polygon'].map((step, i, a) => (
                <span key={step} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ padding: '5px 10px', borderRadius: 8, background: 'var(--surface-2)', border: '0.5px solid var(--border)', fontWeight: 500 }}>{step}</span>
                  {i < a.length - 1 && <span style={{ color: 'var(--muted-2)' }}>→</span>}
                </span>
              ))}
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 14 }}>
              The Solana leg is <b style={{ color: 'var(--text)' }}>data + verification</b>. The execution rail is Bankr, whose
              Polymarket path settles in <b style={{ color: 'var(--text)' }}>USDC on Polygon — not Solana-native</b>. We say this
              plainly so no one is misled into thinking a bet clears on Solana.
            </p>
          </div>

          {/* Stack */}
          <div style={{ ...kicker }}>Stack</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: '2.5rem' }}>
            {['Next.js · Vercel', 'Express backends · Railway', 'TxLINE · Solana', 'Bankr Agent API', 'Kimi (Moonshot) copilot', 'Merkle proofs'].map(t => (
              <span key={t} style={{ fontSize: 12, padding: '5px 11px', borderRadius: 20, border: '0.5px solid var(--border)', color: 'var(--muted)', background: 'var(--surface)' }}>{t}</span>
            ))}
          </div>

          <div style={{ fontSize: 12, color: 'var(--muted-2)', textAlign: 'center', paddingBottom: '2rem' }}>
            Not financial advice · settlement simulated by default · sample data is always labelled, never shown as on-chain-verified.
          </div>
        </div>
      </div>
      <style>{`a:hover { opacity: .9; }`}</style>
    </>
  )
}
