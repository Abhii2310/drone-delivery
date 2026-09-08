import { create } from 'zustand'

export type Role = 'GOVERNMENT' | 'OPERATOR' | 'HUB_ENGINEER' | 'CUSTOMER'
export type CameraMode = 'CITY' | 'INCIDENT' | 'DRONE'
export type Weather = { wind_speed: number; wind_direction: number; visibility_m: number; wind_gusts?: number; source?: string } | null
export type EmergencySummary = {
  affected: number
  rerouted: number
  returning: number
  emergency_landing: number
  paused: number
  available_for_rescue: number
  drone_ids: Record<string, string[]>
}
export type EmergencyState = {
  kind: string
  zone_id: string
  since: number
  corridor_ids: string[]
  summary?: EmergencySummary
  landing_zones?: Record<string, string | number | boolean>[]
} | null
export type Emergency = EmergencyState
export type TimelineEvent = { id: string; clock: number; kind: string; text: string }
export type ActionRecord = { kind: string; drone_id: string | null; params: Record<string, number | string | string[]> }
export type DecisionRecord = {
  id: string
  incident_id: string
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  summary: string
  recommended_action: ActionRecord
  alternatives: ActionRecord[]
  reasoning: string[]
  risk_before: number
  risk_after: number
  confidence: number
  requires_human_approval: boolean
  source: string
}
export type FactPacket = {
  incident: Record<string, number | string>
  drones: Record<string, number | string | null>[]
  yielding_drone: string
  alternatives: Record<string, unknown>[]
  hard_rules: string[]
}

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
  decisions: DecisionRecord[]
  decision: DecisionRecord | null
  facts: FactPacket | null
  selectedAlternative: number | null
  applying: boolean
  replaceableMission: string | null
  drawerOpen: boolean
  followDroneId: string | null
  missions: unknown[]
  events: TimelineEvent[]
  selectedDroneId: string | null
  role: Role
  emergency: Emergency
  emergencyPhase: number
  cameraMode: CameraMode
  weather: Weather
  capabilities: string[]
  connection: { state: 'connecting' | 'open' | 'lost'; attempt: number }
  ready: boolean
  aiEnabled: boolean
  liveAi: boolean
  composerOpen: boolean
  toggleComposer: (open?: boolean) => void
  selectDrone: (id: string | null) => void
  setCameraMode: (mode: CameraMode) => void
  setRole: (role: Role) => void
  setAiEnabled: (on: boolean) => void
  setEmergency: (e: Emergency) => void
  setEmergencyPhase: (ms: number) => void
  setWeather: (w: Weather) => void
  setConnection: (c: { state: 'connecting' | 'open' | 'lost'; attempt: number }) => void
  applyHello: (frame: { missions: unknown[]; incidents: IncidentRecord[]; ai_enabled?: boolean; live_ai?: boolean; emergency?: Emergency; weather?: Weather; capabilities?: string[] }) => void
  pushEvent: (event: TimelineEvent) => void
  upsertMission: (mission: MissionRecord) => void
  upsertIncident: (incident: IncidentRecord) => void
  setFacts: (facts: FactPacket) => void
  setDecision: (decision: DecisionRecord | null) => void
  selectAlternative: (index: number | null) => void
  setApplying: (applying: boolean) => void
  setReplaceable: (missionId: string | null) => void
  openDrawer: (id: string) => void
  closeDrawer: () => void
  setFollow: (id: string | null) => void
  clearDecision: () => void
}

export type MissionRecord = { id: string; state: string; dest_id: string; origin_hub_id: string; payload_kind: string; priority: string; drone_id: string | null; eta_s: number | null }

export const useStore = create<Store>((set) => ({
  incidents: [],
  decisions: [],
  decision: null,
  facts: null,
  selectedAlternative: null,
  applying: false,
  missions: [],
  events: [],
  selectedDroneId: null,
  role: 'GOVERNMENT',
  emergency: null,
  emergencyPhase: 0,
  replaceableMission: null,
  drawerOpen: false,
  followDroneId: null,
  cameraMode: 'CITY',
  weather: null,
  capabilities: [],
  connection: { state: 'connecting', attempt: 0 },
  ready: false,
  aiEnabled: true,
  liveAi: false,
  composerOpen: false,
  toggleComposer: (open) => set((s) => ({ composerOpen: open ?? !s.composerOpen })),
  selectDrone: (id) => set({ selectedDroneId: id }),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setRole: (role) => set({ role }),
  setAiEnabled: (aiEnabled) => set({ aiEnabled }),
  setEmergency: (emergency) => set({ emergency, emergencyPhase: emergency ? 0 : 0 }),
  setEmergencyPhase: (emergencyPhase) => set({ emergencyPhase }),
  setWeather: (weather) => set({ weather }),
  setConnection: (connection) => set({ connection }),
  applyHello: (frame) => set({ ready: true, weather: frame.weather ?? null, capabilities: frame.capabilities ?? [], emergency: frame.emergency ?? null, emergencyPhase: frame.emergency ? 9999 : 0, aiEnabled: frame.ai_enabled ?? true, liveAi: frame.live_ai ?? false, missions: frame.missions, incidents: frame.incidents, decisions: [], decision: null, facts: null, selectedAlternative: null, applying: false, events: [] }),
  pushEvent: (event) =>
    set((s) => (s.events.some((e) => e.id === event.id) ? s : { events: [...s.events, event].slice(-120) })),
  upsertIncident: (incident) =>
    set((s) => {
      const open = !['RESOLVED', 'REJECTED', 'EXECUTED'].includes(incident.state)
      const rest = s.incidents.filter((i) => i.id !== incident.id)
      return { incidents: open ? [...rest, incident] : rest }
    }),
  setFacts: (facts) => set({ facts }),
  setDecision: (decision) =>
    set((s) => ({
      decision,
      decisions: decision ? [...s.decisions.filter((d) => d.id !== decision.id), decision] : s.decisions,
      selectedAlternative: decision
        ? decision.alternatives.findIndex(
            (a) =>
              a.kind === decision.recommended_action.kind &&
              a.params.route_id === decision.recommended_action.params.route_id &&
              a.params.landing_zone_id === decision.recommended_action.params.landing_zone_id &&
              a.params.target_alt === decision.recommended_action.params.target_alt,
          )
        : null,
    })),
  selectAlternative: (selectedAlternative) => set({ selectedAlternative }),
  setApplying: (applying) => set({ applying }),
  setReplaceable: (replaceableMission) => set({ replaceableMission }),
  openDrawer: (id) => set({ drawerOpen: true, selectedDroneId: id }),
  closeDrawer: () => set({ drawerOpen: false }),
  setFollow: (followDroneId) => set({ followDroneId, cameraMode: followDroneId ? 'DRONE' : 'CITY' }),
  clearDecision: () => set({ decision: null, facts: null, selectedAlternative: null, applying: false }),
  upsertMission: (mission) =>
    set((s) => {
      const list = s.missions as MissionRecord[]
      const i = list.findIndex((m) => m.id === mission.id)
      const next = i === -1 ? [...list, mission] : list.map((m) => (m.id === mission.id ? mission : m))
      return { missions: next.filter((m) => m.state !== 'COMPLETE') }
    }),
}))
