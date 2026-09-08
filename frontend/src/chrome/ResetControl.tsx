import { useEffect, useState } from 'react'

export default function ResetControl() {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    await fetch('/api/reset', { method: 'POST' })
    setBusy(false)
    setConfirming(false)
    setDone(new Date().toLocaleTimeString('en-GB'))
  }

  useEffect(() => {
    if (!done) return
    const id = setTimeout(() => setDone(null), 900)
    return () => clearTimeout(id)
  }, [done])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return
      if (e.key === 'r' || e.key === 'R') setConfirming(true)
      else if (e.key === 'Escape') setConfirming(false)
      else if (e.key === 'Enter' && confirming) void run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirming])

  if (confirming) {
    // inline, never a modal over the map
    return (
      <span className="flex items-center gap-1.5">
        <span className="t-label" style={{ color: 'var(--advisory)' }}>
          RESET DEMO?
        </span>
        <button type="button" onClick={run} disabled={busy} className="t-label px-2 py-1"
          style={{ background: 'var(--advisory)', color: 'var(--ink)', border: 0, borderRadius: 'var(--r-sm)', cursor: 'pointer' }}>
          {busy ? 'RESETTING…' : 'ENTER'}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="t-label px-2 py-1"
          style={{ background: 'transparent', color: 'var(--graticule)', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', cursor: 'pointer' }}>
          ESC
        </button>
      </span>
    )
  }

  return (
    <button type="button" onClick={() => setConfirming(true)} className="t-label px-2 py-1"
      style={{ background: 'transparent', color: done ? 'var(--graticule)' : 'var(--graticule)',
        border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', cursor: 'pointer' }}
      title="Reset the demo (R)">
      {done ? `RESET ${done}` : 'RESET · R'}
    </button>
  )
}
