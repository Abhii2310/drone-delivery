import { api } from '../lib/api'
import { useFleet } from '../lib/fleet'
import { useStore } from '../store'
import RolePicker from './RolePicker'
import ResetControl from './ResetControl'
import { photorealConfigured } from '../lib/photoreal'

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
  const liveAi = useStore((s) => s.liveAi)
  const setAiEnabled = useStore((s) => s.setAiEnabled)
  const composerOpen = useStore((s) => s.composerOpen)
  const toggleComposer = useStore((s) => s.toggleComposer)
  const photoreal = useStore((s) => s.photoreal)
  const setPhotoreal = useStore((s) => s.setPhotoreal)
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
          SKYGRID
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
        <button
          type="button"
          onClick={() => toggleComposer()}
          className="t-label px-3 py-1.5"
          style={{
            background: composerOpen ? 'var(--nominal)' : 'transparent',
            color: composerOpen ? 'var(--ink)' : 'var(--nominal)',
            border: '1px solid var(--nominal)',
            borderRadius: 'var(--r-sm)',
            cursor: 'pointer',
          }}
          aria-pressed={composerOpen}
        >
          NEW DELIVERY
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={aiEnabled}
          onClick={async () => {
            const next = !aiEnabled
            setAiEnabled(next)
            await fetch(api('/api/ai'), {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ enabled: next }),
            })
          }}
          className="flex items-center gap-1.5 px-2 py-1"
          style={{
            background: 'transparent',
            border: `1px solid ${aiEnabled ? 'var(--nominal)' : 'var(--rule)'}`,
            borderRadius: 'var(--r-sm)',
            cursor: 'pointer',
          }}
        >
          <span
            className="inline-block h-1.5 w-1.5"
            style={{ borderRadius: 'var(--r-md)', background: aiEnabled ? 'var(--nominal)' : 'var(--muted)' }}
          />
          <span className="t-label" style={{ color: aiEnabled ? 'var(--nominal)' : 'var(--muted)' }}>
            AI {aiEnabled ? (liveAi ? 'LIVE' : 'MOCK') : 'OFF'}
          </span>
        </button>
        {photorealConfigured && (
          <button
            type="button"
            role="switch"
            aria-checked={photoreal}
            onClick={() => setPhotoreal(!photoreal)}
            className="workstation-only flex items-center gap-1.5 px-2 py-1"
            title="Photorealistic 3D city imagery"
            style={{
              background: 'transparent',
              border: `1px solid ${photoreal ? 'var(--nominal)' : 'var(--rule)'}`,
              borderRadius: 'var(--r-sm)',
              cursor: 'pointer',
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5"
              style={{ borderRadius: 'var(--r-md)', background: photoreal ? 'var(--nominal)' : 'var(--muted)' }}
            />
            <span className="t-label" style={{ color: photoreal ? 'var(--nominal)' : 'var(--muted)' }}>
              3D CITY
            </span>
          </button>
        )}
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
        <span className="workstation-only flex items-center gap-3">
          <RolePicker />
          <ResetControl />
        </span>
        <span className="t-mono-sm" style={{ color: 'var(--muted)' }}>
          ⌘K
        </span>
      </div>
    </header>
  )
}
