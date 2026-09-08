import { ColumnLayer, IconLayer, PathLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers'
import { PathStyleExtension } from '@deck.gl/extensions'
import type { Layer } from '@deck.gl/core'
import {
  getActiveRoutes,
  getCity,
  getGhostRoutes,
  getRevision,
  visibleZones,
  type Marker,
  type Pad,
  type Zone,
  type ZoneKind,
} from './city'
import { tokenRgb, type Rgb } from './tokens'

const withAlpha = (rgb: Rgb, a: number): [number, number, number, number] => [rgb[0], rgb[1], rgb[2], a]

const FILL_ALPHA = 26 // 10%
const EDGE_ALPHA = 115 // 45%

function zoneColour(kind: ZoneKind): Rgb {
  if (kind === 'NO_FLY') return tokenRgb('--critical')
  if (kind === 'HOSPITAL') return tokenRgb('--nominal')
  if (kind === 'EMERGENCY') return tokenRgb('--emergency')
  return tokenRgb('--advisory')
}

const svg = (body: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><g fill="#fff">${body}</g></svg>`,
  )}`

const icon = (url: string) => ({ url, width: 96, height: 96, anchorX: 48, anchorY: 48, mask: true })

const HUB_ICON = icon(svg('<path d="M48 8 82 28v40L48 88 14 68V28Z" fill-opacity="0.30"/><path d="M48 14 77 31v34L48 82 19 65V31Z" fill-opacity="0.0" stroke="#fff" stroke-width="5"/><circle cx="48" cy="48" r="11"/>'))
const HOSPITAL_ICON = icon(svg('<circle cx="48" cy="48" r="40" fill-opacity="0.22"/><path d="M40 18h16v22h22v16H56v22H40V56H18V40h22Z"/>'))
const STORE_ICON = icon(svg('<circle cx="48" cy="48" r="38" fill-opacity="0.18"/><rect x="26" y="32" width="44" height="36" rx="5"/><rect x="20" y="24" width="56" height="12" rx="4"/>'))

function ringPath(ring: [number, number][], alt: number): [number, number, number][] {
  const closed = [...ring, ring[0]]
  return closed.map(([lng, lat]) => [lng, lat, alt])
}

let cache: { revision: number; layers: Layer[] } | null = null

export function buildAirspaceLayers(): Layer[] {
  const revision = getRevision()
  const city = getCity()
  if (!city) return []
  if (cache && cache.revision === revision) return cache.layers

  const zones = visibleZones()
  const graticule = tokenRgb('--graticule')
  const nominal = tokenRgb('--nominal')
  const paper = tokenRgb('--paper')

  const edges = zones.flatMap((z) => [
    { zone: z, path: ringPath(z.ring, z.alt_max) },
    { zone: z, path: ringPath(z.ring, z.alt_min) },
  ])

  const markers: Marker[] = [...city.hubs, ...city.destinations]

  const layers: Layer[] = [
    new SolidPolygonLayer<Zone>({
      id: 'zone-volume',
      data: zones,
      extruded: true,
      getPolygon: (z) => z.ring.map(([lng, lat]): [number, number, number] => [lng, lat, z.alt_min]),
      getElevation: (z) => z.alt_max - z.alt_min,
      getFillColor: (z) => withAlpha(zoneColour(z.kind), FILL_ALPHA),
      material: false,
    }),
    new PathLayer<{ zone: Zone; path: [number, number, number][] }>({
      id: 'zone-edge',
      data: edges,
      getPath: (d) => d.path,
      getColor: (d) => withAlpha(zoneColour(d.zone.kind), EDGE_ALPHA),
      getWidth: 2,
      widthUnits: 'pixels',
    }),
    new PathLayer({
      id: 'corridor-tube',
      data: city.corridors,
      getPath: (c: { path: [number, number, number][] }) => c.path,
      getColor: withAlpha(graticule, 77), // 30%
      getWidth: 8,
      widthUnits: 'meters',
      widthMinPixels: 1,
      capRounded: true,
      jointRounded: true,
    }),
    new PathLayer({
      id: 'route-active',
      data: getActiveRoutes(),
      getPath: (r: { path: [number, number, number][] }) => r.path,
      getColor: withAlpha(nominal, 200),
      getWidth: 4,
      widthUnits: 'meters',
      widthMinPixels: 1,
    }),
    new PathLayer({
      id: 'route-ghost',
      data: getGhostRoutes(),
      getPath: (r: { path: [number, number, number][] }) => r.path,
      getColor: withAlpha(nominal, 77), // 30%
      getWidth: 4,
      widthUnits: 'meters',
      widthMinPixels: 1,
      getDashArray: [8, 6],
      dashJustified: true,
      extensions: [new PathStyleExtension({ dash: true })],
    }),
    new ColumnLayer<Pad>({
      id: 'landing-pad',
      data: city.pads,
      diskResolution: 16,
      radius: 60,
      extruded: true,
      getPosition: (p) => p.at,
      getElevation: 4,
      getFillColor: withAlpha(nominal, 90),
      getLineColor: withAlpha(nominal, 170),
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 1,
      material: false,
    }),
    new IconLayer<Marker>({
      id: 'site-glyph',
      data: markers,
      getPosition: (m) => m.at,
      getIcon: (m) => (m.kind === 'HOSPITAL' ? HOSPITAL_ICON : m.kind === 'DARK_STORE' ? STORE_ICON : HUB_ICON),
      getSize: (m) => (m.kind === 'HOSPITAL' || m.kind === 'DARK_STORE' ? 22 : 26),
      sizeUnits: 'pixels',
      getColor: (m) => withAlpha(m.kind === 'HOSPITAL' ? nominal : graticule, 235),
      billboard: true,
    }),
    new TextLayer<Marker>({
      id: 'site-label',
      data: markers,
      getPosition: (m) => m.at,
      getText: (m) => m.name,
      getSize: 10,
      sizeUnits: 'pixels',
      getColor: withAlpha(paper, 190),
      getPixelOffset: [0, 20],
      billboard: true,
      fontFamily: '"Barlow Semi Condensed", system-ui, sans-serif',
      fontWeight: 600,
      characterSet: 'auto',
    }),
  ]

  cache = { revision, layers }
  return layers
}
