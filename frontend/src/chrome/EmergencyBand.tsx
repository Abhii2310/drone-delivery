import { useEffect, useState } from 'react'
import { useStore } from '../store'

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function EmergencyBand() {
  const emergency = useStore((s) => s.emergency)
  const [since] = useState(() => Date.now())
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!emergency) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [emergency])

  return (
    <div
      className="fixed right-0 left-0 z-40 flex items-center gap-4 overflow-hidden px-4"
      style={{
        top: 'var(--bar-h)',
        height: emergency ? 72 : 0,
        background: 'var(--panel-solid)',
        borderBottom: emergency ? '1px solid var(--emergency)' : 'none',
        transition: 'height var(--t-standard) var(--ease-out)',
      }}
      aria-live="polite"
    >
      <div className="hazard-hatch pointer-events-none absolute inset-0" />
      {emergency ? (
        <>
          <span className="t-display relative" style={{ color: 'var(--emergency)' }}>
            {emergency.kind} RESPONSE ACTIVE
          </span>
          <span className="t-label relative" style={{ color: 'var(--paper)' }}>
            {emergency.zone_id}
          </span>
          <span className="t-mono-lg relative" style={{ color: 'var(--paper)' }}>
            {elapsed(now - since)}
          </span>
          {emergency.summary ? (
            <span className="t-mono relative ml-auto" style={{ color: 'var(--graticule)' }}>
              {emergency.summary.affected} affected · {emergency.summary.rerouted} rerouted ·{' '}
              {emergency.summary.returning} returning · {emergency.summary.emergency_landing} landing ·{' '}
              {emergency.summary.paused} paused
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
