import { api } from './api'
import { useStore } from '../store'
import { getInterpolated } from './telemetry'

export type KeyContext = {
  enterDroneView: (id: string) => void
  exitDroneView: () => void
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && /INPUT|SELECT|TEXTAREA/.test(t.tagName)

/** UI-SPEC 2.12. An ops console that cannot be driven from the keyboard reads as a mockup. */
export function handleKey(e: KeyboardEvent, ctx: KeyContext): void {
  if (isTyping(e.target)) return
  const s = useStore.getState()
  const ids = getInterpolated(performance.now()).map((d) => d.id).sort()
  const index = s.selectedDroneId ? ids.indexOf(s.selectedDroneId) : -1
  const step = (delta: number) => {
    if (!ids.length) return
    const next = ids[(index + delta + ids.length) % ids.length] ?? ids[0]
    s.selectDrone(next)
  }

  switch (e.key) {
    case '1':
      s.setFollow(null)
      ctx.exitDroneView()
      break
    case '2':
      s.setCameraMode('INCIDENT')
      break
    case '3':
    case 'f':
    case 'F': {
      const id = s.followDroneId ?? s.selectedDroneId
      if (id) ctx.enterDroneView(id)
      break
    }
    case 'ArrowUp':
      e.preventDefault()
      step(-1)
      break
    case 'ArrowDown':
      e.preventDefault()
      step(1)
      break
    case 'Enter':
      if (s.selectedDroneId) s.openDrawer(s.selectedDroneId)
      break
    case 'a':
    case 'A':
      if (s.decision && s.capabilities.includes('approve')) s.setPendingConfirm('approve')
      break
    case 'x':
    case 'X':
      if (s.decision) void fetch(api(`/api/decisions/${s.decision.id}/reject?role=${s.role}`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor: 'operator' }),
      })
      break
    case 'e':
    case 'E':
      if (s.capabilities.includes('emergency')) s.setPendingConfirm(s.emergency ? 'standdown' : 'emergency')
      break
    case ' ':
      e.preventDefault()
      void fetch(api('/api/pause'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paused: !s.paused }),
      })
      s.setPaused(!s.paused)
      break
    case 'k':
    case 'K':
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault()
        s.togglePalette()
      }
      break
    case 'Escape':
      if (s.pendingConfirm) s.setPendingConfirm(null)
      else if (s.paletteOpen) s.togglePalette()
      else if (s.followDroneId) {
        s.setFollow(null)
        ctx.exitDroneView()
      } else s.closeDrawer()
      break
    default:
      break
  }
}
