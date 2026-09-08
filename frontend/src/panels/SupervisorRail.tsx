import { useEffect, useRef, useState } from 'react'
import DeliveryComposer from './DeliveryComposer'
import { useStore, type ActionRecord } from '../store'
import { setLandingPulse } from '../lib/conflicts'

const FACT_STAGGER_MS = 80
const ALT_STAGGER_MS = 60

function useStagger(count: number, stepMs: number, active: boolean): number {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (!active) {
      setShown(0)
      return
    }
    setShown(0)
    const timers = Array.from({ length: count }, (_, i) => setTimeout(() => setShown(i + 1), i * stepMs))
    return () => timers.forEach(clearTimeout)
  }, [count, stepMs, active])
  return shown
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col">
      <span className="t-mono-sm" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      <span className="t-mono" style={{ color: tone ?? 'var(--paper)' }}>
        {value}
      </span>
    </div>
  )
}

function num(v: unknown, digits = 0): string {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(digits) : '--'
}

function Alternative({ action, index, selected, recommended, onSelect }: { action: ActionRecord; index: number; selected: boolean; recommended: boolean; onSelect: () => void }) {
  const p = action.params
  const corridors = Array.isArray(p.corridor_ids) ? (p.corridor_ids as string[]).join('+') : ''
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full px-3 py-2 text-left"
      style={{
        background: selected ? 'var(--select-tint)' : 'transparent',
        border: `1px solid ${recommended ? 'var(--advisory)' : 'var(--rule-soft)'}`,
        borderRadius: 'var(--r-sm)',
        cursor: 'pointer',
        animation: `fade-in var(--t-quick) var(--ease-out) ${index * ALT_STAGGER_MS}ms both`,
      }}
      aria-pressed={selected}
    >
      <div className="flex items-baseline justify-between pb-1">
        <span className="t-title" style={{ color: 'var(--paper)' }}>
          {action.kind === 'REROUTE'
            ? `Reroute via ${corridors || 'direct'}`
            : action.kind === 'ALTITUDE_CHANGE'
              ? `${String(p.direction) === 'descend' ? 'Descend' : 'Climb'} ${num(p.offset_m)} m to ${num(p.target_alt)} m`
              : action.kind === 'DIVERT_LAND'
                ? `Divert to ${String(p.landing_zone_name)}`
                : `Hold ${num(p.seconds)} s`}
        </span>
        {recommended ? (
          <span className="t-label" style={{ color: 'var(--advisory)' }}>
            RECOMMENDED
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Metric label="RISK" value={`${num(p.risk_pct_after)}%`} tone="var(--nominal)" />
        <Metric label="SLA" value={`${Number(p.sla_delta_s) >= 0 ? '+' : ''}${num(p.sla_delta_s)}s`} />
        <Metric label="BATT" value={`${Number(p.battery_delta_pct) >= 0 ? '+' : ''}${num(p.battery_delta_pct, 2)}%`} />
        <Metric label="COMM" value={`${Number(p.community_delta_pct) >= 0 ? '+' : ''}${num(p.community_delta_pct, 1)}s`} />
      </div>
    </button>
  )
}

export default function SupervisorRail() {
  const incidents = useStore((s) => s.incidents)
  const composerOpen = useStore((s) => s.composerOpen)
  const decision = useStore((s) => s.decision)
  const facts = useStore((s) => s.facts)
  const selected = useStore((s) => s.selectedAlternative)
  const applying = useStore((s) => s.applying)
  const aiEnabled = useStore((s) => s.aiEnabled)
  const emergency = useStore((s) => s.emergency)
  const phase = useStore((s) => s.emergencyPhase)
  const replaceable = useStore((s) => s.replaceableMission)
  const setReplaceable = useStore((s) => s.setReplaceable)
  const weather = useStore((s) => s.weather)
  const role = useStore((s) => s.role)
  const capabilities = useStore((s) => s.capabilities)
  const pendingConfirm = useStore((s) => s.pendingConfirm)
  const setPendingConfirm = useStore((s) => s.setPendingConfirm)
  const selectAlternative = useStore((s) => s.selectAlternative)
  const setApplying = useStore((s) => s.setApplying)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const doneAt = useRef<number>(0)

  const open = incidents.filter((i) => i.severity !== 'INFO')
  const investigating = open.some((i) => i.state === 'INVESTIGATING' || i.state === 'DETECTED')
  const expanded = aiEnabled && (open.length > 0 || decision !== null)

  type Pad = { id: string; name: string; score: number; distance_m: number; safety_score: number; free: number; capacity: number; reason?: string }
  const rawLanding = (facts as unknown as { landing_options?: unknown } | null)?.landing_options
  // a collision packet carries landing_options as a plain array; only the divert packet
  // carries the {ranked, rejected} selection
  const landing =
    rawLanding && !Array.isArray(rawLanding) && Array.isArray((rawLanding as { ranked?: Pad[] }).ranked)
      ? (rawLanding as { ranked: Pad[]; rejected: Pad[]; max_reachable_m: number; battery_pct: number })
      : null

  const factRows = facts
    ? [
        `separation ${facts.incident.min_sep_m} m · closing ${facts.incident.risk_pct}% risk`,
        `t-CPA ${facts.incident.t_cpa_s} s · vertical ${facts.incident.vertical_sep_m} m`,
        ...facts.drones.map((d) => `${d.id} ${d.priority} · ${d.battery_pct}% · ${d.altitude_m} m · ${d.operator}`),
        `${facts.yielding_drone} yields — lower priority of the pair`,
      ]
    : []
  const shownFacts = useStagger(factRows.length, FACT_STAGGER_MS, facts !== null)

  useEffect(() => {
    if (!done) return
    const id = setTimeout(() => setDone(null), 900)
    return () => clearTimeout(id)
  }, [done])

  async function send(path: 'approve' | 'reject') {
    if (!decision) return
    setError(null)
    setApplying(true)
    try {
      const res = await fetch(`/api/decisions/${decision.id}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: 'operator', alternative_index: path === 'approve' ? selected : null }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(typeof body.detail === 'string' ? body.detail : 'Action rejected.')
        setApplying(false)
        return
      }
      doneAt.current = Date.now()
      setDone(path === 'approve' ? 'Approved' : 'Rejected')
    } catch (e) {
      setError((e as Error).message)
      setApplying(false)
    }
  }

  return (
    <aside
      className="glass-rail rail-right fixed right-0 z-20 flex flex-col"
      style={{
        top: 'var(--bar-h)',
        bottom: 'var(--timeline-h)',
        width: expanded ? 440 : 'var(--rail-r)',
        borderRadius: 0,
        borderRight: 0,
        borderTop: 0,
        borderBottom: 0,
        transition: 'width var(--t-standard) var(--ease-out)',
      }}
    >
      {composerOpen ? <DeliveryComposer /> : null}
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--rule-soft)' }}>
        <h2 className="t-label" style={{ color: 'var(--graticule)' }}>
          AI SUPERVISOR
        </h2>
      </div>

      <div className="no-scrollbar relative flex-1 overflow-y-auto px-4 py-4">
        {investigating && !decision ? (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-16"
            style={{
              background: 'linear-gradient(180deg, transparent, var(--select-tint), transparent)',
              animation: 'scan var(--t-scan) var(--ease-out) infinite',
            }}
          />
        ) : null}

        {emergency?.summary && phase >= 1200 ? (
          <div className="mb-4 flex flex-col gap-1 px-3 py-2" style={{ border: '1px solid var(--emergency)', borderRadius: 'var(--r-sm)' }}>
            <span className="t-label" style={{ color: 'var(--emergency)' }}>
              {emergency.kind} · {emergency.zone_id}
            </span>
            <span className="t-body" style={{ color: 'var(--paper)' }}>
              {emergency.summary.affected} flights affected — {emergency.summary.rerouted} rerouted,{' '}
              {emergency.summary.returning} returning, {emergency.summary.emergency_landing} emergency landing,{' '}
              {emergency.summary.paused} paused
            </span>
            <span className="t-mono-sm" style={{ color: 'var(--graticule)' }}>
              {emergency.summary.available_for_rescue} available for rescue
            </span>
          </div>
        ) : null}

        {weather ? (
          <div className="mb-4 flex flex-col gap-0.5 pb-3" style={{ borderBottom: '1px solid var(--rule-soft)' }}>
            <span className="t-label" style={{ color: 'var(--graticule)' }}>
              WEATHER · {(weather as unknown as { source?: string }).source ?? 'LIVE'}
            </span>
            <span className="t-mono" style={{ color: 'var(--paper)' }}>
              {weather.wind_speed.toFixed(1)} m/s {String(Math.round(weather.wind_direction)).padStart(3, '0')}°
            </span>
            <span className="t-mono-sm" style={{ color: 'var(--graticule)' }}>
              vis {(weather.visibility_m / 1000).toFixed(1)} km
            </span>
          </div>
        ) : null}

        {role === 'CUSTOMER' ? (
          <p className="t-body" style={{ color: 'var(--muted)' }}>
            Your delivery only. Approvals require a workstation.
          </p>
        ) : !aiEnabled ? (
          <p className="t-body" style={{ color: 'var(--muted)' }}>
            AI Supervisor disabled. Raw safety alert only.
          </p>
        ) : open.length === 0 && !decision ? (
          <p className="t-body" style={{ color: 'var(--muted)' }}>
            No open incidents. Airspace nominal.
          </p>
        ) : null}

        {aiEnabled && facts ? (
          <div className="flex flex-col gap-1 pb-4">
            <span className="t-label pb-1" style={{ color: 'var(--graticule)' }}>
              {decision ? 'FACTS' : 'INVESTIGATING'}
            </span>
            {factRows.slice(0, shownFacts).map((row, i) => (
              <span key={`fact-${i}`} className="t-mono" style={{ color: 'var(--graticule)' }}>
                {row}
              </span>
            ))}
          </div>
        ) : null}

        {aiEnabled && decision ? (
          <div className="flex flex-col gap-3">
            <div>
              <span className="flex items-center gap-2">
                <span className="t-label" style={{ color: 'var(--graticule)' }}>
                  RECOMMENDATION
                </span>
                <span
                  className="t-label px-1.5"
                  style={{
                    color: decision.source === 'LIVE_AI' ? 'var(--nominal)' : 'var(--graticule)',
                    border: `1px solid ${decision.source === 'LIVE_AI' ? 'var(--nominal)' : 'var(--rule)'}`,
                    borderRadius: 'var(--r-sm)',
                  }}
                >
                  {decision.source}
                </span>
                <span className="t-label" style={{ color: 'var(--graticule)' }}>
                  CONFIDENCE {(decision.confidence * 100).toFixed(0)}%
                </span>
              </span>
              <p className="t-title pt-1" style={{ color: 'var(--paper)' }}>
                {decision.summary}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              {decision.reasoning.map((r, i) => (
                <p key={`reason-${i}`} className="t-body" style={{ color: 'var(--graticule)' }}>
                  {r}
                </p>
              ))}
            </div>
            {landing ? (
              <div className="flex flex-col gap-2">
                <span className="t-label" style={{ color: 'var(--graticule)' }}>
                  LANDING CANDIDATES · {landing.battery_pct}% BATTERY, {landing.max_reachable_m} m REACHABLE
                </span>
                {landing.ranked.map((p, i) => (
                  <div key={p.id} className="flex items-baseline justify-between px-2 py-1"
                    style={{ border: `1px solid ${i === 0 ? 'var(--nominal)' : 'var(--rule-soft)'}`, borderRadius: 'var(--r-sm)' }}>
                    <span className="t-body" style={{ color: 'var(--paper)' }}>
                      {i + 1}. {p.name}
                    </span>
                    <span className="t-mono-sm" style={{ color: 'var(--graticule)' }}>
                      {p.score.toFixed(2)} · {p.distance_m} m · safety {p.safety_score} · {p.free}/{p.capacity}
                    </span>
                  </div>
                ))}
                <span className="t-label pt-1" style={{ color: 'var(--muted)' }}>
                  REJECTED CANDIDATES
                </span>
                {landing.rejected.map((p) => (
                  <div key={p.id} className="flex items-baseline justify-between px-2 py-1"
                    style={{ border: '1px dashed var(--rule-soft)', borderRadius: 'var(--r-sm)', opacity: 0.55 }}>
                    <span className="t-body" style={{ color: 'var(--muted)' }}>
                      {p.name}
                    </span>
                    <span className="t-mono-sm" style={{ color: 'var(--muted)' }}>
                      {p.reason}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <span className="t-label" style={{ color: 'var(--graticule)' }}>
                ALTERNATIVES
              </span>
              {decision.alternatives.map((a, i) => (
                <Alternative
                  key={`alt-${i}`}
                  action={a}
                  index={i}
                  selected={selected === i}
                  recommended={
                    a.kind === decision.recommended_action.kind &&
                    a.params.route_id === decision.recommended_action.params.route_id &&
                    a.params.landing_zone_id === decision.recommended_action.params.landing_zone_id &&
                    a.params.target_alt === decision.recommended_action.params.target_alt
                  }
                  onSelect={() => selectAlternative(i)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="t-body pt-3" style={{ color: 'var(--critical)' }}>
            {error}
          </p>
        ) : null}
      </div>

      {replaceable ? (
        <div className="px-4 py-3" style={{ borderTop: '1px solid var(--rule-soft)' }}>
          <button
            type="button"
            onClick={async () => {
              await fetch(`/api/missions/${replaceable}/dispatch-replacement`, { method: 'POST' })
              setReplaceable(null)
              setLandingPulse(null)
            }}
            className="t-title w-full px-3 py-2"
            style={{ background: 'transparent', color: 'var(--nominal)', border: '1px solid var(--nominal)', borderRadius: 'var(--r-sm)', cursor: 'pointer' }}
          >
            Dispatch replacement for {replaceable}
          </button>
        </div>
      ) : null}

      {aiEnabled && capabilities.includes('approve') ? (
      <div className="workstation-only flex flex-col gap-2 px-4 py-3" style={{ borderTop: '1px solid var(--rule-soft)' }}>
        {pendingConfirm === 'approve' && decision ? (
          <div className="flex flex-col gap-2 px-3 py-2" style={{ border: '1px solid var(--critical)', borderRadius: 'var(--r-sm)' }}>
            <p className="t-body" style={{ color: 'var(--paper)' }}>
              Approve this {decision.severity.toLowerCase()} decision? {decision.summary}
            </p>
            <div className="flex gap-2">
              <button type="button" autoFocus onClick={() => { setPendingConfirm(null); void send('approve') }}
                className="t-title flex-1 px-3 py-2"
                style={{ background: 'var(--nominal)', color: 'var(--ink)', border: 0, borderRadius: 'var(--r-sm)', cursor: 'pointer' }}>
                Confirm approval
              </button>
              <button type="button" onClick={() => setPendingConfirm(null)} className="t-title px-3 py-2"
                style={{ background: 'transparent', color: 'var(--graticule)', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        <div className="flex gap-2">
        <button
          type="button"
          onClick={() => (decision?.severity === 'CRITICAL' ? setPendingConfirm('approve') : send('approve'))}
          disabled={!decision || applying || selected === null}
          className="t-title flex-1 px-3 py-2"
          style={{
            background: done === 'Approved' ? 'var(--executed)' : decision && !applying ? 'var(--nominal)' : 'var(--panel-solid)',
            color: decision && !applying ? 'var(--ink)' : 'var(--muted)',
            border: 0,
            borderRadius: 'var(--r-sm)',
            cursor: decision && !applying ? 'pointer' : 'default',
            animation: decision && !applying ? 'scale-in var(--t-instant) var(--ease-out)' : undefined,
          }}
        >
          {applying ? 'Applying…' : done === 'Approved' ? 'Approved' : 'Approve'}
        </button>
        <button
          type="button"
          onClick={() => send('reject')}
          disabled={!decision || applying}
          className="t-title px-3 py-2"
          style={{
            background: 'transparent',
            color: decision && !applying ? 'var(--graticule)' : 'var(--muted)',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--r-sm)',
            cursor: decision && !applying ? 'pointer' : 'default',
          }}
        >
          Reject
        </button>
        </div>
      </div>
      ) : null}
    </aside>
  )
}
