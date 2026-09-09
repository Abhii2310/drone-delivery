// SKYGRID landing simulation. Self-contained: seeded, procedural, no backend, no tiles,
// no paid API. Everything the page shows is computed here and advanced by one clock.

export type Status = 'IDLE' | 'TAKEOFF' | 'IN_FLIGHT' | 'DELIVERING' | 'RETURNING' | 'EMERGENCY' | 'MAINTENANCE' | 'OFFLINE'
export type MissionKind = 'MEDICAL' | 'COMMERCE' | 'INDUSTRIAL' | 'RESCUE' | 'EMERGENCY'
export type Priority = 'ROUTINE' | 'ELEVATED' | 'CRITICAL'
export type Role = 'GOVERNMENT_ADMIN' | 'FLEET_OPERATOR' | 'HUB_ENGINEER' | 'CUSTOMER'
export type IncidentKind =
  | 'GPS_FAILURE' | 'COMMUNICATION_LOSS' | 'LOW_BATTERY' | 'ALTITUDE_VIOLATION'
  | 'WEATHER' | 'COLLISION_RISK' | 'ZONE_CLOSURE' | 'LANDING_ZONE_UNAVAILABLE'

export type Drone = {
  id: string
  lat: number
  lng: number
  alt: number
  speed: number
  battery: number
  heading: number
  status: Status
  mission: MissionKind
  priority: Priority
  destination: string
  homeHub: string
  operator: string
  corridor: number
  t: number
  dir: 1 | -1
  targetAlt: number
  flagged: boolean
}

export type Incident = {
  id: string
  kind: IncidentKind
  severity: 'ADVISORY' | 'HIGH' | 'CRITICAL'
  droneId: string
  lat: number
  lng: number
  at: number
  recommendedAction: string
  affectedMissions: number
  detail: [string, string][]
}

export type Site = { id: string; kind: 'HUB' | 'SKYPORT' | 'HOSPITAL' | 'GROUND'; x: number; y: number; label: string; status: 'AVAILABLE' | 'AT CAPACITY' | 'CONDITIONAL' }
export type Zone = { id: string; label: string; kind: 'RESTRICTED' | 'QUIET' | 'EMERGENCY'; ring: [number, number][]; ceiling: number }
export type Corridor = { id: number; label: string; alt: number; kind: 'DELIVERY' | 'EMERGENCY' | 'INDUSTRIAL'; pts: [number, number][] }
export type Building = { ring: [number, number][]; ll: [number, number][]; h: number; lit: boolean; x: number; y: number }
export type Car = { seg: number; t: number; dir: 1 | -1; speed: number }

// ── geography ────────────────────────────────────────────────────────────────
// A local metre grid pinned to Bengaluru. Only the serialiser knows about degrees.
const ORIGIN: [number, number] = [77.5946, 12.9716]
const M_LAT = 110540
const M_LNG = 111320 * Math.cos((ORIGIN[1] * Math.PI) / 180)
export const toLL = (x: number, y: number): [number, number] => [ORIGIN[0] + x / M_LNG, ORIGIN[1] + y / M_LAT]
export const CITY_ORIGIN = ORIGIN

const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const EXTENT = 3300
const BLOCK = 300

