export type ConflictPoint = { id: string; lng: number; lat: number; alt: number; severity: string }

let points: ConflictPoint[] = []

export const getConflictPoints = (): ConflictPoint[] => points
export const setConflictPoints = (next: ConflictPoint[]): void => {
  points = next
}
