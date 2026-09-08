import { useState } from 'react'
import { getCity } from '../lib/city'
import { useFleet } from '../lib/fleet'
import { useStore } from '../store'

const PAYLOADS = ['Medicine', 'Medical sample', 'Food', 'Package'] as const
const PRIORITIES = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'] as const

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="t-label" style={{ color: 'var(--graticule)' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

const selectStyle: React.CSSProperties = {
  background: 'var(--panel-solid)',
  color: 'var(--paper)',
  border: '1px solid var(--rule)',
  borderRadius: 'var(--r-sm)',
  padding: '6px 8px',
  font: '400 13px/1.45 var(--font-ui)',
}

export default function DeliveryComposer() {
  const city = getCity()
  const fleet = useFleet()
  const missions = useStore((s) => s.missions) as { id: string; drone_id: string | null; state: string }[]

  const [payload, setPayload] = useState<string>('Medicine')
  const [origin, setOrigin] = useState('HUB-MED')
  const [dest, setDest] = useState('HOSP-2')
  const [priority, setPriority] = useState<string>('CRITICAL')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [assigned, setAssigned] = useState<{ id: string; drone: string } | null>(null)

  const inFlight = assigned && missions.some((m) => m.id === assigned.id)
  const live = inFlight ? fleet.find((d) => d.id === assigned?.drone) : undefined
  const available = fleet.filter((d) => d.status === 'IDLE').length

  async function deploy() {
    setError(null)
    if (!payload || !origin || !dest) {
      setError('Choose a payload, an origin hub and a destination.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/missions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'DELIVERY', payload_kind: payload, priority, origin_hub_id: origin, dest_id: dest }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(typeof body.detail === 'string' ? body.detail : 'Mission rejected.')
        return
      }
      setAssigned({ id: body.id, drone: body.drone_id })
    } catch (e) {
      setError(`Backend unreachable: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-3 px-4 py-4" style={{ borderBottom: '1px solid var(--rule-soft)' }}>
      <div className="flex items-baseline justify-between">
        <h2 className="t-label" style={{ color: 'var(--graticule)' }}>
          NEW DELIVERY
        </h2>
        <span className="t-mono-sm" style={{ color: 'var(--muted)' }}>
          {String(available).padStart(2, '0')} available
        </span>
      </div>

      <Field label="PAYLOAD">
        <select value={payload} onChange={(e) => setPayload(e.target.value)} style={selectStyle}>
          {PAYLOADS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="ORIGIN HUB">
          <select value={origin} onChange={(e) => setOrigin(e.target.value)} style={selectStyle}>
            {(city?.hubs ?? []).map((h) => (
              <option key={h.id} value={h.id}>{h.id}</option>
            ))}
          </select>
        </Field>
        <Field label="DESTINATION">
          <select value={dest} onChange={(e) => setDest(e.target.value)} style={selectStyle}>
            {(city?.destinations ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="PRIORITY">
        <select value={priority} onChange={(e) => setPriority(e.target.value)} style={selectStyle}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </Field>

      {error ? (
        <p className="t-body" style={{ color: 'var(--critical)' }}>
          {error}
        </p>
      ) : null}

      {inFlight && live ? (
        <div className="flex items-baseline justify-between px-3 py-2" style={{ border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)' }}>
          <span className="t-title" style={{ color: 'var(--nominal)', letterSpacing: '0.04em' }}>
            {live.id}
          </span>
          <span className="t-mono" style={{ color: 'var(--graticule)' }}>
            {live.missionState ?? 'ENROUTE'} · ETA {live.etaS === null ? '--' : `${Math.max(0, Math.round(live.etaS))}s`}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={deploy}
          disabled={busy}
          className="t-title w-full px-3 py-2"
          style={{
            background: busy ? 'var(--panel-solid)' : 'var(--nominal)',
            color: busy ? 'var(--muted)' : 'var(--ink)',
            border: 0,
            borderRadius: 'var(--r-sm)',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Deploying…' : 'Deploy drone'}
        </button>
      )}
    </section>
  )
}
