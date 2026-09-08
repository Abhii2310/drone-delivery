import { useStore } from '../store'

export default function ConnectionBand() {
  const connection = useStore((s) => s.connection)
  const ready = useStore((s) => s.ready)
  const lost = connection.state === 'lost'
  const connecting = !ready && connection.state !== 'lost'

  return (
    <div
      className="fixed right-0 left-0 z-40 flex items-center gap-3 px-4"
      style={{
        top: 'var(--bar-h)',
        height: lost || connecting ? 32 : 0,
        overflow: 'hidden',
        background: 'var(--panel-solid)',
        borderBottom: lost ? '1px solid var(--advisory)' : 'none',
        transition: 'height var(--t-quick) var(--ease-out)',
      }}
      aria-live="polite"
    >
      {lost ? (
        <span className="t-mono" style={{ color: 'var(--advisory)' }}>
          Telemetry link lost. Reconnecting… (attempt {connection.attempt})
        </span>
      ) : connecting ? (
        <span className="t-mono" style={{ color: 'var(--graticule)' }}>
          Establishing telemetry link…
        </span>
      ) : null}
    </div>
  )
}
