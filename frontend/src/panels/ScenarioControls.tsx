import { useState } from 'react'

const SCENARIOS: [string, string][] = [
  ['TRIGGER_COLLISION', 'Collision'],
  ['GPS_FAILURE', 'GPS fail'],
  ['COMMS_LOSS', 'Comms loss'],
  ['LOW_BATTERY', 'Low battery'],
  ['ALTITUDE_VIOLATION', 'Alt breach'],
  ['BAD_WEATHER', 'Bad weather'],
  ['CLOSE_ZONE', 'Close zone'],
  ['LANDING_ZONE_UNAVAILABLE', 'Pad full'],
  ['MOTOR_FAILURE', 'Motor fail'],
]

export default function ScenarioControls() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function fire(name: string) {
    setBusy(name)
    setError(null)
    try {
      const res = await fetch(`/api/scenario/${name}`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json()
        setError(typeof body.detail === 'string' ? body.detail : 'Scenario rejected.')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="px-3 py-3" style={{ borderTop: '1px solid var(--rule-soft)' }}>
      <h3 className="t-label pb-2" style={{ color: 'var(--graticule)' }}>
        SCENARIOS
      </h3>
      <div className="flex flex-wrap gap-1">
        {SCENARIOS.map(([name, label]) => (
          <button
            key={name}
            type="button"
            onClick={() => fire(name)}
            disabled={busy !== null}
            className="t-label px-2 py-1"
            style={{
              background: 'transparent',
              color: name === 'TRIGGER_COLLISION' ? 'var(--critical)' : 'var(--graticule)',
              border: `1px solid ${name === 'TRIGGER_COLLISION' ? 'var(--critical)' : 'var(--rule)'}`,
              borderRadius: 'var(--r-sm)',
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? (
        <p className="t-body pt-2" style={{ color: 'var(--advisory)' }}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
