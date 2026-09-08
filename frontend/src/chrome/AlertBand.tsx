import { useStore, type IncidentRecord } from '../store'

const RANK = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const

function describe(i: IncidentRecord): string {
  const f = i.facts as Record<string, number | string>
  if (i.kind === 'COLLISION') {
    return `CONFLICT PREDICTED · ${i.drone_ids.join(' × ')} · ${f.min_sep_m} m in ${f.t_cpa_s} s`
  }
  if (i.kind === 'BATTERY_RESERVE') return `BATTERY RESERVE · ${i.drone_ids[0]} · ${f.battery_pct}% against a ${f.reserve_pct}% floor`
  if (i.kind === 'GEOFENCE_PREDICTED') return `GEOFENCE AHEAD · ${i.drone_ids[0]} · ${f.zone_id} in ${f.eta_s} s`
  if (i.kind === 'GEOFENCE_BREACH') return `GEOFENCE BREACH · ${i.drone_ids[0]} · ${(f.zones as unknown as string[]).join(', ')}`
  if (i.kind === 'ALTITUDE_VIOLATION') return `ALTITUDE · ${i.drone_ids[0]} · ${f.delta_m} m ${f.kind === 'ABOVE_MAX' ? 'above' : 'below'} ${f.zone_id}`
  if (i.kind === 'HEALTH_DEGRADED') return `${String(f.part).toUpperCase()} DEGRADED · ${i.drone_ids[0]} · ${Math.round(Number(f.value) * 100)}%`
  if (i.kind === 'WEATHER_ADVISORY') return `WEATHER · wind ${f.wind_speed} m/s · visibility ${Number(f.visibility_m) / 1000} km`
  return `${i.kind} · ${i.drone_ids.join(' × ')}`
}

export default function AlertBand() {
  const incidents = useStore((s) => s.incidents)
  const alerting = incidents
    .filter((i) => i.severity !== 'INFO')
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.created_at - a.created_at)
  const top = alerting[0]
  const colour = top?.severity === 'CRITICAL' ? 'var(--critical)' : 'var(--advisory)'

  return (
    <div
      className="fixed right-0 left-0 z-40 flex items-center gap-4 px-4"
      style={{
        top: 'var(--bar-h)',
        height: top ? 44 : 0,
        overflow: 'hidden',
        background: 'var(--panel-solid)',
        backdropFilter: 'none',
        borderBottom: top ? `1px solid ${colour}` : 'none',
        boxShadow: top ? `inset 3px 0 0 ${colour}` : 'none',
        transition: 'height var(--t-quick) var(--ease-out)',
      }}
      aria-live="assertive"
    >
      {top ? (
        <>
          <span className="t-label" style={{ color: colour }}>
            {top.severity}
          </span>
          <span className="t-mono" style={{ color: 'var(--paper)' }}>
            {describe(top)}
          </span>
          {alerting.length > 1 ? (
            <span className="t-label ml-auto" style={{ color: 'var(--graticule)' }}>
              +{alerting.length - 1} MORE
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
