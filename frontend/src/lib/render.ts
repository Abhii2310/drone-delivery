import { IconLayer, LineLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { MapboxOverlay } from '@deck.gl/mapbox'
import { debug, getInterpolated, type DroneView } from './telemetry'
import { getConflictPoints, getLandingPulse, type ConflictPoint, type LandingPulse } from './conflicts'
import { updateChaseCam } from '../map/FollowCam'
import { useStore } from '../store'
import type maplibregl from 'maplibre-gl'
import { buildAirspaceLayers } from './airspace'
import { tokenRgb, type Rgb } from './tokens'

const QUADCOPTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
<g fill="#fff">
<path d="M64 14 L74 40 L64 35 L54 40 Z"/>
<rect x="52" y="36" width="24" height="46" rx="7"/>
<rect x="26" y="26" width="76" height="9" rx="4.5" transform="rotate(45 64 64)"/>
<rect x="26" y="26" width="76" height="9" rx="4.5" transform="rotate(-45 64 64)"/>
<circle cx="26" cy="26" r="15" fill-opacity="0.55"/>
<circle cx="102" cy="26" r="15" fill-opacity="0.55"/>
<circle cx="26" cy="102" r="15" fill-opacity="0.55"/>
<circle cx="102" cy="102" r="15" fill-opacity="0.55"/>
</g></svg>`

const ICON = {
  url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(QUADCOPTER_SVG)}`,
  width: 128,
  height: 128,
  anchorX: 64,
  anchorY: 64,
  mask: true,
}

const withAlpha = (rgb: Rgb, alpha: number): [number, number, number, number] => [rgb[0], rgb[1], rgb[2], alpha]

let frameId = 0
let frames = 0
let fpsWindowStart = 0
let fps = 0

export const getFps = () => fps
export const getFrameCount = () => frames

function buildLayers(drones: DroneView[], nowMs: number) {
  const nominal = tokenRgb('--nominal')
  const shadow = withAlpha(tokenRgb('--ink'), 102)
  const tether = withAlpha(tokenRgb('--graticule'), 89)
  const label = tokenRgb('--paper')

  const conflicts = getConflictPoints()
  const pulse = 0.5 + 0.5 * Math.sin((nowMs / 1400) * Math.PI * 2)

  const landing = getLandingPulse()

  return [
    new ScatterplotLayer<LandingPulse>({
      id: 'landing-pulse',
      data: landing ? [landing] : [],
      getPosition: (p) => [p.lng, p.lat, 2],
      getRadius: () => 55 + pulse * 45,
      radiusUnits: 'meters',
      getFillColor: withAlpha(tokenRgb('--executed'), 30 + pulse * 60),
      stroked: true,
      getLineColor: withAlpha(tokenRgb('--executed'), 230),
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      updateTriggers: { getRadius: pulse, getFillColor: pulse },
    }),
    new ScatterplotLayer<ConflictPoint>({
      id: 'conflict-marker',
      data: conflicts,
      getPosition: (c) => [c.lng, c.lat, c.alt],
      getRadius: () => 26 + pulse * 30,
      radiusUnits: 'meters',
      getFillColor: (c) => withAlpha(tokenRgb(c.severity === 'CRITICAL' ? '--critical' : '--advisory'), 40 + pulse * 70),
      stroked: true,
      getLineColor: (c) => withAlpha(tokenRgb(c.severity === 'CRITICAL' ? '--critical' : '--advisory'), 220),
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      updateTriggers: { getRadius: pulse, getFillColor: pulse },
    }),
    new ScatterplotLayer<DroneView>({
      id: 'drone-shadow',
      data: drones,
      getPosition: (d) => [d.lng, d.lat, 0],
      getRadius: (d) => 7 + d.alt * 0.055,
      radiusUnits: 'meters',
      getFillColor: shadow,
      stroked: true,
      getLineColor: withAlpha(tokenRgb('--rule'), 120),
      getLineWidth: 1,
      lineWidthUnits: 'pixels',
    }),
    new LineLayer<DroneView>({
      id: 'drone-tether',
      data: drones,
      getSourcePosition: (d) => [d.lng, d.lat, d.alt],
      getTargetPosition: (d) => [d.lng, d.lat, 0],
      getColor: tether,
      getWidth: 1,
      widthUnits: 'pixels',
    }),
    new IconLayer<DroneView>({
      id: 'drone-glyph',
      data: drones,
      getPosition: (d) => [d.lng, d.lat, d.alt],
      getIcon: () => ICON,
      getSize: 30,
      sizeUnits: 'pixels',
      getAngle: (d) => -d.heading,
      billboard: false,
      getColor: nominal,
    }),
    new TextLayer<DroneView>({
      id: 'drone-label',
      data: drones,
      getPosition: (d) => [d.lng, d.lat, d.alt],
      getText: (d) => d.id,
      getSize: 11,
      sizeUnits: 'pixels',
      getColor: label,
      getPixelOffset: [0, -24],
      billboard: true,
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      fontWeight: 500,
      characterSet: 'auto',
    }),
  ]
}

let lastViews: DroneView[] = []
let lastFrameMs = performance.now()

export function startRender(overlay: MapboxOverlay, map: maplibregl.Map): void {
  stopRender()
  fpsWindowStart = performance.now()
  frames = 0
  const loop = () => {
    const now = performance.now()
    frames++
    if (now - fpsWindowStart >= 1000) {
      fps = Math.round((frames * 1000) / (now - fpsWindowStart))
      frames = 0
      fpsWindowStart = now
    }
    lastViews = getInterpolated(now)
    const followId = useStore.getState().followDroneId
    if (followId) {
      const target = lastViews.find((d) => d.id === followId)
      if (target) updateChaseCam(map, target, Math.min(0.1, (now - lastFrameMs) / 1000))
    }
    lastFrameMs = now
    overlay.setProps({ layers: [...buildAirspaceLayers(), ...buildLayers(lastViews, now)] })
    frameId = requestAnimationFrame(loop)
  }
  frameId = requestAnimationFrame(loop)
  ;(window as unknown as { __sky?: object }).__sky = { getFps, views: () => lastViews, debug: () => debug(performance.now()) }
}

export function stopRender(): void {
  if (frameId) cancelAnimationFrame(frameId)
  frameId = 0
}
