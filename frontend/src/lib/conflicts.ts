export type ConflictPoint = { id: string; lng: number; lat: number; alt: number; severity: string }

let points: ConflictPoint[] = []

export const getConflictPoints = (): ConflictPoint[] => points
export const setConflictPoints = (next: ConflictPoint[]): void => {
  points = next
}

export type LandingPulse = { id: string; lng: number; lat: number }

let landing: LandingPulse | null = null
export const getLandingPulse = (): LandingPulse | null => landing
export const setLandingPulse = (next: LandingPulse | null): void => {
  landing = next
}
