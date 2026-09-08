import type { HelloFrame } from './ws'

export type ZoneKind = 'NO_FLY' | 'HOSPITAL' | 'SCHOOL' | 'RESIDENTIAL_QUIET' | 'TEMP_RESTRICTED' | 'EMERGENCY'
export type LngLat = [number, number]

export type Zone = { id: string; name: string; kind: ZoneKind; ring: LngLat[]; alt_min: number; alt_max: number }
export type Corridor = { id: string; name: string; path: [number, number, number][]; alt_min: number; alt_max: number }
export type Marker = { id: string; name: string; kind: string; at: LngLat }
export type Pad = { id: string; name: string; permission: string; at: LngLat }
export type RoutePath = { id: string; path: [number, number, number][] }

export type City = {
  zones: Zone[]
  corridors: Corridor[]
  hubs: Marker[]
  destinations: Marker[]
  pads: Pad[]
}

// the wire carries [lat, lng]; deck.gl wants [lng, lat], so every swap happens here
const swap = (p: number[]): LngLat => [p[1], p[0]]

let city: City | null = null
const routes = new Map<string, RoutePath>()
const droneRoutes = new Map<string, { active: string | null; ghost: string | null }>()
let revision = 0

const toPath = (path: number[][]): [number, number, number][] =>
  path.map((p): [number, number, number] => [p[1], p[0], p[2]])

const hidden = new Set<string>(['SCHOOL'])

type RawCity = {
  zones: { id: string; name: string; kind: ZoneKind; polygon: number[][]; alt_min: number; alt_max: number }[]
  corridors: { id: string; name: string; polyline: number[][]; alt_min: number; alt_max: number }[]
  hubs: { id: string; kind: string; ll: number[] }[]
  destinations: { id: string; name: string; kind: string; ll: number[] }[]
  landing_zones: { id: string; name: string; permission: string; ll: number[] }[]
}

export function ingestCity(frame: HelloFrame): void {
  const raw = frame.city as RawCity
  city = {
    zones: raw.zones.map((z) => ({
      id: z.id,
      name: z.name,
      kind: z.kind,
      ring: z.polygon.map(swap),
      alt_min: z.alt_min,
      alt_max: z.alt_max,
    })),
    corridors: raw.corridors.map((c) => {
      const band = (c.alt_min + c.alt_max) / 2
      return {
        id: c.id,
        name: c.name,
        path: c.polyline.map((p): [number, number, number] => [p[1], p[0], band]),
        alt_min: c.alt_min,
        alt_max: c.alt_max,
      }
    }),
    hubs: raw.hubs.map((h) => ({ id: h.id, name: h.id, kind: h.kind, at: swap(h.ll) })),
    destinations: raw.destinations.map((d) => ({ id: d.id, name: d.name, kind: d.kind, at: swap(d.ll) })),
    pads: raw.landing_zones.map((p) => ({ id: p.id, name: p.name, permission: p.permission, at: swap(p.ll) })),
  }
  routes.clear()
  droneRoutes.clear()
  for (const r of frame.routes as { id: string; path: number[][] }[]) routes.set(r.id, { id: r.id, path: toPath(r.path) })
  for (const d of frame.drones) droneRoutes.set(d.id, { active: d.route_id ?? null, ghost: d.previous_route_id ?? null })
  revision++
}

export const getCity = (): City | null => city
export const getRevision = (): number => revision
const collect = (pick: 'active' | 'ghost'): RoutePath[] => {
  const ids = new Set<string>()
  for (const link of droneRoutes.values()) if (link[pick]) ids.add(link[pick] as string)
  return [...ids].map((id) => routes.get(id)).filter((r): r is RoutePath => r !== undefined)
}

export const getActiveRoutes = (): RoutePath[] => collect('active')
export const getGhostRoutes = (): RoutePath[] => collect('ghost')

export function ingestDroneRoute(drone: { id: string; route_id: string | null; previous_route_id: string | null }, route?: { id: string; path: number[][] }): void {
  if (route) routes.set(route.id, { id: route.id, path: toPath(route.path) })
  droneRoutes.set(drone.id, { active: drone.route_id, ghost: drone.previous_route_id })
  revision++
}
export const visibleZones = (): Zone[] => (city ? city.zones.filter((z) => !hidden.has(z.kind) && !hidden.has(z.id)) : [])

export function bumpRevision(): void {
  revision++
}

export function setZoneVisible(kindOrId: string, visible: boolean): void {
  if (visible) hidden.delete(kindOrId)
  else hidden.add(kindOrId)
  revision++
}
