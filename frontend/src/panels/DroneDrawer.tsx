import { api } from '../lib/api'
import { useMemo } from 'react'
import { getCity, getRouteForDrone } from '../lib/city'
import { useFleet } from '../lib/fleet'
import { buildProfile, progressAlong } from '../lib/profile'
import { useStore } from '../store'
import AltitudeProfile from './AltitudeProfile'

function Hero({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="t-mono-lg" style={{ color: 'var(--paper)' }}>
        {value}
      </span>
      <span className="t-label" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
    </div>
  )
}

function Health({ label, value }: { label: string; value: number }) {
  const tone = value < 0.35 ? 'var(--critical)' : value < 0.7 ? 'var(--advisory)' : 'var(--nominal)'
  return (
    <div className="flex items-center gap-2">
      <span className="t-label w-14" style={{ color: 'var(--graticule)' }}>
        {label}
      </span>
      <span className="h-1.5 flex-1" style={{ background: 'var(--rule-soft)', borderRadius: 'var(--r-sm)' }}>
        <span className="block h-full" style={{ width: `${Math.round(value * 100)}%`, background: tone, borderRadius: 'var(--r-sm)' }} />
      </span>
      <span className="t-mono-sm w-9 text-right" style={{ color: 'var(--graticule)' }}>
        {Math.round(value * 100)}%
      </span>
    </div>
  )
}

export default function DroneDrawer() {
  const open = useStore((s) => s.drawerOpen)
  const id = useStore((s) => s.selectedDroneId)
  const close = useStore((s) => s.closeDrawer)
  const setFollow = useStore((s) => s.setFollow)
  const following = useStore((s) => s.followDroneId)
  const missions = useStore((s) => s.missions) as { id: string; payload_kind: string; priority: string; origin_hub_id: string; dest_id: string }[]
  const fleet = useFleet()
  const row = fleet.find((d) => d.id === id)

  const route = id ? getRouteForDrone(id) : null
  const zones = getCity()?.zones ?? []
  const profile = useMemo(() => (route ? buildProfile(route, zones) : null), [route?.id, zones.length])
  const along = route && row ? progressAlong(route, [row.lng ?? 0, row.lat ?? 0]).along : 0
  const mission = missions.find((m) => m.id === row?.meta.mission_id)

  if (!open || !row) return null

  return (
    <aside
      className="glass-drawer rail-right fixed right-0 z-30 flex flex-col"
      style={{
        top: 'var(--bar-h)',
        bottom: 'var(--timeline-h)',
        width: 'var(--drawer-w)',
        borderRadius: 0,
        animation: 'slide-in var(--t-standard) var(--ease-out)',
      }}
    >
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--rule-soft)' }}>
        <span className="t-title" style={{ color: 'var(--paper)', letterSpacing: '0.04em' }}>
          {row.id}
        </span>
        <span className="flex items-center gap-3">
          <span className="t-label" style={{ color: 'var(--nominal)' }}>
            {row.status}
          </span>
          <button type="button" onClick={close} className="t-label" style={{ background: 'transparent', border: 0, color: 'var(--graticule)', cursor: 'pointer' }} aria-label="Close">
            ✕
          </button>
        </span>
      </div>

      <div className="no-scrollbar flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-4 gap-2">
          <Hero value={row.alt.toFixed(0)} label="ALT m" />
          <Hero value={row.battery.toFixed(0)} label="BAT %" />
          <Hero value={row.speed.toFixed(1)} label="SPD m/s" />
          <Hero value={row.heading.toFixed(0).padStart(3, '0')} label="HDG °" />
        </div>

        <div className="flex flex-col gap-1">
          <span className="t-label" style={{ color: 'var(--graticule)' }}>
            MISSION
          </span>
          {mission ? (
            <>
              <span className="t-body" style={{ color: 'var(--paper)' }}>
                {mission.payload_kind} · {mission.priority}
              </span>
              <span className="t-body" style={{ color: 'var(--graticule)' }}>
                {mission.origin_hub_id} → {mission.dest_id}
              </span>
              <span className="t-mono" style={{ color: 'var(--graticule)' }}>
                ETA {row.etaS === null ? '--' : `${Math.max(0, Math.round(row.etaS))}s`} · {route?.id ?? 'no route'}
              </span>
            </>
          ) : (
            <span className="t-body" style={{ color: 'var(--muted)' }}>
              No mission assigned. Idle at {row.meta.home_hub_id}.
            </span>
          )}
        </div>

        {profile && profile.totalM > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="t-label" style={{ color: 'var(--graticule)' }}>
              ALTITUDE PROFILE
            </span>
            <AltitudeProfile profile={profile} along={along} alt={row.alt} />
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <span className="t-label" style={{ color: 'var(--graticule)' }}>
            HEALTH
          </span>
          <Health label="MOTORS" value={row.meta.health?.motors ?? 1} />
          <Health label="COMMS" value={row.meta.health?.comms ?? 1} />
          <Health label="GPS" value={row.meta.health?.gps ?? 1} />
          <div className="flex items-center gap-2">
            <span className="t-label w-14" style={{ color: 'var(--graticule)' }}>
              PAYLOAD
            </span>
            <span className="t-mono flex-1" style={{ color: 'var(--paper)' }}>
              {row.meta.payload_kg.toFixed(1)} kg
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-4 py-3" style={{ borderTop: '1px solid var(--rule-soft)' }}>
        <button
          type="button"
          onClick={() => setFollow(following === row.id ? null : row.id)}
          className="t-title w-full px-3 py-2"
          style={{
            background: following === row.id ? 'var(--panel-solid)' : 'var(--nominal)',
            color: following === row.id ? 'var(--nominal)' : 'var(--ink)',
            border: following === row.id ? '1px solid var(--nominal)' : 0,
            borderRadius: 'var(--r-sm)',
            cursor: 'pointer',
          }}
        >
          {following === row.id ? 'EXIT DRONE VIEW' : 'VIEW FROM DRONE'}
        </button>
        <div className="flex gap-2">
          {(['HOLD', 'RETURN'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() =>
                fetch(api('/api/decisions/manual/approve'), { method: 'POST' }).catch(() => undefined)
              }
              disabled
              className="t-title flex-1 px-3 py-2"
              style={{ background: 'transparent', color: 'var(--muted)', border: '1px solid var(--rule)', borderRadius: 'var(--r-sm)', cursor: 'default' }}
              title="Manual commands land in a later step; every mutation must go through apply_action"
            >
              {kind === 'HOLD' ? 'Hold' : 'Return to hub'}
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}
