import type maplibregl from 'maplibre-gl'
import type { DroneView } from '../lib/telemetry'

export const CITY = { zoom: 13.8, pitch: 52, bearing: 0 }
export const CITY_CENTRE: [number, number] = [77.59605, 12.97505] // fixture centroid
export const INCIDENT = { zoom: 16.0, pitch: 45 }
export const DRONE = { zoom: 17.2, pitch: 72 }

const LOOK_AHEAD_M = 160
const K_POS = 3.5
const K_BRG = 2.2
const M_PER_DEG_LAT = 110900
const M_PER_DEG_LNG = 110900 * Math.cos((12.9716 * Math.PI) / 180)

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

let cam: { lng: number; lat: number; bearing: number } | null = null
let entering = false

/**
 * The look-at point, LOOK_AHEAD_M along the drone's heading. MapLibre's `center` is what the
 * camera looks AT, not where it sits: putting it ahead of the drone drops the drone into the
 * lower third and fills the frame with the route ahead, which is the effect the addendum asks
 * for when it describes the camera sitting behind the aircraft.
 */
function behind(d: DroneView): { lng: number; lat: number } {
  const rad = (d.heading * Math.PI) / 180
  return {
    lng: d.lng + (Math.sin(rad) * LOOK_AHEAD_M) / M_PER_DEG_LNG,
    lat: d.lat + (Math.cos(rad) * LOOK_AHEAD_M) / M_PER_DEG_LAT,
  }
}

/** flyTo once on entry; the rAF damping must never handle the transition, it reads as drift. */
export function enterDroneView(map: maplibregl.Map, drone: DroneView): void {
  const target = behind(drone)
  cam = { lng: target.lng, lat: target.lat, bearing: drone.heading }
  entering = true
  map.flyTo({
    center: [target.lng, target.lat],
    zoom: DRONE.zoom,
    pitch: reduced() ? 40 : DRONE.pitch,
    bearing: reduced() ? map.getBearing() : drone.heading,
    duration: 1200,
    essential: true,
  })
  map.once('moveend', () => {
    entering = false
  })
}

export function exitDroneView(map: maplibregl.Map): void {
  cam = null
  entering = false
  map.flyTo({ ...CITY, center: CITY_CENTRE, duration: 1200, essential: true })
}

export function isEntering(): boolean {
  return entering
}

export function updateChaseCam(map: maplibregl.Map, drone: DroneView, dt: number): void {
  if (entering || cam === null || dt <= 0) return
  const target = behind(drone)
  const a = 1 - Math.exp(-K_POS * dt)
  cam.lng += (target.lng - cam.lng) * a
  cam.lat += (target.lat - cam.lat) * a

  if (!reduced()) {
    const b = 1 - Math.exp(-K_BRG * dt)
    const delta = ((drone.heading - cam.bearing + 540) % 360) - 180
    cam.bearing = (cam.bearing + delta * b + 360) % 360
  }
  // jumpTo, never easeTo: we are already interpolating, easing on top rubber-bands
  map.jumpTo({
    center: [cam.lng, cam.lat],
    bearing: reduced() ? map.getBearing() : cam.bearing,
    pitch: reduced() ? 40 : DRONE.pitch,
    zoom: DRONE.zoom,
  })
}
