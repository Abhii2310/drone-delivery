import { Deck, MapView, AmbientLight, DirectionalLight, LightingEffect } from '@deck.gl/core'
import type { Layer, PickingInfo } from '@deck.gl/core'
import { ArcLayer, IconLayer, LineLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { TripsLayer } from '@deck.gl/geo-layers'
import {
  CITY, CORRIDORS, SITES, ZONES, HERO_DRONE, toLL, world, step, droneById,
  type Building, type Car, type Drone, type Site, type Zone, type Corridor, type Surface,
} from './sim'

export type SceneMode =
  | 'HERO' | 'STREET' | 'ROOFTOP' | 'CORRIDOR' | 'OPS' | 'DRONE'
  | 'CONFLICT' | 'INCIDENT' | 'EMERGENCY' | 'GOV' | 'LANDING' | 'NETWORK' | 'FINALE'

type Cam = { longitude: number; latitude: number; zoom: number; pitch: number; bearing: number }

const C = (x: number, y: number, zoom: number, pitch: number, bearing: number): Cam => {
  const [longitude, latitude] = toLL(x, y)
  return { longitude, latitude, zoom, pitch, bearing }
}

// One keyframe per beat of the story. The director eases between them; nothing cuts.
const KEYFRAMES: Record<SceneMode, Cam> = {
  HERO: C(160, -120, 15.35, 64, 22),
  STREET: C(60, 40, 17.1, 79, 48),
  ROOFTOP: C(120, 120, 16.1, 69, 62),
  CORRIDOR: C(20, 220, 15.35, 60, 78),
  OPS: C(60, 60, 15.05, 57, 20),
  DRONE: C(0, 0, 17.3, 84, 0),
  CONFLICT: C(-160, 260, 15.8, 63, 132),
  INCIDENT: C(0, 0, 16.0, 67, 200),
  EMERGENCY: C(420, -1180, 14.15, 56, 8),
  GOV: C(80, -120, 13.95, 40, 0),
  LANDING: C(-260, -880, 15.5, 63, 300),
  NETWORK: C(60, -80, 13.55, 48, 0),
  FINALE: C(200, 60, 15.6, 75, 140),
}

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
]
const CYAN = rgb('#35D6F0')
const AMBER = rgb('#E8A93C')
const RED = rgb('#E0452F')
const WHITE = rgb('#E8EEF6')
const DIM = rgb('#7E8B9C')

const MISSION_COLOR: Record<string, [number, number, number]> = {
  MEDICAL: [86, 214, 236], COMMERCE: [126, 150, 176], INDUSTRIAL: [200, 168, 96],
  RESCUE: [232, 169, 60], EMERGENCY: [224, 69, 47],
}

const DRONE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><g fill="#fff">
<g fill-opacity="0.18"><circle cx="30" cy="30" r="18"/><circle cx="98" cy="30" r="18"/><circle cx="30" cy="98" r="18"/><circle cx="98" cy="98" r="18"/></g>
<g fill-opacity="0.55"><rect x="14" y="28.6" width="32" height="2.8" rx="1.4"/><rect x="82" y="28.6" width="32" height="2.8" rx="1.4"/><rect x="14" y="96.6" width="32" height="2.8" rx="1.4"/><rect x="82" y="96.6" width="32" height="2.8" rx="1.4"/></g>
<rect x="27" y="61.5" width="74" height="5" rx="2.5" transform="rotate(45 64 64)"/><rect x="27" y="61.5" width="74" height="5" rx="2.5" transform="rotate(-45 64 64)"/>
<path d="M64 31 L75 52 L73 81 Q64 89 55 81 L53 52 Z"/><ellipse cx="64" cy="58" rx="6.5" ry="9.5" fill-opacity="0.45"/><circle cx="64" cy="37" r="3.6"/>
<rect x="56.5" y="72" width="15" height="9" rx="2.5" fill-opacity="0.55"/></g></svg>`
const ICON = {
  url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(DRONE_SVG)}`,
  width: 128, height: 128, anchorX: 64, anchorY: 64, mask: true,
}

// ── director state ───────────────────────────────────────────────────────────
let deck: Deck<MapView> | null = null
let raf = 0
let last = 0
let mode: SceneMode = 'HERO'
let cam: Cam = { ...KEYFRAMES.HERO }
let target: Cam = { ...KEYFRAMES.HERO }
let drift = 0
let focus: string | null = null
let userCam = false
let intensity = 1

