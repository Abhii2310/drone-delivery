import { useFleet } from '../lib/fleet'
import { useStore } from '../store'

const AIRBORNE = new Set(['ENROUTE', 'HOLDING', 'DIVERTING', 'LANDING'])

function Count({ n, label }: { n: number; label: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="t-mono" style={{ color: 'var(--paper)' }}>
        {String(n).padStart(2, '0')}
      </span>
      <span className="t-label" style={{ color: 'var(--graticule)' }}>
        {label}
      </span>
    </span>
  )
}

export default function StatusBar() {
  const fleet = useFleet()
  const missions = useStore((s) => s.missions.length)
  const incidents = useStore((s) => s.incidents.length)
  const emergency = useStore((s) => s.emergency)
  const aiEnabled = useStore((s) => s.aiEnabled)
  const airborne = fleet.filter((d) => AIRBORNE.has(d.status)).length

  return (
    <header
      className="glass-rail fixed top-0 right-0 left-0 z-30 flex items-center gap-6 px-4"
      style={{ height: 'var(--bar-h)', borderRadius: 0, borderLeft: 0, borderRight: 0, borderTop: 0 }}
    >
      <div className="flex items-baseline gap-2">
        <span className="t-display" style={{ color: 'var(--nominal)' }}>
          ◈
        </span>
        <span className="t-display" style={{ color: 'var(--paper)' }}>
          SKYGUARD
        </span>
      </div>

      <div className="flex items-baseline gap-4">
        <span className="t-label" style={{ color: 'var(--graticule)' }}>
          BENGALURU
        </span>
        <span className="t-label" style={{ color: emergency ? 'var(--emergency)' : 'var(--nominal)' }}>
          {emergency ? 'EMERGENCY' : 'NOMINAL'}
        </span>
      </div>

      <div className="flex flex-1 items-baseline gap-5">
        <Count n={airborne} label="AIRBORNE" />
        <Count n={missions} label="MISSIONS" />
        <Count n={incidents} label="INCIDENTS" />
      </div>

      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-1.5"
            style={{ borderRadius: 'var(--r-md)', background: aiEnabled ? 'var(--nominal)' : 'var(--muted)' }}
          />
          <span className="t-label" style={{ color: 'var(--graticule)' }}>
            AI {aiEnabled ? 'LIVE' : 'OFF'}
          </span>
        </span>
        <span
          className="t-label px-2 py-1"
          style={{
            borderRadius: 'var(--r-sm)',
            border: '1px solid var(--rule)',
            color: emergency ? 'var(--emergency)' : 'var(--muted)',
          }}
        >
          EMERGENCY {emergency ? 'ON' : 'OFF'}
        </span>
        <span className="t-mono-sm" style={{ color: 'var(--muted)' }}>
          ⌘K
        </span>
      </div>
    </header>
  )
}
