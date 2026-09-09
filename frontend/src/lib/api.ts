// In development the Vite proxy forwards /api and /ws to localhost:8000, so the base is
// empty and every call stays same-origin. In a deployed build the backend lives on another
// host entirely, and VITE_API_BASE carries its origin.
const RAW = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').trim().replace(/\/+$/, '')

export const apiBase = RAW
export const isRemote = RAW.length > 0

/** Absolute URL for a REST path. Pass paths that already begin with /api. */
export const api = (path: string): string => `${RAW}${path}`

/** Absolute URL for the telemetry socket, matching the page's security scheme. */
export function socketUrl(query: string): string {
  if (!RAW) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${location.host}/ws?${query}`
  }
  return `${RAW.replace(/^http/, 'ws')}/ws?${query}`
}
