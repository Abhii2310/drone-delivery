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
import ReadOnlyNotice from './chrome/ReadOnlyNotice'
import { useEffect } from 'react'
import { useStore, type Role } from './store'
import { setViewer, type Viewer } from './lib/ws'

// the sign-in page hands the chosen role over in the URL; the same viewer table the
// role picker uses turns it into a server-side filter
const VIEWERS: Record<Role, Viewer> = {
  GOVERNMENT: { role: 'GOVERNMENT' },
  OPERATOR: { role: 'OPERATOR', operator_id: 'OP-MEDX' },
  HUB_ENGINEER: { role: 'HUB_ENGINEER', hub_id: 'HUB-MED' },
  CUSTOMER: { role: 'CUSTOMER' },
}

let renders = 0

export default function App() {
  renders++
  ;(window as unknown as { __appRenders?: number }).__appRenders = renders
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('role') as Role | null
    if (wanted && wanted in VIEWERS && wanted !== useStore.getState().role) {
      useStore.getState().setRole(wanted)
      setViewer(VIEWERS[wanted])
    }
  }, [])
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
      <ReadOnlyNotice />
      <Timeline />
    </>
  )
}
