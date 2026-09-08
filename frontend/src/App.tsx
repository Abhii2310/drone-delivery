import MapCanvas from './map/MapCanvas'
import StatusBar from './chrome/StatusBar'
import AlertBand from './chrome/AlertBand'
import EmergencyBand from './chrome/EmergencyBand'
import ConnectionBand from './chrome/ConnectionBand'
import FleetRail from './panels/FleetRail'
import SupervisorRail from './panels/SupervisorRail'
import Timeline from './panels/Timeline'
import DroneDrawer from './panels/DroneDrawer'
import DroneHud from './chrome/DroneHud'

let renders = 0

export default function App() {
  renders++
  ;(window as unknown as { __appRenders?: number }).__appRenders = renders
  return (
    <>
      <MapCanvas />
      <StatusBar />
      <ConnectionBand />
      <EmergencyBand />
      <AlertBand />
      <FleetRail />
      <SupervisorRail />
      <DroneHud />
      <DroneDrawer />
      <Timeline />
    </>
  )
}
