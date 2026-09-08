import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { token } from '../lib/tokens'
import { ingestHello, ingestTick } from '../lib/telemetry'
import { bumpRevision, getCity, ingestCity, ingestDroneRoute, refreshCity, setZoneVisible } from '../lib/city'
import { ingestFleetMeta, updateDroneMeta } from '../lib/fleet'
import { setConflictPoints, setLandingPulse } from '../lib/conflicts'
import { getInterpolated } from '../lib/telemetry'
import { useStore } from '../store'
import { startRender, stopRender } from '../lib/render'
import { connect, disconnect, onEvent, onHello, onStatus, onTick } from '../lib/ws'
import { enterDroneView, exitDroneView } from './FollowCam'
import { handleKey } from '../lib/keyboard'
import { cinematic } from '../lib/cinematic'
import { photorealAttribution, photorealConfigured, photorealFailure } from '../lib/photoreal'

export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
// fixture centroid, computed from backend/city.py bbox
export const CITY_VIEW = { center: [77.59605, 12.97505] as [number, number], zoom: 13.8, pitch: 52, bearing: 0 }

export function applyDarkScheme(map: maplibregl.Map) {
  const ink = token('--ink')
  const panel = token('--panel')
  const panelSolid = token('--panel-solid')
  const ruleSoft = token('--rule-soft')
  const rule = token('--rule')
  const graticule = token('--graticule')
  const muted = token('--muted')

  for (const layer of map.getStyle().layers) {
    const id = layer.id
    switch (layer.type) {
      case 'background':
        map.setPaintProperty(id, 'background-color', ink)
        break
      case 'raster':
        map.setLayoutProperty(id, 'visibility', 'none')
        break
      case 'fill':
        if (id === 'water') map.setPaintProperty(id, 'fill-color', panel)
        else if (id === 'building') map.setPaintProperty(id, 'fill-color', panelSolid)
        else map.setPaintProperty(id, 'fill-color', ink)
        if (id === 'building') map.setPaintProperty(id, 'fill-outline-color', ruleSoft)
        else if (map.getPaintProperty(id, 'fill-outline-color') !== undefined) map.setPaintProperty(id, 'fill-outline-color', ink)
        if (id.startsWith('landuse') || id.startsWith('landcover') || id.startsWith('park')) map.setPaintProperty(id, 'fill-opacity', 0.4)
        break
      case 'fill-extrusion':
        map.setPaintProperty(id, 'fill-extrusion-color', panelSolid)
        map.setPaintProperty(id, 'fill-extrusion-opacity', 0.85)
        break
      case 'line': {
        if (id.startsWith('boundary') || id.includes('hatching')) {
          map.setLayoutProperty(id, 'visibility', 'none')
          break
        }
        const major = /motorway|trunk|primary/.test(id) && !id.includes('casing')
        const casing = id.includes('casing')
        const water = id.startsWith('waterway')
        map.setPaintProperty(id, 'line-color', casing ? ink : water ? panel : major ? rule : ruleSoft)
        if (map.getPaintProperty(id, 'line-dasharray') !== undefined) map.setPaintProperty(id, 'line-dasharray', [1, 0])
        break
      }
      case 'symbol':
        if (id.startsWith('poi') || id.includes('shield') || id.includes('one_way') || id === 'airport') {
          map.setLayoutProperty(id, 'visibility', 'none')
          break
        }
        map.setPaintProperty(id, 'text-color', id.startsWith('highway') ? muted : graticule)
        map.setPaintProperty(id, 'text-halo-color', ink)
        map.setPaintProperty(id, 'text-halo-width', 1.2)
        break
    }
  }
}

