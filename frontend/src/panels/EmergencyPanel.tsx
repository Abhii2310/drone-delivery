import { useState } from 'react'
import { useStore } from '../store'

const KINDS = ['FLOOD', 'FIRE', 'EARTHQUAKE', 'LANDSLIDE'] as const
const PAYLOADS = ['MEDICINE', 'WATER', 'FOOD', 'EQUIPMENT'] as const
const ZONES = ['ZONE-B'] as const

const control: React.CSSProperties = {
  background: 'var(--panel-solid)',
  color: 'var(--paper)',
  border: '1px solid var(--rule)',
  borderRadius: 'var(--r-sm)',
  padding: '6px 8px',
  font: '400 13px/1.45 var(--font-ui)',
}

function Row({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="t-label" style={{ color: 'var(--graticule)' }}>
        {label}
      </span>
      <span className="t-mono" style={{ color: tone ?? 'var(--paper)' }}>
        {String(value).padStart(2, '0')}
      </span>
    </div>
  )
}

export default function EmergencyPanel() {
  const emergency = useStore((s) => s.emergency)
  const [kind, setKind] = useState<string>('FLOOD')
  const [zone, setZone] = useState<string>('ZONE-B')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payloads, setPayloads] = useState<string[]>([...PAYLOADS])
  const [assigned, setAssigned] = useState<Record<string, string> | null>(null)

  async function post(path: string, body?: unknown) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const out = await res.json()
      if (!res.ok) {
        setError(typeof out.detail === 'string' ? out.detail : 'Rejected.')
        return null
      }
      return out
    } catch (e) {
      setError((e as Error).message)
      return null
    } finally {
      setBusy(false)
    }
  }

  const summary = emergency?.summary

  return (
    <section className="flex flex-col gap-3 px-4 py-4" style={{ borderBottom: '1px solid var(--rule-soft)' }}>
      <div className="flex items-baseline justify-between">
        <h2 className="t-label" style={{ color: emergency ? 'var(--emergency)' : 'var(--graticule)' }}>
          GOVERNMENT RESPONSE
        </h2>
        {emergency ? (
          <span className="t-label" style={{ color: 'var(--emergency)' }}>
            {emergency.kind} · {emergency.zone_id}
          </span>
        ) : null}
      </div>

      {!emergency ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="t-label" style={{ color: 'var(--graticule)' }}>
                DISASTER
              </span>
              <select value={kind} onChange={(e) => setKind(e.target.value)} style={control}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-label" style={{ color: 'var(--graticule)' }}>
                AFFECTED ZONE
              </span>
              <select value={zone} onChange={(e) => setZone(e.target.value)} style={control}>
                {ZONES.map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>
            </label>
          </div>

          {confirming ? (
            <div className="flex flex-col gap-2 px-3 py-2" style={{ border: '1px solid var(--emergency)', borderRadius: 'var(--r-sm)' }}>
              <p className="t-body" style={{ color: 'var(--paper)' }}>
                Activate {kind.toLowerCase()} response over {zone}? Low and normal priority flights stand down.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setConfirming(false)
                  }}
                  onClick={async () => {
                    const out = await post('/api/emergency/activate', { kind, zone_id: zone })
                    if (out) setConfirming(false)
                  }}
                  disabled={busy}
                  className="t-title flex-1 px-3 py-2"
                  style={{ background: 'var(--emergency)', color: 'var(--ink)', border: 0, borderRadius: 'var(--r-sm)', cursor: 'pointer' }}
                >
                  {busy ? 'Activating…' : 'Confirm activation'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="t-title px-3 py-2"
                  style={{ background: 'transparent', color: 'var(--graticule)', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="t-title w-full px-3 py-2"
              style={{ background: 'transparent', color: 'var(--emergency)', border: '1px solid var(--emergency)', borderRadius: 'var(--r-sm)', cursor: 'pointer' }}
            >
              Activate {kind.toLowerCase()} response
            </button>
          )}
        </>
      ) : (
        <>
          {summary ? (
            <div className="flex flex-col gap-1">
              <Row label="FLIGHTS AFFECTED" value={summary.affected} tone="var(--emergency)" />
              <Row label="REROUTED" value={summary.rerouted} />
              <Row label="RETURNING" value={summary.returning} />
              <Row label="EMERGENCY LANDING" value={summary.emergency_landing} />
              <Row label="PAUSED" value={summary.paused} />
              <Row label="AVAILABLE FOR RESCUE" value={summary.available_for_rescue} tone="var(--nominal)" />
            </div>
          ) : null}

          <div className="flex flex-col gap-2 pt-1" style={{ borderTop: '1px solid var(--rule-soft)' }}>
            <span className="t-label pt-2" style={{ color: 'var(--graticule)' }}>
              RESCUE PAYLOADS
            </span>
            <div className="flex flex-wrap gap-2">
              {PAYLOADS.map((p) => (
                <label key={p} className="t-label flex items-center gap-1.5" style={{ color: 'var(--paper)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={payloads.includes(p)}
                    onChange={(e) => setPayloads((cur) => (e.target.checked ? [...cur, p] : cur.filter((x) => x !== p)))}
                  />
                  {p}
                </label>
              ))}
            </div>
            <button
              type="button"
              disabled={busy || payloads.length === 0}
              onClick={async () => {
                const out = await post('/api/missions/rescue', { zone_id: emergency.zone_id, payloads })
                if (out) setAssigned(out.assignments)
              }}
              className="t-title w-full px-3 py-2"
              style={{
                background: payloads.length ? 'var(--nominal)' : 'var(--panel-solid)',
                color: payloads.length ? 'var(--ink)' : 'var(--muted)',
                border: 0,
                borderRadius: 'var(--r-sm)',
                cursor: payloads.length ? 'pointer' : 'default',
              }}
            >
              {busy ? 'Dispatching…' : `Dispatch rescue (${payloads.length})`}
            </button>
            {assigned ? (
              <div className="t-mono flex flex-col gap-0.5" style={{ color: 'var(--graticule)' }}>
                {Object.entries(assigned).map(([p, d]) => (
                  <span key={p}>
                    {p} → {d}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => post('/api/emergency/deactivate')}
            className="t-title w-full px-3 py-2"
            style={{ background: 'transparent', color: 'var(--graticule)', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', cursor: 'pointer' }}
          >
            Stand down
          </button>
        </>
      )}

      {error ? (
        <p className="t-body" style={{ color: 'var(--critical)' }}>
          {error}
        </p>
      ) : null}
    </section>
  )
}
