import { create } from 'zustand'

export type Role = 'GOVERNMENT' | 'OPERATOR' | 'HOSPITAL' | 'ENGINEER'
export type CameraMode = 'CITY' | 'INCIDENT' | 'DRONE'
export type Weather = { wind_speed: number; wind_direction: number; visibility_m: number } | null
export type Emergency = { kind: string; zone_id: string; since: number } | null
export type TimelineEvent = { id: string; clock: number; kind: string; text: string }

type Store = {
  incidents: unknown[]
  decisions: unknown[]
  missions: unknown[]
  events: TimelineEvent[]
  selectedDroneId: string | null
  role: Role
  emergency: Emergency
  cameraMode: CameraMode
  weather: Weather
  aiEnabled: boolean
  selectDrone: (id: string | null) => void
  setCameraMode: (mode: CameraMode) => void
  setRole: (role: Role) => void
  setAiEnabled: (on: boolean) => void
  applyHello: (frame: { missions: unknown[]; incidents: unknown[] }) => void
  pushEvent: (event: TimelineEvent) => void
}

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
  selectDrone: (id) => set({ selectedDroneId: id }),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setRole: (role) => set({ role }),
  setAiEnabled: (aiEnabled) => set({ aiEnabled }),
  applyHello: (frame) => set({ missions: frame.missions, incidents: frame.incidents, decisions: [], events: [] }),
  pushEvent: (event) => set((s) => ({ events: [...s.events, event].slice(-120) })),
}))