// ── city ─────────────────────────────────────────────────────────────────────
function buildCity() {
  const r = rng(1337)
  const buildings: Building[] = []
  const roads: [number, number][][] = []
  const lights: { x: number; y: number; h: number; warm: boolean }[] = []

  const lines: number[] = []
  for (let v = -EXTENT; v <= EXTENT; v += BLOCK) lines.push(v)
  for (const v of lines) {
    roads.push([[-EXTENT, v], [EXTENT, v]])
    roads.push([[v, -EXTENT], [v, EXTENT]])
  }

  for (let i = 0; i < lines.length - 1; i++) {
    for (let j = 0; j < lines.length - 1; j++) {
      const x0 = lines[i] + 26
      const y0 = lines[j] + 26
      const x1 = lines[i + 1] - 26
      const y1 = lines[j + 1] - 26
      const cx = (x0 + x1) / 2
      const cy = (y0 + y1) / 2
      const d = Math.hypot(cx, cy)
      const edge = Math.max(Math.abs(cx), Math.abs(cy)) / EXTENT
      if (r() < 0.09 + Math.max(0, edge - 0.62) * 1.6) continue // parks and voids, thinning toward the edge
      // two to four parcels per block so the skyline is not a single slab
      const parcels = 2 + Math.floor(r() * 3)
      for (let p = 0; p < parcels; p++) {
        const w = (x1 - x0) * (0.34 + r() * 0.34)
        const dp = (y1 - y0) * (0.34 + r() * 0.34)
        const px = x0 + r() * (x1 - x0 - w)
        const py = y0 + r() * (y1 - y0 - dp)
        const core = Math.max(0, 1 - d / (EXTENT * 1.05))
        const h = 16 + core * core * 150 * (0.4 + r()) + r() * 34
        const ring: [number, number][] = [[px, py], [px + w, py], [px + w, py + dp], [px, py + dp]]
        buildings.push({
          ring,
          ll: ring.map(([bx, by]) => toLL(bx, by)),
          h,
          lit: r() < 0.42,
          x: px + w / 2,
          y: py + dp / 2,
        })
        if (h > 95 && r() < 0.62) lights.push({ x: px + w / 2, y: py + dp / 2, h: h + 3, warm: r() < 0.25 })
      }
    }
  }

  const cars: Car[] = []
  for (let i = 0; i < 260; i++) {
    cars.push({ seg: Math.floor(r() * roads.length), t: r(), dir: r() < 0.5 ? 1 : -1, speed: 0.006 + r() * 0.012 })
  }
  return { buildings, roads, lights, cars }
}

export const CITY = buildCity()

export const SITES: Site[] = [
  { id: 'HUB-CTR', kind: 'HUB', x: 40, y: 120, label: 'CENTRAL HUB', status: 'AVAILABLE' },
  { id: 'HUB-MED', kind: 'HOSPITAL', x: -1180, y: 760, label: 'MEDICAL HUB', status: 'AVAILABLE' },
  { id: 'HUB-IND', kind: 'HUB', x: 1420, y: -1020, label: 'INDUSTRIAL HUB', status: 'AVAILABLE' },
  { id: 'HUB-NTH', kind: 'HUB', x: -420, y: 1720, label: 'NORTH HUB', status: 'AVAILABLE' },
  { id: 'HUB-STH', kind: 'HUB', x: 640, y: -1680, label: 'SOUTH HUB', status: 'CONDITIONAL' },
  { id: 'SKYPORT 04', kind: 'SKYPORT', x: -1740, y: -540, label: 'SKYPORT 04', status: 'AVAILABLE' },
  { id: 'SKYPORT 09', kind: 'SKYPORT', x: 980, y: 980, label: 'SKYPORT 09', status: 'AT CAPACITY' },
  { id: 'SKYPORT 12', kind: 'SKYPORT', x: -260, y: -880, label: 'SKYPORT 12', status: 'AVAILABLE' },
  { id: 'ST MARY GROUND', kind: 'GROUND', x: 1700, y: 420, label: 'ST MARY GROUND', status: 'CONDITIONAL' },
  { id: 'CIVIC GROUND', kind: 'GROUND', x: -900, y: -1600, label: 'CIVIC GROUND', status: 'AVAILABLE' },
  { id: 'SKYPORT 02', kind: 'SKYPORT', x: 1900, y: 1560, label: 'SKYPORT 02', status: 'AVAILABLE' },
  { id: 'FOUNDRY PAD', kind: 'GROUND', x: 1980, y: -320, label: 'FOUNDRY PAD', status: 'AVAILABLE' },
]

const siteAt = (id: string) => SITES.find((s) => s.id === id)!

