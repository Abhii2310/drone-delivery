import MapCanvas from './map/MapCanvas'

let renders = 0

export default function App() {
  renders++
  ;(window as unknown as { __appRenders?: number }).__appRenders = renders
  return <MapCanvas />
}
