import Link from 'next/link'
import { useRouter } from 'next/router'

const LINKS = [
  { href: '/', label: 'Risk Desk' },
  { href: '/agent', label: 'Edge Agent' },
  { href: '/fan', label: 'Canvas Cup' },
]

export default function Nav() {
  const router = useRouter()
  return (
    <nav style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: '1rem' }}>
      <Link href="/" style={{ fontFamily: 'var(--serif)', fontSize: 20, fontWeight: 600, marginRight: 12 }}>
        Canvas <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>Markets</em>
      </Link>
      {LINKS.map(l => {
        const active = router.pathname === l.href
        return (
          <Link key={l.href} href={l.href} style={{
            fontSize: 13, padding: '5px 12px', borderRadius: 20,
            border: `0.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
            color: active ? 'var(--accent)' : 'var(--muted)',
            background: active ? 'var(--accent-bg)' : 'transparent',
          }}>
            {l.label}
          </Link>
        )
      })}
    </nav>
  )
}
