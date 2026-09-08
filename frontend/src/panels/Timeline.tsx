import { useState } from 'react'
import { useStore } from '../store'

function stamp(clock: number): string {
  const s = Math.max(0, Math.floor(clock))
  const hh = String(Math.floor(s / 3600) % 24).padStart(2, '0')
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

export default function Timeline() {
  const events = useStore((s) => s.events)
  const [collapsed, setCollapsed] = useState(false)

  return (
    <footer
      className="glass-rail fixed right-0 bottom-0 left-0 z-30 flex flex-col"
      style={{
        height: collapsed ? 'var(--timeline-collapsed)' : 'var(--timeline-h)',
        borderRadius: 0,
        borderLeft: 0,
        borderRight: 0,
        borderBottom: 0,
        transition: 'height var(--t-quick) var(--ease-out)',
      }}
    >
      <div className="flex items-center justify-between px-4" style={{ height: 'var(--timeline-collapsed)' }}>
        <span className="t-label" style={{ color: 'var(--graticule)' }}>
          TIMELINE
        </span>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="t-label px-2"
          style={{ color: 'var(--muted)', background: 'transparent', border: 0, cursor: 'pointer' }}
          aria-expanded={!collapsed}
        >
          {collapsed ? '▴ EXPAND' : '▾ COLLAPSE'}
        </button>
      </div>

      {collapsed ? null : (
        <div className="no-scrollbar flex flex-1 items-center gap-6 overflow-x-auto px-4 pb-3">
          {events.length === 0 ? (
            <p className="t-body" style={{ color: 'var(--muted)' }}>
              No events yet. Create a delivery to begin.
            </p>
          ) : (
            events.map((e) => (
              <span key={e.id} className="flex shrink-0 items-baseline gap-2">
                <span className="t-mono" style={{ color: 'var(--graticule)' }}>
                  {stamp(e.clock)}
                </span>
                <span className="t-body" style={{ color: 'var(--paper)' }}>
                  {e.text}
                </span>
              </span>
            ))
          )}
        </div>
      )}
    </footer>
  )
}
