import { create } from 'zustand'

export type Role = 'GOVERNMENT' | 'OPERATOR' | 'HOSPITAL' | 'ENGINEER'
export type CameraMode = 'CITY' | 'INCIDENT' | 'DRONE'
export type Weather = { wind_speed: number; wind_direction: number; visibility_m: number } | null
export type Emergency = { kind: string; zone_id: string; since: number } | null
export type TimelineEvent = { id: string; clock: number; kind: string; text: string }
export type IncidentRecord = {
  id: string
  kind: string
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  drone_ids: string[]
  facts: Record<string, unknown>
  state: string
  created_at: number
}

type Store = {
  incidents: IncidentRecord[]
  decisions: unknown[]
  missions: unknown[]
  events: TimelineEvent[]
  selectedDroneId: string | null
  role: Role
  emergency: Emergency
  cameraMode: CameraMode
  weather: Weather
  aiEnabled: boolean
  composerOpen: boolean
  toggleComposer: (open?: boolean) => void
  selectDrone: (id: string | null) => void
  setCameraMode: (mode: CameraMode) => void
  setRole: (role: Role) => void
  setAiEnabled: (on: boolean) => void
  applyHello: (frame: { missions: unknown[]; incidents: IncidentRecord[] }) => void
  pushEvent: (event: TimelineEvent) => void
  upsertMission: (mission: MissionRecord) => void
  upsertIncident: (incident: IncidentRecord) => void
}

export type MissionRecord = { id: string; state: string; dest_id: string; origin_hub_id: string; payload_kind: string; priority: string; drone_id: string | null; eta_s: number | null }

export const useStore = create<Store>((set) => ({
  incidents: [],
  decisions: [],
  missions: [],
  events: [],
  selectedDroneId: null,
  role: 'GOVERNMENT',
  emergency: null,
  cameraMode: 'CITY',
  weather: null,
  aiEnabled: true,
  composerOpen: false,
  toggleComposer: (open) => set((s) => ({ composerOpen: open ?? !s.composerOpen })),
  selectDrone: (id) => set({ selectedDroneId: id }),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setRole: (role) => set({ role }),
  setAiEnabled: (aiEnabled) => set({ aiEnabled }),
  applyHello: (frame) => set({ missions: frame.missions, incidents: frame.incidents, decisions: [], events: [] }),
  pushEvent: (event) => set((s) => ({ events: [...s.events, event].slice(-120) })),
  upsertIncident: (incident) =>
    set((s) => {
      const open = incident.state !== 'RESOLVED' && incident.state !== 'REJECTED'
      const rest = s.incidents.filter((i) => i.id !== incident.id)
      return { incidents: open ? [...rest, incident] : rest }
    }),
  upsertMission: (mission) =>
    set((s) => {
      const list = s.missions as MissionRecord[]
      const i = list.findIndex((m) => m.id === mission.id)
      const next = i === -1 ? [...list, mission] : list.map((m) => (m.id === mission.id ? mission : m))
      return { missions: next.filter((m) => m.state !== 'COMPLETE') }
    }),
}))