export const getMode = () => mode
export const getFocus = () => focus

export function setMode(next: SceneMode): void {
  if (next === mode) return
  mode = next
  userCam = false
  if (next === 'INCIDENT' || next === 'CONFLICT') focus = HERO_DRONE
  else if (!KEEP_FOCUS.has(next)) focus = null
  retarget()
}

export function setFocus(id: string | null): void {
  focus = id
  userCam = false
  retarget()
}

let firstFrameAt = 0
/** True once the scene has drawn a frame; the boot overlay waits on it. */
export const sceneReady = () => firstFrameAt > 0

/** Landing sections fade the scene in and out so text is always readable over it. */
export function setIntensity(v: number): void {
  intensity = Math.max(0, Math.min(1, v))
}

// only the operations view follows a selected aircraft; wide shots always pull back
const FOLLOW_MODES = new Set<SceneMode>(['OPS'])
const KEEP_FOCUS = new Set<SceneMode>(['OPS', 'DRONE', 'INCIDENT', 'CONFLICT', 'LANDING'])

function retarget(): void {
  const base = KEYFRAMES[mode]
  if (mode === 'DRONE' || mode === 'INCIDENT' || mode === 'CONFLICT') {
    const d = droneById(focus ?? HERO_DRONE)
    if (d) {
      target = { ...base, longitude: d.lng, latitude: d.lat, bearing: mode === 'DRONE' ? d.heading : base.bearing }
      return
    }
  }
  // selecting an aircraft in an operations view flies to it and tightens the frame
  if (focus && FOLLOW_MODES.has(mode)) {
    const d = droneById(focus)
    if (d) {
      target = { ...base, longitude: d.lng, latitude: d.lat, zoom: Math.max(base.zoom, 16.1), pitch: Math.max(base.pitch, 58) }
      return
    }
  }
  target = { ...base }
}

const shortest = (from: number, to: number) => from + (((to - from + 540) % 360) - 180)

function tween(dt: number): void {
  if (userCam) return
  if (mode === 'DRONE') {
    const d = droneById(focus ?? HERO_DRONE)
    if (d) {
      // look at a point ahead of the aircraft, which is what a nose camera actually frames
      const rad = (d.heading * Math.PI) / 180
      const ahead = 210
      const [lng, lat] = toLL(0, 0)
      const dx = Math.sin(rad) * ahead
      const dy = Math.cos(rad) * ahead
      const [alng, alat] = toLL(dx, dy)
      target = {
        longitude: d.lng + (alng - lng), latitude: d.lat + (alat - lat),
        zoom: 17.25, pitch: 84, bearing: d.heading,
      }
    }
  } else if (mode === 'INCIDENT' || mode === 'CONFLICT') {
    const d = droneById(focus ?? HERO_DRONE)
    if (d) target = { ...KEYFRAMES[mode], longitude: d.lng, latitude: d.lat }
  } else if (focus && FOLLOW_MODES.has(mode)) {
    const d = droneById(focus)
    if (d) target = { ...target, longitude: d.lng, latitude: d.lat }
  }
  const k = mode === 'DRONE' ? Math.min(1, dt * 2.6) : Math.min(1, dt * 1.25)
  cam.longitude += (target.longitude - cam.longitude) * k
  cam.latitude += (target.latitude - cam.latitude) * k
  cam.zoom += (target.zoom - cam.zoom) * k
  cam.pitch += (target.pitch - cam.pitch) * k
  cam.bearing += (shortest(cam.bearing, target.bearing) - cam.bearing) * k
  if (mode === 'HERO' || mode === 'NETWORK' || mode === 'FINALE') {
    drift += dt * (mode === 'NETWORK' ? 1.9 : 0.9)
    cam.bearing = target.bearing + drift
  }
}

// ── layers ───────────────────────────────────────────────────────────────────
const a = (c: [number, number, number], alpha: number): [number, number, number, number] =>
  [c[0], c[1], c[2], Math.round(alpha * intensity)]

const showAir = (m: SceneMode) => m !== 'HERO' && m !== 'STREET'
const showZones = (m: SceneMode) => m === 'CORRIDOR' || m === 'OPS' || m === 'EMERGENCY' || m === 'GOV' || m === 'NETWORK' || m === 'CONFLICT'

