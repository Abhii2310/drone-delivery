import MapCanvas from './map/MapCanvas'
import StatusBar from './chrome/StatusBar'
import AlertBand from './chrome/AlertBand'
import FleetRail from './panels/FleetRail'
import SupervisorRail from './panels/SupervisorRail'
import Timeline from './panels/Timeline'

let renders = 0

export default function App() {
  renders++
  ;(window as unknown as { __appRenders?: number }).__appRenders = renders
  return (
    <>
      <MapCanvas />
      <StatusBar />
      <AlertBand />
      <FleetRail />
      <SupervisorRail />
      <Timeline />
    </>
  )
}
