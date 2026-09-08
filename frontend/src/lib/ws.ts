export type HelloFrame = { t: 'hello'; rev: number; clock: number; city: any; drones: any[]; missions: any[]; incidents: any[] }
export type TickRow = [id: string, lng: number, lat: number, alt: number, heading: number, speed: number, battery: number, status: number]
export type TickFrame = { t: 'tick'; clock: number; d: TickRow[] }
export type EventFrame = { t: 'ev'; kind: string; payload: any }
export type Frame = HelloFrame | TickFrame | EventFrame

type Handler<T> = (frame: T) => void

const helloHandlers = new Set<Handler<HelloFrame>>()
const tickHandlers = new Set<Handler<TickFrame>>()
const eventHandlers = new Set<Handler<EventFrame>>()

export const onHello = (h: Handler<HelloFrame>) => (helloHandlers.add(h), () => helloHandlers.delete(h))
export const onTick = (h: Handler<TickFrame>) => (tickHandlers.add(h), () => tickHandlers.delete(h))
export const onEvent = (h: Handler<EventFrame>) => (eventHandlers.add(h), () => eventHandlers.delete(h))

const BACKOFF_MIN_MS = 500
const BACKOFF_MAX_MS = 8000
let socket: WebSocket | null = null
let backoff = BACKOFF_MIN_MS
let stopped = false

function url(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

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
  }
  ws.onmessage = (e) => dispatch(e.data as string)
  ws.onclose = () => {
    if (socket !== ws) return // superseded by a newer socket; do not reconnect
    socket = null
    if (stopped) return
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
