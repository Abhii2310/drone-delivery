import { useLayoutEffect, useRef } from 'react'
import { useFleet, type FleetRow, type Priority } from '../lib/fleet'
import { useStore } from '../store'
import ScenarioControls from './ScenarioControls'

const RANK: Record<Priority, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 }
const GROUNDED = new Set(['IDLE', 'CHARGING', 'MAINTENANCE', 'LANDED'])

function stateColour(row: FleetRow, alert: 'CRITICAL' | 'WARNING' | null): string {
  if (alert === 'CRITICAL' || row.status === 'LOST' || row.battery < 15) return 'var(--critical)'
  if (alert === 'WARNING') return 'var(--advisory)'
  if (row.status === 'DIVERTING' || row.status === 'HOLDING' || row.battery < 25) return 'var(--advisory)'
  if (GROUNDED.has(row.status)) return 'var(--muted)'
  return 'var(--nominal)'
}

const batteryColour = (b: number) => (b < 15 ? 'var(--critical)' : b < 25 ? 'var(--advisory)' : 'var(--paper)')

function missionLine(row: FleetRow): string {
  if (row.meta.mission_id) {
    const eta = row.etaS === null ? '' : ` · ETA ${Math.max(0, Math.round(row.etaS))}s`
    return `${row.meta.mission_id} ${row.missionState ?? ''}${eta}`
  }
  if (row.meta.package_id) return `${row.meta.package_id} · ${row.meta.operator_id}`
  if (!GROUNDED.has(row.status)) return `${row.meta.operator_id} · in transit`
  return `Idle at ${row.meta.home_hub_id}`
}

function Strip({ row, selected, alert, onSelect, innerRef }: { row: FleetRow; selected: boolean; alert: 'CRITICAL' | 'WARNING' | null; onSelect: () => void; innerRef: (el: HTMLDivElement | null) => void }) {
  const colour = stateColour(row, alert)
  return (
    <div
      ref={innerRef}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect()
      }}
      className={`strip relative cursor-pointer px-3 ${selected ? 'strip-selected glow-selected' : ''}`}
      style={{
        height: 64,
        borderBottom: '1px solid var(--rule-soft)',
        borderRadius: 0,
        transition: 'background var(--t-instant) var(--ease-out)',
      }}
    >
      <span
        className="absolute top-0 bottom-0 left-0"
        style={{ width: selected ? 5 : 3, background: colour, transition: 'width var(--t-instant) var(--ease-out)' }}
      />
      <div className="flex h-full flex-col justify-center gap-0.5 pl-3">
        <div className="flex items-baseline justify-between">
          <span className="t-title" style={{ color: 'var(--paper)', letterSpacing: '0.04em' }}>
            {row.id}
          </span>
          <span className="t-label" style={{ color: colour }}>
            {row.status}
          </span>
        </div>
        <div className="t-mono flex items-baseline gap-3" style={{ color: 'var(--graticule)' }}>
          <span>{row.alt.toFixed(0).padStart(3, '0')} m</span>
          <span style={{ color: batteryColour(row.battery) }}>{row.battery.toFixed(0).padStart(2, '0')}%</span>
          <span>{row.speed.toFixed(1)} m/s</span>
          <span>{row.heading.toFixed(0).padStart(3, '0')}°</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="t-body truncate" style={{ color: 'var(--muted)' }}>
            {missionLine(row)}
          </span>
          <span className="t-label shrink-0" style={{ color: 'var(--graticule)' }}>
            {row.meta.priority}
          </span>
        </div>
      </div>
    </div>
  )
}

export default function FleetRail() {
  const fleet = useFleet()
  const selectedDroneId = useStore((s) => s.selectedDroneId)
  const incidents = useStore((s) => s.incidents)
  const selectDrone = useStore((s) => s.selectDrone)

  const alerts = new Map<string, 'CRITICAL' | 'WARNING'>()
  for (const i of incidents) {
    if (i.severity === 'INFO') continue
    for (const id of i.drone_ids) {
      if (i.severity === 'CRITICAL' || !alerts.has(id)) alerts.set(id, i.severity)
    }
  }

  const rows = [...fleet].sort((a, b) => RANK[a.meta.priority] - RANK[b.meta.priority] || a.id.localeCompare(b.id))

  const els = useRef(new Map<string, HTMLDivElement>())
  const rects = useRef(new Map<string, DOMRect>())
  const order = useRef('')

  // FLIP once, only when priority actually reorders the board
  useLayoutEffect(() => {
    const next = rows.map((r) => r.id).join(',')
    if (order.current && next !== order.current) {
      for (const [id, el] of els.current) {
        const before = rects.current.get(id)
        if (!before) continue
        const dy = before.top - el.getBoundingClientRect().top
        if (dy) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.2,0,0,1)' })
      }
    }
    order.current = next
    rects.current = new Map([...els.current].map(([id, el]) => [id, el.getBoundingClientRect()]))
  })

  return (
    <aside
      className="glass-rail fixed left-0 z-20 flex flex-col"
      style={{
        top: 'var(--bar-h)',
        bottom: 'var(--timeline-h)',
        width: 'var(--rail-l)',
        borderRadius: 0,
        borderLeft: 0,
        borderTop: 0,
        borderBottom: 0,
      }}
    >
      <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--rule-soft)' }}>
        <h2 className="t-label" style={{ color: 'var(--graticule)' }}>
          FLEET
        </h2>
      </div>
      <div className="no-scrollbar flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="t-body px-4 py-4" style={{ color: 'var(--muted)' }}>
            No drones assigned to this operator.
          </p>
        ) : (
          rows.map((row) => (
            <Strip
              key={row.id}
              row={row}
              selected={row.id === selectedDroneId}
              alert={alerts.get(row.id) ?? null}
              onSelect={() => selectDrone(row.id === selectedDroneId ? null : row.id)}
              innerRef={(el) => {
                if (el) els.current.set(row.id, el)
                else els.current.delete(row.id)
              }}
            />
          ))
        )}
      </div>
      <ScenarioControls />
    </aside>
  )
}
