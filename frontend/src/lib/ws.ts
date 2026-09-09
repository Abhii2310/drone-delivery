import { socketUrl } from './api'
export type HelloFrame = { t: 'hello'; rev: number; clock: number; city: any; drones: any[]; routes: any[]; missions: any[]; incidents: any[] }
export type TickRow = [id: string, lng: number, lat: number, alt: number, heading: number, speed: number, battery: number, status: number]
export type TickFrame = { t: 'tick'; clock: number; d: TickRow[]; m?: [string, string, number | null][] }
export type EventFrame = { t: 'ev'; kind: string; payload: any }
export type Frame = HelloFrame | TickFrame | EventFrame

export type Viewer = { role: string; operator_id?: string; hub_id?: string; mission_id?: string }
export type Status = { state: 'connecting' | 'open' | 'lost'; attempt: number }

type Handler<T> = (frame: T) => void

const helloHandlers = new Set<Handler<HelloFrame>>()
const tickHandlers = new Set<Handler<TickFrame>>()
const eventHandlers = new Set<Handler<EventFrame>>()
const statusHandlers = new Set<Handler<Status>>()

export const onHello = (h: Handler<HelloFrame>) => (helloHandlers.add(h), () => helloHandlers.delete(h))
export const onTick = (h: Handler<TickFrame>) => (tickHandlers.add(h), () => tickHandlers.delete(h))
export const onEvent = (h: Handler<EventFrame>) => (eventHandlers.add(h), () => eventHandlers.delete(h))
export const onStatus = (h: Handler<Status>) => (statusHandlers.add(h), () => statusHandlers.delete(h))

const BACKOFF_MIN_MS = 500
const BACKOFF_MAX_MS = 8000
let socket: WebSocket | null = null
let backoff = BACKOFF_MIN_MS
let stopped = false
let attempt = 0
let viewer: Viewer = { role: 'GOVERNMENT' }

export const getViewer = (): Viewer => viewer

/** Role is carried on the socket itself, so the server filters what this client ever sees. */
export function setViewer(next: Viewer): void {
  viewer = next
  if (socket) {
    detach(socket)
    socket.close()
    socket = null
  }
  connect()
}

export function query(): string {
  const p = new URLSearchParams({ role: viewer.role })
  if (viewer.operator_id) p.set('operator_id', viewer.operator_id)
  if (viewer.hub_id) p.set('hub_id', viewer.hub_id)
  if (viewer.mission_id) p.set('mission_id', viewer.mission_id)
  return p.toString()
}

function url(): string {
  return socketUrl(query())
}

const status = (s: Status) => statusHandlers.forEach((h) => h(s))

function dispatch(raw: string) {
  const frame = JSON.parse(raw) as Frame
  if (frame.t === 'tick') tickHandlers.forEach((h) => h(frame))
  else if (frame.t === 'hello') helloHandlers.forEach((h) => h(frame))
  else if (frame.t === 'ev') eventHandlers.forEach((h) => h(frame))
  else console.warn('ws: unknown frame', frame)
}

function detach(ws: WebSocket): void {
  ws.onopen = null
  ws.onmessage = null
  ws.onclose = null
  ws.onerror = null
}

export function connect(): void {
  stopped = false
  if (socket && socket.readyState <= WebSocket.OPEN) return
  const ws = new WebSocket(url())
  socket = ws
  ws.onopen = () => {
    backoff = BACKOFF_MIN_MS
    attempt = 0
    status({ state: 'open', attempt: 0 })
  }
  ws.onmessage = (e) => dispatch(e.data as string)
  ws.onclose = () => {
    if (socket !== ws) return // superseded by a newer socket; do not reconnect
    socket = null
    if (stopped) return
    attempt += 1
    status({ state: 'lost', attempt })
    setTimeout(connect, backoff)
    backoff = Math.min(BACKOFF_MAX_MS, backoff * 2)
  }
  ws.onerror = () => ws.close()
}

export function disconnect(): void {
  stopped = true
  if (!socket) return
  detach(socket)
  socket.close()
  socket = null
}
