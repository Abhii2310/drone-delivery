import { useSyncExternalStore } from 'react'
import { getInterpolated } from './telemetry'
import type { HelloFrame } from './ws'

export const STATUS_NAMES = ['IDLE', 'CHARGING', 'MAINTENANCE', 'ENROUTE', 'HOLDING', 'DIVERTING', 'LANDING', 'LANDED', 'LOST'] as const
export type StatusName = (typeof STATUS_NAMES)[number]
export type Priority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW'

export type DroneMeta = { id: string; operator_id: string; priority: Priority; mission_id: string | null; package_id: string | null; home_hub_id: string; payload_kg: number }
export type FleetRow = { id: string; alt: number; battery: number; speed: number; heading: number; status: StatusName; meta: DroneMeta }

const FEED_HZ = 4

const meta = new Map<string, DroneMeta>()
let snapshot: FleetRow[] = []
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

export function ingestFleetMeta(frame: HelloFrame): void {
  meta.clear()
  for (const d of frame.drones as DroneMeta[]) meta.set(d.id, d)
  ;(window as unknown as { __fleetMeta?: Map<string, DroneMeta> }).__fleetMeta = meta
}

function tick(): void {
  const views = getInterpolated(performance.now())
  snapshot = views.map((v) => ({
    id: v.id,
    alt: v.alt,
    battery: v.battery,
    speed: v.speed,
    heading: v.heading,
    status: STATUS_NAMES[v.status] ?? 'IDLE',
    meta: meta.get(v.id) ?? { id: v.id, operator_id: '', priority: 'NORMAL', mission_id: null, package_id: null, home_hub_id: '', payload_kg: 0 },
  }))
  for (const l of listeners) l()
}

// one shared 4Hz slice of the telemetry buffer; the rAF loop stays at 60fps and untouched
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!timer) timer = setInterval(tick, 1000 / FEED_HZ)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

export const useFleet = (): FleetRow[] => useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
