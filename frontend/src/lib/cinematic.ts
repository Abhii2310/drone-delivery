/**
 * UI-SPEC 2.5: only one cinematic moment may run at a time. An incident firing during an
 * emergency activation is realistic, so they queue rather than fight.
 */
type Job = { run: () => void; ms: number; label: string }

let queue: Job[] = []
let running = false

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function cinematic(label: string, ms: number, run: () => void): void {
  queue.push({ label, ms: reduced() ? 200 : ms, run })
  if (!running) drain()
}

function drain(): void {
  const job = queue.shift()
  if (!job) {
    running = false
    return
  }
  running = true
  job.run()
  setTimeout(drain, job.ms)
}

export const pending = (): number => queue.length
export const clearCinematics = (): void => {
  queue = []
}