export const ZONES: Zone[] = [
  {
    id: 'ZONE-A', label: 'RESTRICTED · STATE COMPLEX', kind: 'RESTRICTED', ceiling: 200,
    ring: [[-820, -260], [-300, -300], [-240, 220], [-760, 280]],
  },
  {
    id: 'ZONE-B', label: 'QUIET HOURS · RESIDENTIAL', kind: 'QUIET', ceiling: 90,
    ring: [[520, 560], [1180, 520], [1240, 1120], [560, 1160]],
  },
  {
    id: 'ZONE-C', label: 'FLOOD RESPONSE · SOUTH BENGALURU', kind: 'EMERGENCY', ceiling: 260,
    ring: [[-260, -2100], [1180, -2040], [1240, -1180], [-320, -1240]],
  },
]

const corridor = (id: number, label: string, alt: number, kind: Corridor['kind'], a: string, b: string, bendX: number, bendY: number): Corridor => {
  const s = siteAt(a)
  const e = siteAt(b)
  return { id, label, alt, kind, pts: [[s.x, s.y], [bendX, bendY], [e.x, e.y]] }
}

export const CORRIDORS: Corridor[] = [
  corridor(0, 'C1 · NORTH DELIVERY', 120, 'DELIVERY', 'HUB-NTH', 'HUB-CTR', -380, 820),
  corridor(1, 'C2 · MEDICAL PRIORITY', 160, 'EMERGENCY', 'HUB-MED', 'HUB-CTR', -560, 380),
  corridor(2, 'C3 · INDUSTRIAL EAST', 100, 'INDUSTRIAL', 'HUB-IND', 'HUB-CTR', 900, -420),
  corridor(3, 'C4 · SOUTH DELIVERY', 120, 'DELIVERY', 'HUB-STH', 'HUB-CTR', 480, -720),
  corridor(4, 'C5 · WEST CROSS', 140, 'DELIVERY', 'SKYPORT 04', 'SKYPORT 09', -300, 260),
  corridor(5, 'C6 · SOUTH CROSS', 100, 'DELIVERY', 'SKYPORT 12', 'HUB-IND', 620, -700),
  corridor(6, 'C7 · RING NORTH', 140, 'DELIVERY', 'HUB-MED', 'HUB-NTH', -1080, 1420),
  corridor(7, 'C8 · RING EAST', 160, 'EMERGENCY', 'SKYPORT 09', 'HUB-IND', 1360, 180),
]

const corridorLength = (c: Corridor) => {
  let n = 0
  for (let i = 1; i < c.pts.length; i++) n += Math.hypot(c.pts[i][0] - c.pts[i - 1][0], c.pts[i][1] - c.pts[i - 1][1])
  return n
}
const CORRIDOR_LEN = CORRIDORS.map(corridorLength)

/** Position and heading at normalised distance t along a corridor. */
function along(c: Corridor, t: number): { x: number; y: number; hdg: number } {
  const total = CORRIDOR_LEN[c.id]
  let want = Math.max(0, Math.min(1, t)) * total
  for (let i = 1; i < c.pts.length; i++) {
    const [ax, ay] = c.pts[i - 1]
    const [bx, by] = c.pts[i]
    const seg = Math.hypot(bx - ax, by - ay)
    if (want <= seg || i === c.pts.length - 1) {
      const f = seg === 0 ? 0 : want / seg
      return { x: ax + (bx - ax) * f, y: ay + (by - ay) * f, hdg: (Math.atan2(bx - ax, by - ay) * 180) / Math.PI }
    }
    want -= seg
  }
  const last = c.pts[c.pts.length - 1]
  return { x: last[0], y: last[1], hdg: 0 }
}

// ── fleet ────────────────────────────────────────────────────────────────────
const MISSIONS: MissionKind[] = ['MEDICAL', 'COMMERCE', 'COMMERCE', 'INDUSTRIAL', 'COMMERCE', 'MEDICAL', 'INDUSTRIAL', 'COMMERCE']
const OPERATORS = ['MEDLIFT OPS', 'SWIFTCARGO', 'CIVIC AIR', 'NORTHFIELD']

