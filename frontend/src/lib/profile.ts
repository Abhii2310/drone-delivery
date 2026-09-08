import type { RoutePath, Zone } from './city'

const M_PER_DEG_LAT = 110900
const M_PER_DEG_LNG = 110900 * Math.cos((12.9716 * Math.PI) / 180)

export type Band = { zoneId: string; kind: string; ceiling: number; floor: number; fromM: number; toM: number }
export type Profile = {
  totalM: number
  points: { d: number; alt: number }[]
  bands: Band[]
}

const metres = (a: [number, number], b: [number, number]): number =>
  Math.hypot((b[0] - a[0]) * M_PER_DEG_LNG, (b[1] - a[1]) * M_PER_DEG_LAT)

export function pointInRing(pt: [number, number], ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Distance along the route to the point nearest `at`, plus the route's total length. */
export function progressAlong(route: RoutePath, at: [number, number]): { along: number; total: number } {
  let best = Infinity
  let along = 0
  let walked = 0
  for (let i = 0; i < route.path.length - 1; i++) {
    const a: [number, number] = [route.path[i][0], route.path[i][1]]
    const b: [number, number] = [route.path[i + 1][0], route.path[i + 1][1]]
    const ax = 0
    const ay = 0
    const bx = (b[0] - a[0]) * M_PER_DEG_LNG
    const by = (b[1] - a[1]) * M_PER_DEG_LAT
    const px = (at[0] - a[0]) * M_PER_DEG_LNG
    const py = (at[1] - a[1]) * M_PER_DEG_LAT
    const segSq = (bx - ax) ** 2 + (by - ay) ** 2
    const t = segSq === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / segSq))
    const perp = Math.hypot(px - bx * t, py - by * t)
    const seg = Math.sqrt(segSq)
    if (perp < best) {
      best = perp
      along = walked + seg * t
    }
    walked += seg
  }
  return { along, total: walked }
}

const SAMPLES = 120

/** Cross-section of the flight path with the zone ceilings that apply along it. */
export function buildProfile(route: RoutePath, zones: Zone[]): Profile {
  const legs: { from: [number, number]; to: [number, number]; alt0: number; alt1: number; len: number }[] = []
  let total = 0
  for (let i = 0; i < route.path.length - 1; i++) {
    const from: [number, number] = [route.path[i][0], route.path[i][1]]
    const to: [number, number] = [route.path[i + 1][0], route.path[i + 1][1]]
    const len = metres(from, to)
    legs.push({ from, to, alt0: route.path[i][2], alt1: route.path[i + 1][2], len })
    total += len
  }
  if (total === 0) return { totalM: 0, points: [], bands: [] }

  const points: { d: number; alt: number }[] = []
  const inside = new Map<string, { zone: Zone; from: number | null; last: number }[]>()
  const bands: Band[] = []

  for (let s = 0; s <= SAMPLES; s++) {
    const d = (total * s) / SAMPLES
    let walked = 0
    let at: [number, number] = legs[0].from
    let alt = legs[0].alt0
    for (const leg of legs) {
      if (d <= walked + leg.len || leg === legs[legs.length - 1]) {
        const t = leg.len === 0 ? 0 : Math.max(0, Math.min(1, (d - walked) / leg.len))
        at = [leg.from[0] + (leg.to[0] - leg.from[0]) * t, leg.from[1] + (leg.to[1] - leg.from[1]) * t]
        alt = leg.alt0 + (leg.alt1 - leg.alt0) * t
        break
      }
      walked += leg.len
    }
    points.push({ d, alt })

    for (const zone of zones) {
      const within = pointInRing(at, zone.ring)
      const runs = inside.get(zone.id) ?? []
      const open = runs.find((r) => r.from !== null && r.last === s - 1)
      if (within && !open) runs.push({ zone, from: d, last: s })
      else if (within && open) open.last = s
      inside.set(zone.id, runs)
      if (!within && open) {
        bands.push({ zoneId: zone.id, kind: zone.kind, ceiling: zone.alt_max, floor: zone.alt_min, fromM: open.from as number, toM: d })
        open.from = null
      }
    }
  }
  for (const runs of inside.values()) {
    for (const r of runs) {
      if (r.from !== null) bands.push({ zoneId: r.zone.id, kind: r.zone.kind, ceiling: r.zone.alt_max, floor: r.zone.alt_min, fromM: r.from, toM: total })
    }
  }
  return { totalM: total, points, bands }
}

/** The ceiling in force at a distance along the route, and the next one ahead. */
export function ceilingAt(profile: Profile, d: number): Band | null {
  return profile.bands.find((b) => d >= b.fromM && d <= b.toM) ?? null
}

export function nextCeiling(profile: Profile, d: number): { band: Band; inM: number } | null {
  const ahead = profile.bands.filter((b) => b.fromM > d).sort((a, b) => a.fromM - b.fromM)[0]
  return ahead ? { band: ahead, inM: Math.round(ahead.fromM - d) } : null
}
