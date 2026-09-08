import type { HelloFrame, TickFrame, TickRow } from './ws'

export type MissionRow = [id: string, state: string, eta_s: number | null]

export type DroneView = {
  id: string
  lng: number
  lat: number
  alt: number
  heading: number
  speed: number
  battery: number
  status: number
}

const RENDER_DELAY_S = 0.5
const HEADING_EASE_K = 4.5

type Frame = { clock: number; rows: TickRow[]; receivedAt: number }

let prev: Frame | null = null
let curr: Frame | null = null
let lastCallMs = 0
const easedHeading = new Map<string, number>()

let missionRows: MissionRow[] = []
export const getMissionRows = (): MissionRow[] => missionRows

export function ingestTick(frame: TickFrame): void {
  if (curr && frame.clock <= curr.clock) return // duplicate or out-of-order delivery
  missionRows = frame.m ?? []
  const next: Frame = { clock: frame.clock, rows: frame.d, receivedAt: performance.now() }
  prev = curr
  curr = next
}

export function ingestHello(frame: HelloFrame): void {
  const rows = frame.drones.map(
    (d): TickRow => [d.id, d.lng, d.lat, d.alt, d.heading, d.speed, d.battery, 0],
  )
  const seed: Frame = { clock: frame.clock, rows, receivedAt: performance.now() }
  prev = seed
  curr = seed
  easedHeading.clear()
}

export function reset(): void {
  prev = null
  curr = null
  easedHeading.clear()
}

export function hasData(): boolean {
  return curr !== null
}

export function debug(nowMs: number) {
  if (!curr) return { curr: null }
  const est = curr.clock + (nowMs - curr.receivedAt) / 1000
  const span = prev ? curr.clock - prev.clock : 0
  return {
    hasPrev: prev !== null,
    prevClock: prev?.clock ?? null,
    currClock: curr.clock,
    span,
    ageMs: nowMs - curr.receivedAt,
    renderClock: est - RENDER_DELAY_S,
    t: prev && span > 1e-6 ? Math.max(0, Math.min(1, (est - RENDER_DELAY_S - prev.clock) / span)) : 1,
    prevRows: prev?.rows.length ?? 0,
    currRows: curr.rows.length,
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function easeHeading(id: string, target: number, dt: number): number {
  const current = easedHeading.get(id)
  if (current === undefined || dt <= 0) {
    easedHeading.set(id, target)
    return target
  }
  const delta = ((target - current + 540) % 360) - 180
  const next = (current + delta * (1 - Math.exp(-HEADING_EASE_K * dt)) + 360) % 360
  easedHeading.set(id, next)
  return next
}

export function getInterpolated(nowMs: number): DroneView[] {
  if (!curr) return []
  const dt = lastCallMs === 0 ? 0 : Math.min(0.25, (nowMs - lastCallMs) / 1000)
  lastCallMs = nowMs

  const estServerClock = curr.clock + (nowMs - curr.receivedAt) / 1000
  const renderClock = estServerClock - RENDER_DELAY_S
  const span = prev ? curr.clock - prev.clock : 0
  const t = prev && span > 1e-6 ? Math.max(0, Math.min(1, (renderClock - prev.clock) / span)) : 1
  const from = prev ?? curr

  const byId = new Map(from.rows.map((r) => [r[0], r]))
  return curr.rows.map((row) => {
    const a = byId.get(row[0]) ?? row
    const targetHeading = a[4] + (((row[4] - a[4] + 540) % 360) - 180) * t
    return {
      id: row[0],
      lng: lerp(a[1], row[1], t),
      lat: lerp(a[2], row[2], t),
      alt: lerp(a[3], row[3], t),
      heading: easeHeading(row[0], (targetHeading + 360) % 360, dt),
      speed: row[5],
      battery: row[6],
      status: row[7],
    }
  })
}