function buildFleet(): Drone[] {
  const r = rng(90210)
  const fleet: Drone[] = []
  for (let i = 0; i < 24; i++) {
    const c = CORRIDORS[i % CORRIDORS.length]
    const mission = MISSIONS[Math.floor(r() * MISSIONS.length)]
    const dir: 1 | -1 = r() < 0.5 ? 1 : -1
    const t = r()
    const p = along(c, t)
    fleet.push({
      id: `D-${(101 + i).toString()}`,
      lat: 0, lng: 0,
      alt: c.alt + (r() - 0.5) * 12,
      targetAlt: c.alt,
      speed: 34 + r() * 22,
      battery: 42 + r() * 55,
      heading: p.hdg,
      status: 'IN_FLIGHT',
      mission,
      priority: mission === 'MEDICAL' ? 'ELEVATED' : 'ROUTINE',
      destination: SITES[Math.floor(r() * SITES.length)].id,
      homeHub: c.pts === undefined ? 'HUB-CTR' : ['HUB-NTH', 'HUB-MED', 'HUB-IND', 'HUB-STH', 'SKYPORT 04', 'SKYPORT 12', 'HUB-MED', 'SKYPORT 09'][i % 8],
      operator: OPERATORS[Math.floor(r() * OPERATORS.length)],
      corridor: c.id,
      t,
      dir,
      flagged: false,
    })
  }
  return fleet
}

export const HERO_DRONE = 'D-104'
const RESCUE_IDS = ['D-117', 'D-122', 'D-113']

// ── world state ──────────────────────────────────────────────────────────────
export type World = {
  clock: number
  drones: Drone[]
  incident: Incident | null
  emergency: boolean
  emergencyT: number
  conflict: { a: string; b: string; seconds: number; resolved: boolean; sep: number } | null
  assignments: { drone: string; payload: string; eta: number }[]
  role: Role
  networkHealth: number
  divertTo: string | null
  audit: { at: number; actor: string; action: string }[]
}

export const world: World = {
  clock: 0,
  drones: buildFleet(),
  incident: null,
  emergency: false,
  emergencyT: 0,
  conflict: null,
  assignments: [],
  role: 'GOVERNMENT_ADMIN',
  networkHealth: 98.7,
  divertTo: null,
  audit: [],
}

export function record(actor: string, action: string): void {
  world.audit = [{ at: world.clock, actor, action }, ...world.audit].slice(0, 8)
}

/** Diverts the hero aircraft to an approved pad; null clears the route. */
export function divert(siteId: string | null): void {
  world.divertTo = siteId
  const d = droneById(HERO_DRONE)
  if (!d) return
  d.flagged = siteId !== null
  d.status = siteId ? 'EMERGENCY' : 'IN_FLIGHT'
}