function buildLayers(now: number): Layer[] {
  const pulse = 0.5 + 0.5 * Math.sin((now / 1200) * Math.PI * 2)
  const layers: Layer[] = []

  layers.push(
    new PolygonLayer<Surface>({
      id: 'sg-surfaces',
      data: CITY.surfaces,
      getPolygon: (f) => f.ll,
      getFillColor: (f) => (f.kind === 'WATER' ? a([14, 34, 58], 255) : f.kind === 'PARK' ? a([12, 26, 24], 255) : a([11, 16, 24], 255)),
      getLineColor: (f) => (f.kind === 'WATER' ? a([32, 78, 110], 160) : f.kind === 'PARK' ? a([28, 54, 44], 120) : a([20, 28, 38], 90)),
      getLineWidth: 1,
      lineWidthUnits: 'pixels',
      stroked: true,
      filled: true,
      extruded: false,
      material: false,
      pickable: false,
    }),
    new PolygonLayer<Building>({
      id: 'sg-buildings',
      data: CITY.buildings,
      extruded: true,
      getPolygon: (b) => b.ll,
      getElevation: (b) => b.h,
      // three material families and a height ramp do the work a texture would
      getFillColor: (b) => {
        const t = Math.min(1, b.h / 190)
        const al = Math.round(255 * intensity)
        if (b.kind === 2) return [44 + t * 18, 64 + t * 26, 92 + t * 34, al]  // lit glass, cool
        if (b.kind === 1) return [30 + t * 16, 42 + t * 24, 62 + t * 34, al]  // glass
        return [24 + t * 14, 32 + t * 18, 46 + t * 26, al]                     // concrete
      },
      getLineColor: a([46, 62, 82], 90),
      getLineWidth: 1,
      lineWidthUnits: 'pixels',
      stroked: true,
      filled: true,
      material: { ambient: 0.5, diffuse: 0.65, shininess: 8, specularColor: [40, 60, 80] },
      pickable: false,
    }),
    new PathLayer<[number, number][]>({
      id: 'sg-roads',
      data: CITY.roads,
      getPath: (r) => r.map(([x, y]) => toLL(x, y)),
      getColor: a([38, 52, 70], 220),
      getWidth: 13,
      widthUnits: 'meters',
      widthMinPixels: 1,
      capRounded: false,
    }),
    new ScatterplotLayer<Car>({
      id: 'sg-traffic',
      data: CITY.cars,
      getPosition: (c) => {
        const road = CITY.roads[c.seg % CITY.roads.length]
        const x = road[0][0] + (road[1][0] - road[0][0]) * c.t
        const y = road[0][1] + (road[1][1] - road[0][1]) * c.t
        const [lng, lat] = toLL(x, y)
        return [lng, lat, 1]
      },
      getRadius: 5.5,
      radiusUnits: 'meters',
      radiusMinPixels: 0.6,
      getFillColor: (c) => (c.dir === 1 ? a([214, 206, 178], 190) : a([196, 84, 62], 170)),
      updateTriggers: { getPosition: now },
    }),
    new ScatterplotLayer<{ x: number; y: number; h: number; warm: boolean }>({
      id: 'sg-roof-lights',
      data: CITY.lights,
      getPosition: (l) => {
        const [lng, lat] = toLL(l.x, l.y)
        return [lng, lat, l.h]
      },
      getRadius: 2.4,
      radiusUnits: 'meters',
      radiusMinPixels: 1,
      getFillColor: (l) => (l.warm ? a(AMBER, 200) : a(CYAN, 150)),
    }),
  )

  if (showZones(mode)) {
    const zones = ZONES.filter((z) => z.kind !== 'EMERGENCY' || world.emergency)
    layers.push(
      new PolygonLayer<Zone>({
        id: 'sg-zones',
        data: zones,
        extruded: true,
        getPolygon: (z) => z.ring.map(([x, y]) => toLL(x, y)),
        getElevation: (z) => z.ceiling * (z.kind === 'EMERGENCY' ? world.emergencyT : 1),
        getFillColor: (z) =>
          z.kind === 'EMERGENCY' ? a(RED, 30 + pulse * 26) : z.kind === 'RESTRICTED' ? a(AMBER, 22) : a(DIM, 16),
        getLineColor: (z) => (z.kind === 'EMERGENCY' ? a(RED, 190) : z.kind === 'RESTRICTED' ? a(AMBER, 130) : a(DIM, 110)),
        getLineWidth: 2,
        lineWidthUnits: 'pixels',
        stroked: true,
        wireframe: true,
        updateTriggers: { getFillColor: pulse, getElevation: world.emergencyT },
      }),
    )
  }

  if (showAir(mode)) {
    const corridorPath = (c: Corridor) => c.pts.map(([x, y]) => [...toLL(x, y), c.alt] as [number, number, number])
    layers.push(
      new PathLayer<Corridor>({
        id: 'sg-corridors',
        data: CORRIDORS,
        getPath: corridorPath,
        getColor: (c) => (c.kind === 'EMERGENCY' ? a(AMBER, 110) : a(CYAN, 70)),
        getWidth: 2.5,
        widthUnits: 'pixels',
      }),
      // one pulse of light travelling each corridor, so the airspace reads as in use
      new TripsLayer<Corridor>({
        id: 'sg-corridor-flow',
        data: CORRIDORS,
        getPath: corridorPath,
        getTimestamps: (c) => {
          let acc = 0
          return c.pts.map((p, i) => {
            if (i > 0) acc += Math.hypot(p[0] - c.pts[i - 1][0], p[1] - c.pts[i - 1][1])
            return acc
          })
        },
        getColor: (c) => (c.kind === 'EMERGENCY' ? a(AMBER, 255) : a(CYAN, 255)),
        currentTime: (now / 1000) * 260,
        trailLength: 420,
        fadeTrail: true,
        getWidth: 4,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
        updateTriggers: { currentTime: now },
      }),
    )
    if (mode === 'CORRIDOR' || mode === 'GOV') {
      layers.push(
        new TextLayer<Corridor>({
          id: 'sg-corridor-labels',
          data: CORRIDORS,
          getPosition: (c) => [...toLL(c.pts[1][0], c.pts[1][1]), c.alt + 14] as [number, number, number],
          getText: (c) => `${c.kind} CORRIDOR · ${c.alt} M`,
          getSize: 10,
          sizeUnits: 'pixels',
          getColor: (c) => (c.kind === 'EMERGENCY' ? a(AMBER, 230) : a(CYAN, 210)),
          billboard: true,
          fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
          characterSet: 'auto',
          background: true,
          getBackgroundColor: a([4, 7, 12], 170),
          backgroundPadding: [6, 3],
        }),
      )
    }
  }

  if (mode === 'NETWORK' || mode === 'GOV') {
    const hubs = SITES.filter((x) => x.kind === 'HUB' || x.kind === 'HOSPITAL')
    const pairs: { from: Site; to: Site }[] = []
    for (let i = 0; i < hubs.length; i++) for (let j = i + 1; j < hubs.length; j++) pairs.push({ from: hubs[i], to: hubs[j] })
    layers.push(
      new ArcLayer<{ from: Site; to: Site }>({
        id: 'sg-network-arcs',
        data: pairs,
        getSourcePosition: (p) => [...toLL(p.from.x, p.from.y), 4] as [number, number, number],
        getTargetPosition: (p) => [...toLL(p.to.x, p.to.y), 4] as [number, number, number],
        getSourceColor: a(CYAN, 150),
        getTargetColor: a([90, 112, 138], 60),
        getWidth: 1.5,
        widthUnits: 'pixels',
        getHeight: 0.35,
      }),
    )
  }

  layers.push(
    new ScatterplotLayer<Site>({
      id: 'sg-sites',
      data: SITES,
      getPosition: (s) => {
        const [lng, lat] = toLL(s.x, s.y)
        return [lng, lat, 2]
      },
      getRadius: (s) => (s.kind === 'HUB' || s.kind === 'HOSPITAL' ? 46 : 34),
      radiusUnits: 'meters',
      radiusMinPixels: 3,
      getFillColor: (s) => (s.status === 'AVAILABLE' ? a(CYAN, 40) : a(AMBER, 40)),
      stroked: true,
      getLineColor: (s) => (s.status === 'AVAILABLE' ? a(CYAN, 210) : a(AMBER, 200)),
      getLineWidth: 1.5,
      lineWidthUnits: 'pixels',
    }),
  )

  if (mode === 'CORRIDOR' || mode === 'GOV' || mode === 'LANDING' || mode === 'NETWORK') {
    layers.push(
      new TextLayer<Site>({
        id: 'sg-site-labels',
        data: SITES,
        getPosition: (s) => {
          const [lng, lat] = toLL(s.x, s.y)
          return [lng, lat, 2]
        },
        getText: (s) => s.label,
        getSize: 10,
        sizeUnits: 'pixels',
        getColor: a(DIM, 230),
        getPixelOffset: [0, -16],
        billboard: true,
        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        characterSet: 'auto',
      }),
    )
  }

  const drones = world.drones
  const hidden = mode === 'DRONE' ? focus : null
  const shown = drones.filter((d) => d.id !== hidden)

  layers.push(
    new ScatterplotLayer<Drone>({
      id: 'sg-drone-shadows',
      data: shown,
      getPosition: (d) => [d.lng, d.lat, 0.5],
      getRadius: (d) => 5 + d.alt * 0.045,
      radiusUnits: 'meters',
      getFillColor: a([2, 4, 8], 120),
      updateTriggers: { getPosition: now },
    }),
    new TripsLayer<Drone>({
      id: 'sg-trails',
      data: shown.filter((d) => d.trail.length > 2),
      getPath: (d) => d.trail,
      getTimestamps: (d) => d.trail.map((_, i) => i),
      getColor: (d) => (d.flagged || d.mission === 'EMERGENCY' ? a(RED, 200) : a(MISSION_COLOR[d.mission] ?? CYAN, 170)),
      currentTime: 40,
      trailLength: 40,
      fadeTrail: true,
      getWidth: 1.6,
      widthUnits: 'pixels',
      capRounded: true,
      updateTriggers: { getPath: now, getColor: world.emergency },
    }),
    new LineLayer<Drone>({
      id: 'sg-tethers',
      data: shown,
      getSourcePosition: (d) => [d.lng, d.lat, d.alt],
      getTargetPosition: (d) => [d.lng, d.lat, 0],
      getColor: a([90, 112, 138], 70),
      getWidth: 1,
      widthUnits: 'pixels',
      updateTriggers: { getSourcePosition: now },
    }),
    new IconLayer<Drone>({
      id: 'sg-drones',
      data: shown,
      getPosition: (d) => [d.lng, d.lat, d.alt],
      getIcon: () => ICON,
      getSize: (d) => (d.id === focus ? 42 : d.flagged ? 38 : 30),
      sizeUnits: 'pixels',
      getAngle: (d) => -d.heading,
      billboard: false,
      getColor: (d) =>
        d.flagged ? a(RED, 255) : d.mission === 'EMERGENCY' ? a(RED, 255) : d.id === focus ? a(WHITE, 255) : a(MISSION_COLOR[d.mission] ?? CYAN, 235),
      pickable: true,
      updateTriggers: { getPosition: now, getAngle: now, getColor: [focus, world.emergency] },
    }),
  )

  if (mode === 'OPS' || mode === 'GOV' || mode === 'NETWORK' || mode === 'EMERGENCY') {
    layers.push(
      new TextLayer<Drone>({
        id: 'sg-drone-labels',
        data: shown,
        getPosition: (d) => [d.lng, d.lat, d.alt],
        getText: (d) => d.id,
        getSize: 10,
        sizeUnits: 'pixels',
        getColor: (d) => (d.id === focus ? a(WHITE, 255) : a(DIM, 215)),
        getPixelOffset: [0, -22],
        billboard: true,
        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        characterSet: 'auto',
        updateTriggers: { getPosition: now, getColor: focus },
      }),
    )
  }

  if (world.divertTo) {
    const d = droneById(HERO_DRONE)
    const site = SITES.find((x) => x.id === world.divertTo)
    if (d && site) {
      const [lng, lat] = toLL(site.x, site.y)
      layers.push(
        new PathLayer<[number, number, number][]>({
          id: 'sg-divert',
          data: [[[d.lng, d.lat, d.alt], [lng, lat, 40], [lng, lat, 2]]],
          getPath: (p) => p,
          getColor: a(AMBER, 220),
          getWidth: 3,
          widthUnits: 'pixels',
          updateTriggers: { getPath: now },
        }),
      )
    }
  }

  const marked = world.drones.filter((d) => d.flagged || (world.conflict && !world.conflict.resolved && (d.id === world.conflict.a || d.id === world.conflict.b)))
  if (marked.length) {
    layers.push(
      new ScatterplotLayer<Drone>({
        id: 'sg-alert-ring',
        data: marked,
        getPosition: (d) => [d.lng, d.lat, d.alt],
        getRadius: 30 + pulse * 34,
        radiusUnits: 'meters',
        getFillColor: a(RED, 26 + pulse * 46),
        stroked: true,
        getLineColor: a(RED, 210),
        getLineWidth: 1.6,
        lineWidthUnits: 'pixels',
        updateTriggers: { getPosition: now, getRadius: pulse, getFillColor: pulse },
      }),
    )
  }

  return layers
}

