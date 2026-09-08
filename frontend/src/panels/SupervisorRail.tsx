import { useStore } from '../store'

export default function SupervisorRail() {
  const incidents = useStore((s) => s.incidents.length)

  return (
    <aside
      className="glass-rail fixed right-0 z-20 flex flex-col"
      style={{
        top: 'var(--bar-h)',
        bottom: 'var(--timeline-h)',
        width: 'var(--rail-r)',
        borderRadius: 0,
        borderRight: 0,
        borderTop: 0,
        borderBottom: 0,
      }}
    >
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--rule-soft)' }}>
        <h2 className="t-label" style={{ color: 'var(--graticule)' }}>
          AI SUPERVISOR
        </h2>
      </div>
      <div className="flex-1 px-4 py-4">
        {incidents === 0 ? (
          <p className="t-body" style={{ color: 'var(--muted)' }}>
            No open incidents. Airspace nominal.
          </p>
        ) : null}
      </div>
    </aside>
  )
}
