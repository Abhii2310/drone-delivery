import { useMemo } from 'react'
import { getCity, getRouteForDrone } from '../lib/city'
import { useFleet } from '../lib/fleet'
import { buildProfile, ceilingAt, nextCeiling, progressAlong } from '../lib/profile'
import { useStore } from '../store'

const LADDER_TOP = 200

function Tape({ heading }: { heading: number }) {
  const marks = [-60, -40, -20, 0, 20, 40, 60].map((off) => ({
    off,
    deg: Math.round((heading + off + 360) % 360),
  }))
  return (
    <div className="pointer-events-none absolute top-3 right-0 left-0 flex justify-center">
      <div className="flex items-baseline gap-6 px-4 py-1" style={{ background: 'var(--panel-solid)', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)' }}>
        {marks.map((m) => (
          <span key={m.off} className={m.off === 0 ? 't-mono' : 't-mono-sm'} style={{ color: m.off === 0 ? 'var(--paper)' : 'var(--muted)' }}>
            {m.off === 0 ? `▼ ${String(m.deg).padStart(3, '0')}` : String(m.deg).padStart(3, '0')}
          </span>
        ))}
      </div>
    </div>
  )
}

function Ladder({ side, value, unit, ceiling }: { side: 'left' | 'right'; value: number; unit: string; ceiling: number | null }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * LADDER_TOP))
  const pos = (v: number) => `${100 - Math.max(0, Math.min(100, (v / LADDER_TOP) * 100))}%`
  return (
    <div className="pointer-events-none absolute" style={{ [side]: 16, top: '18%', bottom: '22%', width: 74 }}>
      <div className="relative h-full" style={{ [side === 'left' ? 'borderRight' : 'borderLeft']: '1px solid var(--rule)' }}>
        {ticks.map((t) => (
          <span key={t} className="t-mono-sm absolute" style={{ top: pos(t), [side]: 4, color: 'var(--muted)', transform: 'translateY(-50%)' }}>
            {t}
          </span>
        ))}
        {ceiling !== null && ceiling <= LADDER_TOP ? (
          <span className="absolute flex items-center gap-1" style={{ top: pos(ceiling), left: 0, right: 0, transform: 'translateY(-50%)' }}>
            <span style={{ height: 2, background: 'var(--critical)', flex: 1 }} />
            <span className="t-mono-sm" style={{ color: 'var(--critical)' }}>
              {ceiling}
            </span>
          </span>
        ) : null}
        <span
          className="t-mono absolute px-1"
          style={{ top: pos(value), [side]: 0, transform: 'translateY(-50%)', background: 'var(--panel-solid)', color: 'var(--paper)', border: '1px solid var(--nominal)', borderRadius: 'var(--r-sm)' }}
        >
          {value.toFixed(0)}
          <span className="t-mono-sm" style={{ color: 'var(--muted)' }}>
            {unit}
          </span>
        </span>
      </div>
    </div>
  )
}

export default function DroneHud() {
  const followId = useStore((s) => s.followDroneId)
  const missions = useStore((s) => s.missions) as { id: string; payload_kind: string; priority: string; dest_id: string }[]
  const fleet = useFleet()
  const row = fleet.find((d) => d.id === followId)

  const route = followId ? getRouteForDrone(followId) : null
  const zones = getCity()?.zones ?? []
  const profile = useMemo(() => (route ? buildProfile(route, zones) : null), [route?.id, zones.length])
  const along = profile && row ? progressAlong(route!, [row.lng, row.lat]).along : 0
  const here = profile ? ceilingAt(profile, along) : null
  const ahead = profile ? nextCeiling(profile, along) : null
  const mission = missions.find((m) => m.id === row?.meta.mission_id)

  if (!followId || !row) return null
  const advisory = here
    ? `ZONE ${here.zoneId} CEILING ${here.ceiling}m — YOU ARE AT ${row.alt.toFixed(0)}m`
    : ahead
      ? `ZONE ${ahead.band.zoneId} CEILING ${ahead.band.ceiling}m IN ${ahead.inM}m`
      : 'NO CEILING AHEAD ON THIS LEG'

  return (
    <div className="pointer-events-none fixed z-20" style={{ top: 'var(--bar-h)', bottom: 'var(--timeline-h)', left: 'var(--rail-l)', right: 380 }}>
      <Tape heading={row.heading} />
      <Ladder side="left" value={row.alt} unit="m" ceiling={here?.ceiling ?? ahead?.band.ceiling ?? null} />
      <Ladder side="right" value={row.battery} unit="%" ceiling={null} />

      <span className="absolute" style={{ left: '50%', top: '52%', transform: 'translate(-50%,-50%)', color: 'var(--paper)', opacity: 0.6 }}>
        <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
          <path d="M17 4v9M17 21v9M4 17h9M21 17h9" stroke="currentColor" strokeWidth="1" />
          <circle cx="17" cy="17" r="3" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      </span>

      <div className="absolute right-4 bottom-4 left-4 flex flex-col gap-1">
        <span className="t-mono flex items-baseline gap-4 px-3 py-1" style={{ background: 'var(--panel-solid)', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', color: 'var(--paper)' }}>
          <span style={{ letterSpacing: '0.04em' }}>{row.id}</span>
          <span style={{ color: 'var(--graticule)' }}>
            {mission ? `${mission.payload_kind} → ${mission.dest_id}` : 'no mission'}
          </span>
          <span style={{ color: 'var(--advisory)' }}>{row.meta.priority}</span>
          <span className="ml-auto">{row.speed.toFixed(1)} m/s</span>
        </span>
        <span className="t-mono-sm px-3 py-1" style={{ background: 'var(--panel-solid)', border: `1px solid ${here ? 'var(--critical)' : 'var(--rule)'}`, borderRadius: 'var(--r-sm)', color: here ? 'var(--critical)' : 'var(--graticule)' }}>
          ▓ {advisory}
        </span>
      </div>
    </div>
  )
}