// ── snapshot for React panels, sampled at 4 Hz so telemetry never re-renders ──
export type Snapshot = {
  version: number
  clock: number
  drones: Drone[]
  focus: string | null
  mode: SceneMode
  incidentId: string | null
  emergency: boolean
  conflictSeconds: number
  conflictResolved: boolean
  health: number
}
let snapshot: Snapshot = {
  version: 0, clock: 0, drones: world.drones.map((d) => ({ ...d })), focus: null, mode: 'HERO',
  incidentId: null, emergency: false, conflictSeconds: 0, conflictResolved: false, health: 98.7,
}
let sampledAt = 0
const listeners = new Set<() => void>()
export const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
export const getSnapshot = () => snapshot

function sample(now: number): void {
  if (now - sampledAt < 250) return
  sampledAt = now
  snapshot = {
    version: snapshot.version + 1,
    clock: world.clock,
    drones: world.drones.map((d) => ({ ...d })),
    focus,
    mode,
    incidentId: world.incident?.id ?? null,
    emergency: world.emergency,
    conflictSeconds: world.conflict?.seconds ?? 0,
    conflictResolved: world.conflict?.resolved ?? false,
    health: world.networkHealth,
  }
  for (const fn of listeners) fn()
}

// ── mount ────────────────────────────────────────────────────────────────────
export function mountScene(canvas: HTMLCanvasElement): () => void {
  const lighting = new LightingEffect({
    ambient: new AmbientLight({ color: [150, 178, 208], intensity: 1.0 }),
    key: new DirectionalLight({ color: [185, 208, 238], intensity: 1.55, direction: [-1.1, -2.4, -1] }),
    fill: new DirectionalLight({ color: [70, 120, 160], intensity: 0.5, direction: [1.4, 1.2, -0.6] }),
  })
  deck = new Deck<MapView>({
    canvas,
    width: '100%',
    height: '100%',
    views: new MapView({ id: 'sg' }),
    viewState: cam,
    controller: { dragRotate: true, scrollZoom: false, doubleClickZoom: false, touchRotate: true, keyboard: false },
    effects: [lighting],
    layers: [],
    parameters: { cullMode: 'back' },
    onViewStateChange: ({ viewState, interactionState }) => {
      if (interactionState.isDragging && (mode === 'OPS' || mode === 'NETWORK' || mode === 'GOV')) {
        userCam = true
        cam = { ...cam, ...(viewState as unknown as Cam) }
      }
    },
    onClick: (info: PickingInfo) => {
      const d = info.object as Drone | undefined
      if (d && typeof d.id === 'string') setFocus(d.id)
    },
    getCursor: ({ isHovering }) => (isHovering ? 'pointer' : 'default'),
  })

  ;(window as unknown as { __sg?: object }).__sg = {
    mode: () => mode, focus: () => focus, cam: () => ({ ...cam }), target: () => ({ ...target }), userCam: () => userCam,
    world: () => world,
    deck: () => deck,
  }
  last = performance.now()
  const loop = () => {
    const now = performance.now()
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    step(dt)
    tween(dt)
    sample(now)
    deck?.setProps({ viewState: cam, layers: buildLayers(now) })
    if (!firstFrameAt) firstFrameAt = now
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)

  return () => {
    cancelAnimationFrame(raf)
    raf = 0
    deck?.finalize()
    deck = null
  }
}