export default function MapCanvas() {
  const host = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  useEffect(() => {
    if (!host.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: host.current,
      style: STYLE_URL,
      ...CITY_VIEW,
      maxPitch: 75,
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
    })
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    // styledata, not load: load waits on every source reporting ready, which can stall
    let styled = false
    const restyle = () => {
      if (styled || !map.getLayer('background')) return
      applyDarkScheme(map)
      styled = true
    }
    map.on('styledata', restyle)
    map.once('load', restyle)
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] })
    map.addControl(overlay)
    const offHello = onHello((frame) => {
      ingestCity(frame)
      ingestFleetMeta(frame)
      ingestHello(frame)
      useStore.getState().applyHello(frame)
    })
    const offStatus = onStatus((s) => useStore.getState().setConnection(s))
    const offTick = onTick(ingestTick)
    const flyToIncident = (incident: { drone_ids: string[]; facts: Record<string, number> }, ll: [number, number]) => {
      const views = getInterpolated(performance.now())
      const pts: [number, number][] = [[ll[1], ll[0]]]
      for (const id of incident.drone_ids) {
        const v = views.find((d) => d.id === id)
        if (v) pts.push([v.lng, v.lat])
      }
      if (pts.length < 3) return
      // bearing along the conflict axis, then look at it side-on so both tracks stay visible
      const [a, b] = [pts[1], pts[2]]
      const axis = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI
      const lngs = pts.map((p) => p[0])
      const lats = pts.map((p) => p[1])
      const cam = map.cameraForBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 140 },
      )
      cinematic('incident-camera', 1400, () =>
        map.flyTo({
        center: cam?.center ?? [ll[1], ll[0]],
        zoom: Math.min(cam?.zoom ?? 16, 16.5),
        pitch: 45,
        bearing: (axis + 90) % 360,
        duration: 1400,
        essential: true,
      }),
      )
    }

    const offEvent = onEvent(({ kind, payload }) => {
      if (kind.startsWith('incident.')) {
        const { incident, conflict_ll, clock } = payload
        if (conflict_ll) incident.facts.conflict_ll = conflict_ll
        const store = useStore.getState()
        store.upsertIncident(incident)
        const open = useStore.getState().incidents
        setConflictPoints(
          open
            .filter((i) => i.facts.conflict_point && i.kind === 'COLLISION')
            .map((i) => {
              const ll = (i.facts as Record<string, number[]>).conflict_ll
              return {
                id: i.id,
                lng: ll?.[1] ?? 0,
                lat: ll?.[0] ?? 0,
                alt: (i.facts as unknown as Record<string, number>).conflict_alt_m ?? 80,
                severity: i.severity,
              }
            })
            .filter((p) => p.lng !== 0),
        )
        if (kind === 'incident.created') {
          store.setVerification(null) // a new conflict supersedes the last verification
          const f = incident.facts as Record<string, number>
          store.pushEvent({ id: `${incident.id}-created`, clock, kind, text: `${incident.id} detected · ${incident.kind} ${incident.severity} · ${incident.drone_ids.join(' × ')} · ${f.min_sep_m} m in ${f.t_cpa_s} s` })
          if (conflict_ll) flyToIncident(incident, conflict_ll)
        } else if (incident.state === 'INVESTIGATING') {
          store.pushEvent({ id: `${incident.id}-investigating`, clock, kind, text: `${incident.id} investigating` })
        } else if (incident.state === 'RESOLVED' || incident.state === 'EXECUTED' || incident.state === 'REJECTED') {
          store.pushEvent({ id: `${incident.id}-${incident.state}`, clock, kind, text: `${incident.id} ${incident.state.toLowerCase()}` })
          if (incident.state !== 'RESOLVED') store.clearDecision()
        }
        return
      }
      if (kind === 'maneuver.started') {
        useStore.getState().pushEvent({ id: `mnv-${payload.clock}`, clock: payload.clock, kind,
          text: `Maneuver executing · ${payload.detail}` })
        return
      }
      if (kind === 'separation.verified') {
        const store = useStore.getState()
        store.setVerification(payload)
        store.pushEvent({ id: `sep-${payload.clock}`, clock: payload.clock, kind,
          text: `Separation verified · ${payload.separation_before_m} m to ${payload.separation_after_m} m against a ${payload.required_sep_m} m minimum` })
        return
      }
      if (kind === 'incident.resolved') {
        const store = useStore.getState()
        store.upsertIncident(payload.incident)
        store.clearDecision()
        store.pushEvent({ id: `res-${payload.incident_id}-${payload.clock}`, clock: payload.clock, kind,
          text: `Conflict resolved · ${payload.drone_ids.join(' and ')} continuing` })
        return
      }
      if (kind === 'engineer.alerted') {
        useStore.getState().pushEvent({ id: `eng-${payload.clock}-${payload.drone_id}`, clock: payload.clock, kind,
          text: `ENGINEER ALERT · ${payload.engineer_id} at ${payload.hub_id} · ${payload.reason}` })
        const pad = getCity()?.pads.find((p) => p.id === payload.landing_zone_id)
        if (pad) setLandingPulse({ id: pad.id, lng: pad.at[0], lat: pad.at[1] })
        const drone = useStore.getState().missions.find((m) => (m as { drone_id?: string }).drone_id === payload.drone_id)
        if (drone) useStore.getState().setReplaceable((drone as { id: string }).id)
        return
      }
      if (kind === 'drone.landed') {
        useStore.getState().pushEvent({ id: `landed-${payload.clock}-${payload.drone.id}`, clock: payload.clock, kind,
          text: `${payload.drone.id} landed at ${payload.landing_zone_id} · pad now ${payload.occupied} occupied` })
        return
      }
      if (kind === 'replacement.dispatched') {
        useStore.getState().pushEvent({ id: `rpl-${payload.clock}`, clock: payload.clock, kind,
          text: `replacement ${payload.replacement} takes over ${payload.mission_id} from ${payload.replaced}` })
        return
      }
      if (kind === 'emergency.changed') {
        const store = useStore.getState()
        const em = payload.emergency
        store.setEmergency(em)
        const body = document.body
        if (em) {
          cinematic('emergency-activation', 1400, () => {
          // UI-SPEC 2.10 activation sequence, cinematic, once
          body.classList.add('emergency')                                        // t=0
          setTimeout(() => body.classList.add('emergency-frame'), 180)           // t=180
          setTimeout(() => store.setEmergencyPhase(200), 200)                    // t=200 colour crossfade
          setTimeout(async () => {                                               // t=400 polygon rises
            const raw = await (await fetch('/api/city')).json()
            refreshCity(raw)
            store.setEmergencyPhase(400)
          }, 400)
          setTimeout(() => { store.setEmergencyPhase(600); bumpRevision() }, 600) // t=600 corridors
          setTimeout(() => store.setEmergencyPhase(800), 800)                     // t=800 strips grey out
          setTimeout(() => store.setEmergencyPhase(1000), 1000)                   // t=1000 rescue header
          setTimeout(() => store.setEmergencyPhase(1200), 1200)                   // t=1200 summary
          })
          store.pushEvent({ id: `emg-on-${payload.clock}`, clock: payload.clock, kind, text: `${em.kind} response active · ${em.zone_id}` })
        } else {
          body.classList.remove('emergency-frame')
          setTimeout(() => body.classList.remove('emergency'), 600)
          store.setEmergencyPhase(0)
          fetch('/api/city').then((r) => r.json()).then((raw) => { refreshCity(raw); bumpRevision() })
          store.pushEvent({ id: `emg-off-${payload.clock}`, clock: payload.clock, kind, text: 'emergency stood down' })
        }
        return
      }
      if (kind === 'emergency.step') {
        useStore.getState().pushEvent({ id: `emg-step-${payload.step}-${payload.clock}`, clock: payload.clock, kind,
          text: `emergency step ${payload.step} · ${payload.name}` })
        return
      }
      if (kind === 'rescue.dispatched') {
        useStore.getState().pushEvent({ id: `rescue-${payload.clock}`, clock: payload.clock, kind,
          text: `rescue dispatched to ${payload.zone_id} · ${Object.entries(payload.assignments).map(([p, d]) => `${p}:${d}`).join(' ')}` })
        return
      }
      if (kind === 'sim.paused') {
        useStore.getState().setPaused(payload.paused)
        return
      }
      if (kind === 'weather.updated') {
        useStore.getState().setWeather(payload.weather)
        return
      }
      if (kind === 'ai.changed') {
        useStore.getState().setAiEnabled(payload.enabled)
        return
      }
      if (kind === 'drone.updated') {
        ingestDroneRoute(payload.drone, payload.route)
        updateDroneMeta(payload.drone)
        return
      }
      if (kind === 'decision.alternatives') {
        const store = useStore.getState()
        store.setFacts(payload.facts)
        store.pushEvent({ id: `${payload.incident_id}-alts`, clock: payload.clock, kind, text: `${payload.incident_id} alternatives evaluated · ${payload.count} options, ${payload.facts.yielding_drone} yields` })
        return
      }
      if (kind === 'decision.ready') {
        const store = useStore.getState()
        store.setDecision(payload.decision)
        store.pushEvent({ id: `${payload.decision.id}-ready`, clock: payload.clock, kind, text: `${payload.decision.id} recommendation · ${payload.decision.summary} · confidence ${(payload.decision.confidence * 100).toFixed(0)}%` })
        return
      }
      if (kind === 'decision.approved') {
        useStore.getState().pushEvent({ id: `${payload.decision_id}-approved`, clock: payload.clock, kind, text: `${payload.decision_id} approved by ${payload.actor}` })
        return
      }
      if (kind === 'decision.executed') {
        const store = useStore.getState()
        if (payload.drone) {
          ingestDroneRoute(payload.drone, payload.route)
          updateDroneMeta(payload.drone)
        }
        store.setApplying(false)
        store.pushEvent({ id: `exec-${payload.clock}-${payload.detail}`, clock: payload.clock, kind, text: `executed · ${payload.detail}` })
        return
      }
      if (kind === 'decision.rejected') {
        const store = useStore.getState()
        store.setApplying(false)
        store.clearDecision()
        store.pushEvent({ id: `rej-${payload.clock}`, clock: payload.clock, kind, text: payload.actor === 'safety' ? `${payload.decision_id} blocked by safety · ${payload.reason}` : `${payload.decision_id} rejected by ${payload.actor}` })
        return
      }
      if (kind === 'scenario.fired') {
        useStore.getState().pushEvent({ id: `scn-${payload.clock}-${payload.name}`, clock: payload.clock, kind, text: `${payload.name} · ${payload.detail}` })
        return
      }
      if (!kind.startsWith('mission.')) return
      const { mission, drone, route, clock } = payload
      if (drone) {
        ingestDroneRoute(drone, route)
        updateDroneMeta(drone)
      }
      const store = useStore.getState()
      store.upsertMission(mission)
      store.pushEvent({
        id: `${mission.id}-${mission.state}-${clock}`,
        clock,
        kind,
        text: `${mission.id} ${mission.state} · ${mission.drone_id ?? '--'} ${mission.origin_hub_id} → ${mission.dest_id}`,
      })
    })
    startRender(overlay, map)
    connect()

    const onKey = (e: KeyboardEvent) =>
      handleKey(e, {
        enterDroneView: (id) => {
          const view = getInterpolated(performance.now()).find((d) => d.id === id)
          if (view) {
            useStore.getState().setFollow(id)
            enterDroneView(map, view)
          }
        },
        exitDroneView: () => exitDroneView(map),
      })
    window.addEventListener('keydown', onKey)

    // the photoreal tileset covers the vector basemap completely; hiding it saves the
    // draw rather than painting two cities on top of each other
    let basemapHidden = false
    // only the layers the dark scheme left showing are restored; turning everything back
    // on would resurrect the POI pins and boundaries applyDarkScheme deliberately hid
    let restorable: string[] = []
    const setBasemap = (hidden: boolean) => {
      if (hidden === basemapHidden || !map.isStyleLoaded()) return
      if (hidden) {
        restorable = map
          .getStyle()
          .layers.filter((l) => l.id !== 'background' && map.getLayoutProperty(l.id, 'visibility') !== 'none')
          .map((l) => l.id)
        for (const id of restorable) map.setLayoutProperty(id, 'visibility', 'none')
      } else {
        for (const id of restorable) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible')
      }
      basemapHidden = hidden
    }
    // the vector basemap comes back the moment the imagery stops drawing, so a spent
    // quota degrades to the graphite map instead of to a black hole
    const syncBasemap = () => setBasemap(useStore.getState().photoreal && !photorealFailure())
    const basemapTimer = window.setInterval(syncBasemap, 1000)
    const unsubPhotoreal = useStore.subscribe(syncBasemap)

    let lastFollow: string | null = null
    const unsubFollow = useStore.subscribe((s) => {
      if (s.followDroneId === lastFollow) return
      const previous = lastFollow
      lastFollow = s.followDroneId
      if (s.followDroneId) {
        const view = getInterpolated(performance.now()).find((d) => d.id === s.followDroneId)
        if (view) enterDroneView(map, view)
      } else if (previous) {
        exitDroneView(map)
      }
    })

    mapRef.current = map
    ;(window as unknown as { __map?: maplibregl.Map }).__map = map
    ;(window as unknown as { __city?: object }).__city = { get: getCity, setZoneVisible, bumpRevision }
    return () => {
      offHello()
      offTick()
      offEvent()
      offStatus()
      window.removeEventListener('keydown', onKey)
      unsubFollow()
      unsubPhotoreal()
      clearInterval(basemapTimer)
      stopRender()
      disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  const photoreal = useStore((s) => s.photoreal)
  return (
    <>
      <div ref={host} className="fixed inset-0" />
      {photoreal && photorealConfigured && (
        <span
          className="t-mono-sm fixed right-3 bottom-8 z-20"
          style={{ color: photorealFailure() ? 'var(--advisory)' : 'var(--muted)', pointerEvents: 'none' }}
        >
          {photorealFailure() ? `3D imagery unavailable · ${photorealFailure()}` : `3D imagery ${photorealAttribution() || 'Google'}`}
        </span>
      )}
    </>
  )
}
