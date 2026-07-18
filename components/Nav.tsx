import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'

const LINKS = [
  { href: '/', label: 'Risk Desk' },
  { href: '/agent', label: 'Edge Agent' },
  { href: '/fan', label: 'Canvas Cup' },
  { href: '/judges', label: 'Judges' },
]

export default function Nav() {
  const router = useRouter()
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    try {
      if (localStorage.getItem('canvas-theme') === 'light') setTheme('light')
    } catch { /* ignore */ }
  }, [])

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try { localStorage.setItem('canvas-theme', next) } catch { /* ignore */ }
    if (next === 'light') document.documentElement.setAttribute('data-theme', 'light')
    else document.documentElement.removeAttribute('data-theme')
  }

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
      <button
        onClick={toggle}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        style={{
          marginLeft: 'auto', width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 9, border: '0.5px solid var(--border)', background: 'var(--surface)', color: 'var(--muted)', cursor: 'pointer',
        }}
      >
        <i className={theme === 'dark' ? 'ti ti-sun' : 'ti ti-moon'} aria-hidden="true" style={{ fontSize: 16 }} />
      </button>
    </nav>
  )
}
