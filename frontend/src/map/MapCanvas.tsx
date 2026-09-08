import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { token } from '../lib/tokens'
import { ingestHello, ingestTick } from '../lib/telemetry'
import { bumpRevision, getCity, ingestCity, setZoneVisible } from '../lib/city'
import { startRender, stopRender } from '../lib/render'
import { connect, disconnect, onHello, onTick } from '../lib/ws'

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
      ingestHello(frame)
    })
    const offTick = onTick(ingestTick)
    startRender(overlay)
    connect()

    mapRef.current = map
    ;(window as unknown as { __map?: maplibregl.Map }).__map = map
    ;(window as unknown as { __city?: object }).__city = { get: getCity, setZoneVisible, bumpRevision }
    return () => {
      offHello()
      offTick()
      stopRender()
      disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  return <div ref={host} className="fixed inset-0" />
}