export const fmtClock = (s: number) => {
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`
}

export const droneById = (id: string) => world.drones.find((d) => d.id === id)

const INCIDENT_LIBRARY: { kind: IncidentKind; severity: Incident['severity']; action: string; detail: [string, string][] }[] = [
  { kind: 'GPS_FAILURE', severity: 'HIGH', action: 'REROUTE TO APPROVED LANDING ZONE', detail: [['POSITION CONFIDENCE', '31%'], ['NEAREST SAFE LANDING', '420 M'], ['DEAD RECKONING', 'ACTIVE']] },
  { kind: 'COMMUNICATION_LOSS', severity: 'HIGH', action: 'HOLD LAST CORRIDOR, AWAIT LINK', detail: [['LAST CONTACT', '00:41 AGO'], ['LINK MARGIN', '-8 dB'], ['FALLBACK', 'AUTONOMOUS RTB']] },
  { kind: 'LOW_BATTERY', severity: 'CRITICAL', action: 'DIVERT TO SKYPORT 12', detail: [['RESERVE', '24%'], ['RESERVE FLOOR', '20%'], ['NEAREST SAFE LANDING', '420 M']] },
  { kind: 'ALTITUDE_VIOLATION', severity: 'ADVISORY', action: 'DESCEND TO CORRIDOR CEILING', detail: [['MEASURED', '186 M'], ['ZONE CEILING', '160 M'], ['EXCEEDANCE', '26 M']] },
  { kind: 'WEATHER', severity: 'ADVISORY', action: 'REDUCE GROUND SPEED, EXTEND ETA', detail: [['HEADWIND', '11.4 M/S'], ['VISIBILITY', '4.1 KM'], ['MISSIONS AFFECTED', '6']] },
  { kind: 'COLLISION_RISK', severity: 'CRITICAL', action: 'VERTICAL SEPARATION, LOWER PRIORITY YIELDS', detail: [['PREDICTED SEPARATION', '8.3 M'], ['MINIMUM', '15 M'], ['TIME TO CPA', '17 S']] },
  { kind: 'ZONE_CLOSURE', severity: 'HIGH', action: 'RECOMPUTE 12 AFFECTED ROUTES', detail: [['ZONE', 'ZONE-C'], ['MISSIONS IN ZONE', '12'], ['CAN REROUTE', '8']] },
  { kind: 'LANDING_ZONE_UNAVAILABLE', severity: 'HIGH', action: 'RANK NEXT APPROVED PAD', detail: [['SKYPORT 09', 'AT CAPACITY'], ['SECOND CHOICE', 'SKYPORT 12'], ['ADDED DISTANCE', '640 M']] },
]

let incidentCursor = 0
let incidentSeq = 0

export function nextIncident(): Incident {
  const spec = INCIDENT_LIBRARY[incidentCursor % INCIDENT_LIBRARY.length]
  incidentCursor++
  const d = droneById(HERO_DRONE) ?? world.drones[0]
  for (const x of world.drones) x.flagged = false
  d.flagged = true
  const inc: Incident = {
    id: `INC-${(++incidentSeq).toString().padStart(3, '0')}`,
    kind: spec.kind,
    severity: spec.severity,
    droneId: d.id,
    lat: d.lat,
    lng: d.lng,
    at: world.clock,
    recommendedAction: spec.action,
    affectedMissions: 2 + ((incidentCursor * 3) % 9),
    detail: spec.detail,
  }
  world.incident = inc
  return inc
}

export function clearIncident(): void {
  world.incident = null
  for (const d of world.drones) d.flagged = false
}

export function armConflict(): void {
  const a = droneById('D-104')!
  const b = droneById('D-109')!
  a.corridor = 4
  a.t = 0.34
  a.dir = 1
  a.targetAlt = 140
  b.corridor = 5
  b.t = 0.52
  b.dir = -1
  b.targetAlt = 140
  world.conflict = { a: a.id, b: b.id, seconds: 17, resolved: false, sep: 8.3 }
}

export function resolveConflict(): void {
  if (!world.conflict) return
  const a = droneById(world.conflict.a)
  if (a) a.targetAlt = 110
  world.conflict = { ...world.conflict, resolved: true, seconds: 0, sep: 31.4 }
}

const PAYLOADS = ['MEDICINE', 'WATER', 'RESCUE EQUIPMENT']

export function setEmergency(on: boolean): void {
  world.emergency = on
  world.emergencyT = 0
  if (on) {
    world.assignments = RESCUE_IDS.map((id, i) => ({ drone: id, payload: PAYLOADS[i], eta: 174 + i * 63 }))
    RESCUE_IDS.forEach((id, i) => {
      const d = droneById(id)
      if (!d) return
      d.mission = 'EMERGENCY'
      d.priority = 'CRITICAL'
      d.status = 'EMERGENCY'
      d.corridor = [3, 5, 7][i]
      d.targetAlt = 160 + i * 10
      d.dir = i === 1 ? 1 : -1
    })
    for (const d of world.drones) {
      if (!RESCUE_IDS.includes(d.id) && d.mission !== 'MEDICAL') d.priority = 'ROUTINE'
    }
  } else {
    world.assignments = []
    RESCUE_IDS.forEach((id) => {
      const d = droneById(id)
      if (!d) return
      d.mission = 'COMMERCE'
      d.priority = 'ROUTINE'
      d.status = 'IN_FLIGHT'
    })
  }
}

/** One simulation step. dt is seconds; the caller throttles, this does not. */
export function step(dt: number): void {
  world.clock += dt
  if (world.emergency) world.emergencyT = Math.min(1, world.emergencyT + dt / 1.1)
  for (const d of world.drones) {
    const c = CORRIDORS[d.corridor]
    const len = CORRIDOR_LEN[c.id]
    d.t += (d.dir * d.speed * dt) / len
    if (d.t > 1) { d.t = 1; d.dir = -1 }
    if (d.t < 0) { d.t = 0; d.dir = 1 }
    const p = along(c, d.t)
    const [lng, lat] = toLL(p.x, p.y)
    d.lng = lng
    d.lat = lat
    // shortest-angle heading so a reversal does not spin the glyph the long way round
    let delta = ((p.hdg + (d.dir === 1 ? 0 : 180) - d.heading + 540) % 360) - 180
    d.heading += delta * Math.min(1, dt * 3)
    d.alt += (d.targetAlt - d.alt) * Math.min(1, dt * 1.4)
    d.battery = Math.max(6, d.battery - dt * 0.055)
    if (d.battery < 24 && d.status === 'IN_FLIGHT') d.status = 'RETURNING'
  }
  for (const car of CITY.cars) {
    car.t += car.dir * car.speed * dt
    if (car.t > 1) { car.t = 0 }
    if (car.t < 0) { car.t = 1 }
  }
  if (world.conflict && !world.conflict.resolved) {
    world.conflict.seconds = Math.max(0, world.conflict.seconds - dt)
  }
  world.networkHealth = 98.7 - (world.incident ? 1.4 : 0) - (world.emergency ? 2.2 : 0)
}

// ── role based access ────────────────────────────────────────────────────────
export const ROLE_SCOPE: Record<Role, { label: string; scope: string; sees: string[]; hidden: string[] }> = {
  GOVERNMENT_ADMIN: {
    label: 'GOVERNMENT', scope: 'CITY-WIDE',
    sees: ['ALL AIRCRAFT', 'ALL OPERATORS', 'ALL INCIDENTS', 'ZONE CONTROL', 'EMERGENCY ACTIVATION'],
    hidden: ['OPERATOR COMMERCIAL TERMS', 'CUSTOMER IDENTITY'],
  },
  FLEET_OPERATOR: {
    label: 'OPERATOR', scope: 'OWN FLEET',
    sees: ['OWN AIRCRAFT', 'OWN MISSIONS', 'OWN INCIDENTS', 'ROUTE REQUESTS'],
    hidden: ['OTHER OPERATORS', 'ZONE CONTROL', 'EMERGENCY ACTIVATION'],
  },
  HUB_ENGINEER: {
    label: 'ENGINEER', scope: 'ASSIGNED HUB',
    sees: ['HUB AIRCRAFT', 'PAD OCCUPANCY', 'MAINTENANCE QUEUE', 'LANDING REQUESTS'],
    hidden: ['CITY AIRSPACE', 'OTHER HUBS', 'MISSION PRICING'],
  },
  CUSTOMER: {
    label: 'CUSTOMER', scope: 'OWN MISSION',
    sees: ['MISSION STATUS', 'ETA', 'PROOF OF DELIVERY'],
    hidden: ['AIRCRAFT TELEMETRY', 'FLEET POSITIONS', 'INCIDENTS', 'AIRSPACE'],
  },
}

export function visibleDrones(role: Role): Drone[] {
  switch (role) {
    case 'GOVERNMENT_ADMIN': return world.drones
    case 'FLEET_OPERATOR': return world.drones.filter((d) => d.operator === 'MEDLIFT OPS')
    case 'HUB_ENGINEER': return world.drones.filter((d) => d.homeHub === 'HUB-MED')
    case 'CUSTOMER': return world.drones.filter((d) => d.id === HERO_DRONE)
  }
}
