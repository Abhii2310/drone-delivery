import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  CORRIDORS, HERO_DRONE, ROLE_SCOPE, SITES, ZONES, armConflict, clearIncident, divert, fmtClock,
  nextIncident, record, resolveConflict, setEmergency, visibleDrones, world,
  type Drone, type MissionKind, type Role,
} from './sim'
import { getSnapshot, sceneReady, setFocus, setIntensity, setMode, subscribe, type SceneMode } from './scene'
import OnboardFeed, { FEED_ATTRIBUTION } from '@/components/ui/scroll-locked-video-hero'

export const COMMAND_URL = '/signin'

// ── primitives ───────────────────────────────────────────────────────────────
export const useWorld = () => useSyncExternalStore(subscribe, getSnapshot)

// which story beat owns the viewport, for the chapter rail and the progress line
let activeId = 'hero'
const activeListeners = new Set<() => void>()
const setActive = (id: string) => {
  if (id === activeId) return
  activeId = id
  activeListeners.forEach((fn) => fn())
}
const useActive = () => useSyncExternalStore((fn) => { activeListeners.add(fn); return () => { activeListeners.delete(fn) } }, () => activeId)

export const CHAPTERS: [string, string][] = [
  ['hero', 'Airspace'], ['climb', 'The city'], ['ops', 'Operations'], ['drone', 'Drone view'], ['feed', 'Onboard'],
  ['intelligence', 'Coordination'], ['incidents', 'Incidents'], ['emergency', 'Emergency'], ['government', 'Command'],
  ['landing', 'Way home'], ['ask', 'Ask the grid'], ['accountability', 'Accountability'], ['audience', 'Who it is for'],
  ['network', 'The network'], ['finale', 'Coordinated'],
]

type SectionProps = {
  id: string
  mode: SceneMode
  intensity?: number
  tall?: boolean
  className?: string
  onEnter?: () => void
  onLeave?: () => void
  children: ReactNode
}

/** A story beat. Crossing the middle of the viewport hands the camera to this section. */
export function Section({ id, mode, intensity = 1, tall, className = '', onEnter, onLeave, children }: SectionProps) {
  const ref = useRef<HTMLElement>(null)
  const enter = useRef(onEnter)
  const leave = useRef(onLeave)
  enter.current = onEnter
  leave.current = onLeave
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let active = false
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !active) {
          active = true
          setMode(mode)
          setIntensity(intensity)
          setActive(id)
          enter.current?.()
        } else if (!e.isIntersecting && active) {
          active = false
          leave.current?.()
        }
      },
      { rootMargin: '-46% 0px -46% 0px', threshold: 0 },
    )
    io.observe(el)
    const reveal = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && (e.target as HTMLElement).setAttribute('data-in', 'true')),
      { rootMargin: '0px 0px -12% 0px' },
    )
    el.querySelectorAll('.sg-reveal').forEach((n) => reveal.observe(n))
    return () => {
      io.disconnect()
      reveal.disconnect()
    }
  }, [mode, intensity, id])
  return (
    <section ref={ref} id={id} className={`sg-section ${tall ? 'sg-section--tall' : ''} ${className}`}>
      {children}
    </section>
  )
}

const Eyebrow = ({ children, dim }: { children: ReactNode; dim?: boolean }) => (
  <div className={`sg-eyebrow ${dim ? 'sg-eyebrow--dim' : ''} sg-reveal`}>{children}</div>
)
const H = ({ children, small }: { children: ReactNode; small?: boolean }) => (
  <h2 className={`sg-h ${small ? 'sg-h--sm' : ''} sg-reveal mt-5`}>{children}</h2>
)
const Lede = ({ children }: { children: ReactNode }) => <p className="sg-lede sg-reveal mt-7">{children}</p>

function Kv({ k, v, tone }: { k: string; v: ReactNode; tone?: 'cyan' | 'amber' | 'red' | 'dim' }) {
  const color = tone === 'cyan' ? 'var(--cyan)' : tone === 'amber' ? 'var(--amber)' : tone === 'red' ? 'var(--red)' : tone === 'dim' ? 'var(--text-dim)' : 'var(--text)'
  return (
    <div className="flex items-baseline justify-between gap-6 py-2" style={{ borderBottom: '1px solid var(--edge-soft)' }}>
      <span className="sg-mono sg-faint">{k}</span>
      <span className="sg-mono" style={{ color }}>{v}</span>
    </div>
  )
}

function Big({ n, label, tone }: { n: string; label: string; tone?: 'cyan' | 'amber' | 'red' }) {
  const color = tone === 'cyan' ? 'var(--cyan)' : tone === 'amber' ? 'var(--amber)' : tone === 'red' ? 'var(--red)' : 'var(--text)'
  return (
    <div>
      <div className="sg-mono-lg" style={{ color }}>{n}</div>
      <div className="sg-mono sg-faint mt-2">{label}</div>
    </div>
  )
}

const Arrow = () => <span aria-hidden>→</span>

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

// ── boot, progress, chapters ─────────────────────────────────────────────────
const BOOT_LINES = ['CITY MODEL · 1,400 STRUCTURES', 'CORRIDORS · 8 · CEILINGS SET', 'AIRCRAFT · 24 ONLINE', 'GRID READY']

/** A short boot sequence that holds until the scene has drawn, then gets out of the way. */
export function Boot() {
  const [lines, setLines] = useState(0)
  const [gone, setGone] = useState(false)
  const [fading, setFading] = useState(false)
  useEffect(() => {
    const t = setInterval(() => setLines((n) => Math.min(BOOT_LINES.length, n + 1)), 260)
    const check = setInterval(() => {
      if (lines >= BOOT_LINES.length && sceneReady()) {
        setFading(true)
        setTimeout(() => setGone(true), 700)
        clearInterval(check)
      }
    }, 120)
    return () => { clearInterval(t); clearInterval(check) }
  }, [lines])
  if (gone) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-end" style={{ background: 'var(--void)', opacity: fading ? 0 : 1, transition: 'opacity 700ms var(--ease-out)', pointerEvents: fading ? 'none' : 'auto' }}>
      <div className="p-8 md:p-12">
        <div style={{ font: '600 15px/1 var(--font-ui)', letterSpacing: '0.3em' }}>SKYGRID</div>
        <div className="sg-mono sg-faint mt-3">INITIALISING SECTOR BLR-C</div>
        <div className="mt-6">
          {BOOT_LINES.slice(0, lines).map((l, i) => (
            <div key={l} className="sg-mono py-1" style={{ color: i === BOOT_LINES.length - 1 ? 'var(--cyan)' : 'var(--text-dim)' }}>▸ {l}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function Progress() {
  const [p, setP] = useState(0)
  useEffect(() => {
    const on = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      setP(max > 0 ? window.scrollY / max : 0)
    }
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  return <div className="fixed top-0 left-0 z-50 h-px" style={{ width: `${p * 100}%`, background: 'var(--cyan)', boxShadow: '0 0 8px var(--cyan)', transition: 'width 120ms linear' }} />
}

export function Chapters() {
  const active = useActive()
  return (
    <nav aria-label="Chapters" className="sg-desktop-only fixed top-1/2 right-4 z-40 -translate-y-1/2">
      {CHAPTERS.map(([id, label], i) => {
        const on = id === active
        return (
          <button
            key={id}
            type="button"
            onClick={() => scrollTo(id)}
            title={label}
            className="group flex items-center justify-end gap-3 py-[5px]"
            style={{ background: 'none', border: 0, cursor: 'pointer', color: on ? 'var(--cyan)' : 'var(--text-faint)' }}
          >
            <span className="sg-mono opacity-0 transition-opacity group-hover:opacity-100" style={{ fontSize: 9.5 }}>{label.toUpperCase()}</span>
            <span className="sg-mono" style={{ fontSize: 9.5, width: 18, textAlign: 'right' }}>{(i + 1).toString().padStart(2, '0')}</span>
            <span style={{ width: on ? 18 : 8, height: 1, background: 'currentColor', transition: 'width 300ms var(--ease-out)' }} />
          </button>
        )
      })}
    </nav>
  )
}

// ── 00 nav ───────────────────────────────────────────────────────────────────
export function Nav() {
  const [solid, setSolid] = useState(false)
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 40)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  return (
    <header
      className="fixed top-0 right-0 left-0 z-40 flex items-center justify-between px-6 md:px-10"
      style={{
        height: 64,
        borderBottom: `1px solid ${solid ? 'var(--edge)' : 'transparent'}`,
        background: solid ? 'rgba(4, 7, 12, 0.72)' : 'transparent',
        backdropFilter: solid ? 'blur(14px)' : 'none',
        transition: 'background 320ms var(--ease-out), border-color 320ms var(--ease-out)',
      }}
    >
      <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-3" style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--text)' }}>
        <span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, border: '1.5px solid var(--cyan)', transform: 'rotate(45deg)' }} />
        <span style={{ font: '600 15px/1 var(--font-ui)', letterSpacing: '0.26em' }}>SKYGRID</span>
      </button>
      <nav className="sg-desktop-only flex items-center gap-9">
        <button type="button" className="sg-navlink" onClick={() => scrollTo('ops')}>Platform</button>
        <button type="button" className="sg-navlink" onClick={() => scrollTo('audience')}>Solutions</button>
        <button type="button" className="sg-navlink" onClick={() => scrollTo('emergency')}>Emergency</button>
        <button type="button" className="sg-navlink" onClick={() => scrollTo('intelligence')}>Technology</button>
      </nav>
      <a href={COMMAND_URL} className="sg-cta sg-cta--ghost" style={{ padding: '11px 16px' }}>
        <span className="sg-desktop-only">Enter command center</span>
        <span className="sg-mobile-only">Command</span>
        <Arrow />
      </a>
    </header>
  )
}

// ── 01 hero ──────────────────────────────────────────────────────────────────
export function Hero() {
  const w = useWorld()
  const inSector = w.drones.filter((d) => d.status !== 'IDLE').length
  const missions = 24 + (w.emergency ? 3 : 0)
  return (
    <Section id="hero" mode="HERO" intensity={1} className="!items-end pb-16 md:pb-24">
      <div className="w-full">
        <div className="grid gap-10 md:grid-cols-12 md:items-end">
          <div className="md:col-span-8">
            <Eyebrow>Command layer · Low-altitude operations</Eyebrow>
            <div className="sg-mono sg-faint sg-reveal mt-2">12.9716° N · 77.5946° E · BENGALURU · SECTOR BLR-C</div>
            <h1 className="sg-h sg-reveal mt-6" style={{ fontSize: 'clamp(44px, min(9.2vw, 13.5vh), 150px)' }}>
              The city<br />has a new<br />airspace.
            </h1>
            <p className="sg-lede sg-reveal mt-8">
              One intelligent command layer for autonomous aerial operations, emergency response and city-scale logistics.
            </p>
            <div className="sg-reveal mt-10 flex flex-wrap items-center gap-4">
              <a href={COMMAND_URL} className="sg-cta">Enter command center <Arrow /></a>
              <button type="button" className="sg-cta sg-cta--ghost" onClick={() => scrollTo('climb')}>Explore the grid <span aria-hidden>↓</span></button>
            </div>
          </div>
          <div className="md:col-span-4 md:justify-self-end">
            <div className="sg-panel sg-reveal px-5 py-4" style={{ minWidth: 268 }}>
              <div className="flex items-center gap-2.5">
                <span className={`sg-live ${w.emergency ? 'sg-live--red' : ''}`} />
                <span className="sg-mono" style={{ color: w.emergency ? 'var(--red)' : 'var(--cyan)' }}>
                  SKYGRID NETWORK {w.emergency ? 'EMERGENCY' : 'ONLINE'}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-4">
                <Big n={(103 + inSector).toString()} label="AIRCRAFT" />
                <Big n={missions.toString().padStart(2, '0')} label="ACTIVE MISSIONS" />
                <Big n={`${w.health.toFixed(1)}%`} label="NETWORK HEALTH" tone={w.health < 97 ? 'amber' : undefined} />
              </div>
              <div className="sg-mono sg-faint mt-4 flex justify-between">
                <span>SECTOR BLR-C · {inSector} IN VIEW</span>
                <span>T+{fmtClock(w.clock)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}

// ── 02 the city becomes 3D ───────────────────────────────────────────────────
const LAYERS = [
  { beat: 'STREET', k: 'STREET LEVEL', v: '0 M', note: 'Traffic. People. The city everyone already maps.' },
  { beat: 'ROOFTOP', k: 'ROOFTOPS', v: '40–160 M', note: 'Where the buildings end and the operating volume begins.' },
  { beat: 'CORRIDOR', k: 'DELIVERY CORRIDOR', v: '120 M', note: 'Routine missions hold a corridor and a ceiling.' },
  { beat: 'CORRIDOR', k: 'EMERGENCY CORRIDOR', v: '160 M', note: 'Reserved altitude. Critical priority only.' },
  { beat: 'CORRIDOR', k: 'RESTRICTED ZONE', v: 'NO ENTRY', note: 'State complex. Ceiling 200 m. Nothing routes through it.' },
  { beat: 'OPS', k: 'LANDING LOCATIONS', v: '12 APPROVED', note: 'Every aircraft is always within reach of one.' },
] as const

function Beat({ mode, onEnter }: { mode: SceneMode; onEnter: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setMode(mode); onEnter() } }, { rootMargin: '-48% 0px -48% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [mode, onEnter])
  return <div ref={ref} style={{ height: '70svh' }} />
}

export function Climb() {
  const [beat, setBeat] = useState<string>('STREET')
  return (
    <Section id="climb" mode="STREET" tall intensity={1}>
      <div className="grid w-full gap-12 md:grid-cols-12">
        <div className="md:col-span-7">
          <div className="sg-sticky">
            <Eyebrow>02 · The city becomes 3D</Eyebrow>
            <H>The city<br />isn't flat.</H>
            <H small>Neither is its airspace.</H>
            <Lede>
              Street level, rooftops, corridors, ceilings. SkyGrid treats the volume above a city as infrastructure, with the same
              rules, rights of way and no-go areas the ground already has.
            </Lede>
          </div>
          <div className="sg-desktop-only">
            <Beat mode="STREET" onEnter={() => setBeat('STREET')} />
            <Beat mode="ROOFTOP" onEnter={() => setBeat('ROOFTOP')} />
            <Beat mode="CORRIDOR" onEnter={() => setBeat('CORRIDOR')} />
            <Beat mode="OPS" onEnter={() => setBeat('OPS')} />
          </div>
        </div>
        <div className="md:col-span-4 md:col-start-9">
          <div className="sg-sticky sg-panel sg-reveal p-5">
            <div className="sg-mono sg-faint mb-3">ALTITUDE LADDER · SECTOR BLR-C</div>
            {LAYERS.map((l) => {
              const on = l.beat === beat
              return (
                <div key={l.k} className="py-3" style={{ borderTop: '1px solid var(--edge-soft)', opacity: on ? 1 : 0.5, transition: 'opacity 400ms var(--ease-out)' }}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="sg-mono" style={{ color: on ? 'var(--cyan)' : 'var(--text)' }}>{l.k}</span>
                    <span className="sg-mono" style={{ color: l.v === 'NO ENTRY' ? 'var(--amber)' : 'var(--text-dim)' }}>{l.v}</span>
                  </div>
                  {on && <div className="sg-dim mt-1.5 text-[12.5px]">{l.note}</div>}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Section>
  )
}

// ── 03 live operations ───────────────────────────────────────────────────────
const MISSION_TONE: Record<MissionKind, string> = {
  MEDICAL: '#56D6EC', COMMERCE: '#9EB0C6', INDUSTRIAL: '#C8A860', RESCUE: '#E8A93C', EMERGENCY: '#E0452F',
}

function FleetRow({ d, on, onPick }: { d: Drone; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="grid w-full grid-cols-[62px_1fr_auto] items-center gap-3 px-3 py-2 text-left"
      style={{
        background: on ? 'rgba(53,214,240,0.08)' : 'transparent',
        borderLeft: `2px solid ${on ? 'var(--cyan)' : MISSION_TONE[d.mission]}`,
        borderBottom: '1px solid var(--edge-soft)', cursor: 'pointer', color: 'var(--text)',
      }}
    >
      <span className="sg-mono" style={{ color: on ? 'var(--cyan)' : 'var(--text)' }}>{d.id}</span>
      <span className="sg-mono sg-dim truncate">
        {Math.round(d.alt).toString().padStart(3, '0')} M · {Math.round(d.speed * 3.6)} KM/H · {Math.round(d.battery)}%
      </span>
      <span className="sg-mono" style={{ color: MISSION_TONE[d.mission], fontSize: 10 }}>{d.mission}</span>
    </button>
  )
}

export function Ops() {
  const w = useWorld()
  const focused = w.drones.find((d) => d.id === w.focus)
  const counts = w.drones.reduce<Record<string, number>>((m, d) => ((m[d.mission] = (m[d.mission] ?? 0) + 1), m), {})
  return (
    <Section id="ops" mode="OPS" intensity={1}>
      <div className="grid w-full gap-10 md:grid-cols-12">
        <div className="md:col-span-5">
          <Eyebrow>03 · Live operations</Eyebrow>
          <H>Every drone.<br />One grid.</H>
          <Lede>
            Twenty-four aircraft in this sector, each with a mission, a priority, a corridor and a battery the grid is watching.
            Select one. The camera goes to it. Drag the city to look around.
          </Lede>
          <div className="sg-reveal mt-8 flex flex-wrap gap-x-6 gap-y-2">
            {(['MEDICAL', 'INDUSTRIAL', 'COMMERCE', 'EMERGENCY', 'RESCUE'] as MissionKind[]).map((m) => (
              <span key={m} className="sg-mono flex items-center gap-2">
                <span style={{ width: 8, height: 2, background: MISSION_TONE[m], display: 'inline-block' }} />
                <span style={{ color: 'var(--text-dim)' }}>{m}</span>
                <span style={{ color: 'var(--text-faint)' }}>{(counts[m] ?? 0).toString().padStart(2, '0')}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="md:col-span-6 md:col-start-7">
          <div className="sg-panel sg-reveal">
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--edge)' }}>
              <span className="sg-mono" style={{ color: 'var(--cyan)' }}>LIVE OPERATIONS</span>
              <span className="sg-mono sg-faint">4 HZ · SIMULATED</span>
            </div>
            <div className="grid grid-cols-4 gap-4 px-4 py-4">
              <Big n={(103 + w.drones.length).toString()} label="AIRCRAFT" />
              <Big n="84" label="ACTIVE MISSIONS" />
              <Big n={SITES.length.toString()} label="HUBS" />
              <Big n={(w.incidentId ? 8 : 7).toString().padStart(2, '0')} label="INCIDENTS" tone="amber" />
            </div>
            <div className="sg-hair" />
            <div style={{ maxHeight: 268, overflowY: 'auto' }}>
              {w.drones.map((d) => (
                <FleetRow key={d.id} d={d} on={d.id === w.focus} onPick={() => setFocus(d.id)} />
              ))}
            </div>
            {focused && (
              <div className="px-4 py-3" style={{ borderTop: '1px solid var(--edge)', background: 'rgba(53,214,240,0.04)' }}>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="sg-mono" style={{ color: 'var(--cyan)' }}>{focused.id} · {focused.status.replace('_', ' ')}</span>
                  <span className="sg-mono sg-dim">{focused.operator} · {focused.homeHub} → {focused.destination}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Section>
  )
}

// ── 04 view from drone ───────────────────────────────────────────────────────
export function DroneView() {
  const w = useWorld()
  const inView = w.mode === 'DRONE'
  const enter = () => { setFocus(HERO_DRONE); setMode('DRONE'); setIntensity(1) }
  const exit = () => { setMode('OPS') }
  return (
    <Section id="drone" mode="OPS" intensity={1}>
      <div className="grid w-full gap-10 md:grid-cols-12">
        <div className="md:col-span-7">
          <Eyebrow>04 · View from drone</Eyebrow>
          <H>Don't watch<br />the mission.</H>
          <H small>Enter it.</H>
          <Lede>
            The camera drops into {HERO_DRONE}'s nose. The route, the corridor ceiling and the destination are in the frame with
            the buildings, because that is what the aircraft is reasoning about.
          </Lede>
          <div className="sg-reveal mt-9 flex flex-wrap gap-4">
            <button type="button" className="sg-cta" onClick={enter}>View from drone <Arrow /></button>
            <span className="sg-mono sg-faint self-center">SCROLL OR PRESS ESC TO LEAVE</span>
          </div>
        </div>
      </div>
      {inView && <DroneHud onExit={exit} />}
    </Section>
  )
}

function DroneHud({ onExit }: { onExit: () => void }) {
  const w = useWorld()
  const d = w.drones.find((x) => x.id === (w.focus ?? HERO_DRONE))
  const [eta, setEta] = useState(222)
  useEffect(() => {
    const t = setInterval(() => setEta((e) => (e > 0 ? e - 1 : 0)), 1000)
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onExit() }
    window.addEventListener('keydown', key)
    return () => { clearInterval(t); window.removeEventListener('keydown', key) }
  }, [onExit])
  if (!d) return null
  const mission = d.mission === 'MEDICAL' ? 'MEDICAL DELIVERY' : d.mission === 'EMERGENCY' ? 'EMERGENCY SUPPLY' : `${d.mission} DELIVERY`
  return (
    <div className="pointer-events-none fixed inset-0 z-30">
      {/* reticle and frame lines: a camera, not a dashboard */}
      <div className="absolute inset-x-[6%] inset-y-[14%]" style={{ border: '1px solid rgba(53,214,240,0.22)' }} />
      <div className="absolute top-1/2 left-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2" style={{ border: '1px solid rgba(53,214,240,0.6)' }} />
      <div className="absolute top-1/2 left-1/2 h-px w-24 -translate-x-1/2" style={{ background: 'rgba(53,214,240,0.35)' }} />
      <div className="absolute top-[18%] left-[8%]">
        <div className="sg-mono" style={{ color: 'var(--cyan)' }}>● LIVE FEED · {d.id}</div>
        <div className="sg-mono-lg mt-3" style={{ color: 'var(--text)' }}>{d.id}</div>
        <div className="mt-4 grid grid-cols-3 gap-6">
          <Big n={`${Math.round(d.alt)}M`} label="ALT" />
          <Big n={`${Math.round(d.speed * 3.6)}`} label="SPD KM/H" />
          <Big n={`${Math.round(d.battery)}%`} label="BAT" tone={d.battery < 30 ? 'amber' : undefined} />
        </div>
      </div>
      <div className="absolute right-[8%] bottom-[18%] text-right">
        <div className="sg-mono sg-faint">MISSION</div>
        <div className="sg-mono mt-1" style={{ color: 'var(--text)' }}>{mission}</div>
        <div className="sg-mono sg-faint mt-4">ETA</div>
        <div className="sg-mono-lg mt-1" style={{ color: 'var(--cyan)' }}>{fmtClock(eta)}</div>
        <div className="sg-mono sg-faint mt-4">DEST {d.destination} · HDG {Math.round((d.heading + 360) % 360).toString().padStart(3, '0')}</div>
      </div>
      <div className="absolute bottom-[8%] left-1/2 -translate-x-1/2">
        <button type="button" className="sg-cta sg-cta--ghost pointer-events-auto" onClick={onExit}>Exit drone view</button>
      </div>
    </div>
  )
}

// ── 04b onboard camera ───────────────────────────────────────────────────────
export function LiveFeed() {
  return (
    <Section id="feed" mode="ROOFTOP" intensity={0.8}>
      <div className="grid w-full items-center gap-12 md:grid-cols-12">
        <div className="md:col-span-5">
          <Eyebrow>04b · Onboard camera</Eyebrow>
          <H>Every flight,<br />recorded.</H>
          <Lede>
            Each aircraft streams its nose camera to the grid and every frame is retained against the mission. Scroll the
            screen to move between feeds. The city behind it follows whichever aircraft you land on.
          </Lede>
          <div className="sg-reveal mt-8">
            <Kv k="FEEDS ON GRID" v="12 LIVE · 112 ARCHIVED" tone="cyan" />
            <Kv k="RETENTION" v="90 DAYS · INCIDENTS INDEFINITE" tone="dim" />
            <Kv k="ACCESS" v="OPERATOR · OWN FLEET ONLY" tone="dim" />
          </div>
          <div className="sg-mono sg-faint sg-reveal mt-6" style={{ maxWidth: '44ch', lineHeight: 1.6 }}>
            {FEED_ATTRIBUTION}. Licensed footage stands in for a live downlink in this prototype.
          </div>
        </div>
        <div className="sg-desktop-only md:col-span-6 md:col-start-7 flex justify-center py-6">
          <OnboardFeed onSelect={(f) => f.droneId && setFocus(f.droneId)} />
        </div>
        <div className="sg-mobile-only">
          <OnboardFeed onSelect={(f) => f.droneId && setFocus(f.droneId)} />
        </div>
      </div>
    </Section>
  )
}

// ── 05 flight intelligence ───────────────────────────────────────────────────
export function Intelligence() {
  const w = useWorld()
  useEffect(() => {
    // the grid resolves it itself at six seconds; the button lets a visitor do it sooner
    if (world.conflict && !w.conflictResolved && w.conflictSeconds <= 6) resolveConflict()
  }, [w.conflictSeconds, w.conflictResolved])
  const enter = () => { armConflict(); setFocus('D-104') }
  const resolved = w.conflictResolved
  const secs = Math.ceil(w.conflictSeconds)
  return (
    <Section id="intelligence" mode="CONFLICT" intensity={1} onEnter={enter}>
      <div className="grid w-full gap-10 md:grid-cols-12">
        <div className="md:col-span-6">
          <Eyebrow>05 · Flight intelligence</Eyebrow>
          <H>Flight is easy.</H>
          <H small>Coordination is hard.</H>
          <Lede>
            SkyGrid continuously understands position, altitude, mission priority and operating zones to coordinate the
            network. Two aircraft on crossing corridors are predicted to close inside the minimum. The lower priority yields
            vertically. Then the geometry is re-run to prove it cleared.
          </Lede>
          <div className="sg-mono sg-faint sg-reveal mt-6">PROTOTYPE SIMULATION · NOT CONNECTED TO LIVE AIRCRAFT</div>
        </div>
        <div className="md:col-span-5 md:col-start-8">
          <div className="sg-panel sg-reveal p-5">
            <div className="flex items-center gap-2.5">
              <span className={`sg-live ${resolved ? '' : 'sg-live--red'}`} />
              <span className="sg-mono" style={{ color: resolved ? 'var(--cyan)' : 'var(--red)' }}>
                {resolved ? 'SEPARATION VERIFIED' : 'CONFLICT PREDICTED'}
              </span>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-6">
              <Big n={resolved ? '31.4 M' : '8.3 M'} label="PREDICTED SEPARATION" tone={resolved ? 'cyan' : 'red'} />
              <Big n={resolved ? 'CLEAR' : `${secs} S`} label={resolved ? 'STATUS' : 'TO CLOSEST APPROACH'} tone={resolved ? 'cyan' : 'red'} />
            </div>
            <div className="mt-5">
              <Kv k="PAIR" v="D-104 × D-109" />
              <Kv k="CORRIDORS" v={`${CORRIDORS[4].label.split(' · ')[0]} × ${CORRIDORS[5].label.split(' · ')[0]}`} tone="dim" />
              <Kv k="MINIMUM" v="15 M" tone="dim" />
              <Kv k="RESOLUTION" v={resolved ? 'D-104 DESCENDED 30 M' : 'D-104 YIELDS · ROUTINE < ELEVATED'} tone={resolved ? 'cyan' : 'amber'} />
            </div>
            <RouteDiagram resolved={resolved} />
            {!resolved && (
              <button type="button" className="sg-cta mt-5 w-full justify-center" onClick={resolveConflict}>Apply vertical separation</button>
            )}
          </div>
        </div>
      </div>
    </Section>
  )
}

function RouteDiagram({ resolved }: { resolved: boolean }) {
  return (
    <svg viewBox="0 0 320 96" className="mt-5 w-full" style={{ display: 'block' }}>
      <text x="0" y="10" fill="var(--text-faint)" fontFamily="IBM Plex Mono" fontSize="8">ALT 140 M</text>
      <text x="0" y="86" fill="var(--text-faint)" fontFamily="IBM Plex Mono" fontSize="8">ALT 110 M</text>
      <line x1="60" y1="16" x2="320" y2="16" stroke="var(--edge)" strokeDasharray="2 3" />
      <line x1="60" y1="80" x2="320" y2="80" stroke="var(--edge)" strokeDasharray="2 3" />
      <path d="M60 16 H 320" stroke="#9EB0C6" strokeWidth="1.5" fill="none" />
      <text x="300" y="12" fill="#9EB0C6" fontFamily="IBM Plex Mono" fontSize="8" textAnchor="end">D-109</text>
      <path
        d={resolved ? 'M60 16 C 140 16, 150 80, 210 80 H 320' : 'M60 16 H 320'}
        stroke={resolved ? 'var(--cyan)' : 'var(--red)'}
        strokeWidth="1.5"
        fill="none"
        style={{ transition: 'd 900ms var(--ease-out), stroke 400ms' }}
      />
      <text x="300" y={resolved ? 76 : 26} fill={resolved ? 'var(--cyan)' : 'var(--red)'} fontFamily="IBM Plex Mono" fontSize="8" textAnchor="end">D-104</text>
      {!resolved && <circle cx="190" cy="16" r="6" fill="none" stroke="var(--red)" strokeWidth="1"><animate attributeName="r" values="4;9;4" dur="1.4s" repeatCount="indefinite" /></circle>}
    </svg>
  )
}

// ── 06 incident management ───────────────────────────────────────────────────
const INCIDENT_LABEL: Record<string, string> = {
  GPS_FAILURE: 'GPS LOSS', COMMUNICATION_LOSS: 'COMMUNICATION LOSS', LOW_BATTERY: 'LOW BATTERY', ALTITUDE_VIOLATION: 'ALTITUDE VIOLATION',
  WEATHER: 'WEATHER', ZONE_CLOSURE: 'AIRSPACE CLOSURE', COLLISION_RISK: 'DRONE CONFLICT', LANDING_ZONE_UNAVAILABLE: 'SKYPORT UNAVAILABLE',
}

export function Incidents() {
  const w = useWorld()
  const [inc, setInc] = useState(world.incident)
  useEffect(() => {
    if (!w.incidentId) return
    setInc(world.incident)
  }, [w.incidentId])
  const timer = useRef(0)
  const enter = () => {
    setInc(nextIncident())
    timer.current = window.setInterval(() => setInc(nextIncident()), 5200)
  }
  const leave = () => {
    clearInterval(timer.current)
    clearIncident()
  }
  const sev = inc?.severity ?? 'HIGH'
  const tone = sev === 'CRITICAL' ? 'var(--red)' : sev === 'HIGH' ? 'var(--amber)' : 'var(--cyan)'
  return (
    <Section id="incidents" mode="INCIDENT" intensity={1} onEnter={enter} onLeave={leave}>
      <div className="grid w-full gap-10 md:grid-cols-12">
        <div className="md:col-span-5">
          <Eyebrow>06 · Incident management</Eyebrow>
          <H>We designed<br />for the 1%.</H>
          <Lede>
            Most flights are uneventful. The network is built for the ones that are not. When an aircraft degrades, the grid
            names the problem, ranks the response and moves the traffic around it.
          </Lede>
          <div className="sg-reveal mt-8 grid grid-cols-2 gap-x-6">
            {Object.entries(INCIDENT_LABEL).map(([k, label]) => {
              const on = inc?.kind === k
              return (
                <div key={k} className="sg-mono py-1.5" style={{ color: on ? tone : 'var(--text-faint)', transition: 'color 300ms' }}>
                  {on ? '▸ ' : '  '}{label}
                </div>
              )
            })}
          </div>
        </div>
        <div className="md:col-span-5 md:col-start-8">
          {inc && (
            <div className="sg-panel sg-reveal p-5" style={{ borderColor: tone, boxShadow: `0 0 0 1px ${tone}22, 0 30px 80px rgba(0,0,0,0.5)` }}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2.5">
                  <span className={`sg-live ${sev === 'CRITICAL' ? 'sg-live--red' : 'sg-live--amber'}`} />
                  <span className="sg-mono" style={{ color: tone }}>INCIDENT DETECTED · {inc.id}</span>
                </span>
                <span className="sg-mono sg-faint">T+{fmtClock(inc.at)}</span>
              </div>
              <div className="mt-5 flex items-baseline gap-4">
                <span className="sg-mono-lg">{inc.droneId}</span>
                <span className="sg-mono" style={{ color: tone }}>{INCIDENT_LABEL[inc.kind]}</span>
              </div>
              <div className="mt-4">
                <Kv k="RISK" v={sev} tone={sev === 'CRITICAL' ? 'red' : sev === 'HIGH' ? 'amber' : 'cyan'} />
                {inc.detail.map(([k, v]) => <Kv key={k} k={k} v={v} />)}
                <Kv k="AFFECTED MISSIONS" v={inc.affectedMissions.toString().padStart(2, '0')} tone="dim" />
              </div>
              <div className="mt-5">
                <div className="sg-mono sg-faint">RECOMMENDED ACTION</div>
                <div className="mt-1.5" style={{ font: '600 16px/1.25 var(--font-ui)', letterSpacing: '0.03em' }}>{inc.recommendedAction}</div>
              </div>
              <div className="sg-mono sg-faint mt-4">NEARBY AIRCRAFT ADJUSTING · 3 ROUTES RECOMPUTED</div>
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}

// ── 07 emergency mode ────────────────────────────────────────────────────────
export function Emergency() {
  const w = useWorld()
  const on = w.emergency
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (!on) { setShown(0); return }
    const t1 = setTimeout(() => setShown(1), 700)
    const t2 = setTimeout(() => setShown(2), 1400)
    const t3 = setTimeout(() => setShown(3), 2100)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [on])
  useEffect(() => {
    document.body.classList.toggle('sg-emergency', on)
    return () => document.body.classList.remove('sg-emergency')
  }, [on])
  return (
    <Section id="emergency" mode="EMERGENCY" intensity={1}>
      <div className="grid w-full gap-10 md:grid-cols-12">
        <div className="md:col-span-7">
          <Eyebrow>07 · Emergency mode</Eyebrow>
          <H>When the city<br />goes down,</H>
          <H>SkyGrid<br />goes up.</H>
          <Lede>
            A flood closes roads across South Bengaluru. One command re-prioritises the network: routine missions stand back,
            emergency corridors open, the nearest capable aircraft are assigned and dispatched.
          </Lede>
          <div className="sg-reveal mt-9 flex flex-wrap gap-4">
            {!on ? (
              <button type="button" className="sg-cta sg-cta--alarm" onClick={() => { setEmergency(true); record('GOV-ADMIN', 'ACTIVATE EMERGENCY · ZONE-C') }}>
                Activate emergency mode
              </button>
            ) : (
              <button type="button" className="sg-cta sg-cta--ghost" onClick={() => { setEmergency(false); record('GOV-ADMIN', 'STAND DOWN · ZONE-C') }}>
                Stand down
              </button>
            )}
          </div>
        </div>
        <div className="md:col-span-4 md:col-start-9">
          <div className="sg-panel sg-reveal p-5" style={{ borderColor: on ? 'var(--red)' : 'var(--edge)', transition: 'border-color 400ms' }}>
            <div className="flex items-center gap-2.5">
              <span className={`sg-live ${on ? 'sg-live--red' : ''}`} />
              <span className="sg-mono" style={{ color: on ? 'var(--red)' : 'var(--cyan)' }}>{on ? 'EMERGENCY RESPONSE' : 'NORMAL OPERATIONS'}</span>
            </div>
            <div className="mt-4">
              <Kv k="AFFECTED ZONE" v={on ? 'SOUTH BENGALURU' : '—'} tone={on ? 'red' : 'dim'} />
              <Kv k="AVAILABLE DRONES" v={on ? '18' : '24'} />
              <Kv k="CRITICAL MISSIONS" v={on ? '07' : '00'} tone={on ? 'amber' : 'dim'} />
              <Kv k="ROUTINE MISSIONS" v={on ? 'DEPRIORITISED' : 'NOMINAL'} tone="dim" />
            </div>
            <div className="mt-5">
              <div className="sg-mono sg-faint">AUTO-ASSIGNMENT</div>
              {on ? (
                world.assignments.map((a, i) => {
                  const vis = shown > i
                  return (
                    <div key={a.drone} className="flex items-baseline justify-between py-2" style={{ borderBottom: '1px solid var(--edge-soft)', opacity: vis ? 1 : 0, transform: vis ? 'none' : 'translateX(-8px)', transition: 'all 500ms var(--ease-out)' }}>
                      <span className="sg-mono" style={{ color: 'var(--red)' }}>{a.drone} → {a.payload}</span>
                      <span className="sg-mono sg-dim">EN ROUTE · ZONE-C · ETA {fmtClock(a.eta)}</span>
                    </div>
                  )
                })
              ) : (
                <div className="sg-mono sg-faint py-2">Awaiting activation</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}

// ── 08 government command ────────────────────────────────────────────────────
const COMMANDS = ['CREATE ZONE', 'RESTRICT AIRSPACE', 'PRIORITIZE MISSION', 'DEPLOY RESCUE', 'ACTIVATE EMERGENCY']

export function Government() {
  const w = useWorld()
  const [role, setRole] = useState<Role>('GOVERNMENT_ADMIN')
  const [, bump] = useState(0)
  const scope = ROLE_SCOPE[role]
  const visible = visibleDrones(role).length
  const gov = role === 'GOVERNMENT_ADMIN'
  const act = (cmd: string) => {
    record('GOV-ADMIN', cmd)
    if (cmd === 'ACTIVATE EMERGENCY') setEmergency(!world.emergency)
    bump((n) => n + 1)
  }
  return (
    <Section id="government" mode="GOV" intensity={1}>
      <div className="grid w-full gap-10 md:grid-cols-12">
        <div className="md:col-span-5">
          <Eyebrow>08 · Government command</Eyebrow>
          <H>One city.<br />One aerial<br />picture.</H>
          <Lede>
            City-wide visibility for the people accountable for the city. Everyone else sees exactly their slice: an operator's
            fleet, an engineer's hub, a customer's mission. Permissions are the product, not a setting.
          </Lede>
        </div>
        <div className="md:col-span-6 md:col-start-7">
          <div className="sg-panel sg-reveal">
            <div className="flex flex-wrap gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--edge)' }}>
              {(Object.keys(ROLE_SCOPE) as Role[]).map((r) => (
                <button key={r} type="button" className="sg-tab" aria-pressed={role === r} onClick={() => setRole(r)}>{ROLE_SCOPE[r].label}</button>
              ))}
            </div>
            <div className="grid gap-6 px-4 py-4 md:grid-cols-2">
              <div>
                <Kv k="SCOPE" v={scope.scope} tone="cyan" />
                <Kv k="AIRCRAFT VISIBLE" v={`${visible.toString().padStart(2, '0')} / ${w.drones.length}`} />
                <Kv k="INCIDENTS VISIBLE" v={role === 'CUSTOMER' ? 'NONE' : role === 'GOVERNMENT_ADMIN' ? 'ALL' : 'OWN'} tone="dim" />
                <div className="sg-mono sg-faint mt-4 mb-2">SEES</div>
                {scope.sees.map((s) => <div key={s} className="sg-mono py-1" style={{ color: 'var(--text)' }}>+ {s}</div>)}
                <div className="sg-mono sg-faint mt-4 mb-2">WITHHELD</div>
                {scope.hidden.map((s) => <div key={s} className="sg-mono py-1" style={{ color: 'var(--text-faint)' }}>− {s}</div>)}
              </div>
              <div>
                <div className="sg-mono sg-faint mb-2">COMMANDS</div>
                {COMMANDS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    disabled={!gov}
                    onClick={() => act(c)}
                    className="sg-tab mb-2 block w-full text-left"
                    style={{ opacity: gov ? 1 : 0.35, borderColor: c === 'ACTIVATE EMERGENCY' && gov ? 'var(--red)' : undefined, color: c === 'ACTIVATE EMERGENCY' && gov ? 'var(--red)' : undefined }}
                  >
                    {c}{!gov ? ' · NO AUTHORITY' : ''}
                  </button>
                ))}
                <div className="sg-mono sg-faint mt-4 mb-2">AUDIT · LAST ACTIONS</div>
                {world.audit.length === 0 && <div className="sg-mono sg-faint">No actions recorded yet</div>}
                {world.audit.slice(0, 4).map((e, i) => (
                  <div key={i} className="sg-mono py-1 flex justify-between gap-3">
                    <span className="sg-dim truncate">{e.actor} · {e.action}</span>
                    <span className="sg-faint">T+{fmtClock(e.at)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}

// ── 09 emergency landing network ─────────────────────────────────────────────
export function LandingNet() {
  const w = useWorld()
  const [failed, setFailed] = useState(false)
  const trigger = () => { divert('SKYPORT 12'); setFocus(HERO_DRONE); setFailed(true) }
  const reset = () => { divert(null); setFailed(false) }
  const ranked = [
    { s: 'SKYPORT 12', d: '420 M', ok: true, why: 'AVAILABLE · PAD 2 OF 4 FREE' },
    { s: 'SKYPORT 09', d: '610 M', ok: false, why: 'AT CAPACITY' },
    { s: 'ST MARY GROUND', d: '880 M', ok: false, why: 'CONDITIONAL · SCHOOL HOURS' },
  ]
  return (
    <Section id="landing" mode="LANDING" intensity={1} onLeave={reset}>
      <div className="grid w-full gap-10 md:grid-cols-12">
        <div className="md:col-span-6">
          <Eyebrow>09 · Emergency landing network</Eyebrow>
          <H>Every drone<br />needs a way<br />home.</H>
          <Lede>
            Hospitals, open grounds, SkyPorts, industrial pads. Twelve approved locations across the sector, each with live
            occupancy and conditions. When an aircraft fails, the grid ranks them and commits to the safest one.
          </Lede>
          <div className="sg-reveal mt-8 grid grid-cols-2 gap-x-8 md:grid-cols-3">
            {SITES.map((s) => (
              <div key={s.id} className="sg-mono py-1.5 flex justify-between gap-3" style={{ borderBottom: '1px solid var(--edge-soft)' }}>
                <span style={{ color: 'var(--text-dim)' }}>{s.label}</span>
                <span style={{ color: s.status === 'AVAILABLE' ? 'var(--cyan)' : 'var(--amber)', fontSize: 9.5 }}>{s.status}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="md:col-span-5 md:col-start-8">
          <div className="sg-panel sg-reveal p-5" style={{ borderColor: failed ? 'var(--amber)' : 'var(--edge)', transition: 'border-color 300ms' }}>
            {!failed ? (
              <>
                <div className="sg-mono" style={{ color: 'var(--cyan)' }}>● {HERO_DRONE} · NOMINAL · {Math.round(w.drones.find((d) => d.id === HERO_DRONE)?.battery ?? 0)}% RESERVE</div>
                <p className="sg-dim mt-3 text-[13px]">Simulate a critical battery on {HERO_DRONE} and watch the grid choose a pad.</p>
                <button type="button" className="sg-cta sg-cta--alarm mt-5" onClick={trigger}>Simulate failure</button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2.5">
                  <span className="sg-live sg-live--amber" />
                  <span className="sg-mono" style={{ color: 'var(--amber)' }}>{HERO_DRONE} · CRITICAL BATTERY</span>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-6">
                  <Big n="SKYPORT 12" label="NEAREST APPROVED LANDING" tone="cyan" />
                  <Big n="420 M" label="DISTANCE · 00:41 AT 10 M/S" />
                </div>
                <div className="mt-4">
                  <Kv k="STATUS" v="AVAILABLE" tone="cyan" />
                  <Kv k="RESERVE ON ARRIVAL" v="19%" tone="amber" />
                  <Kv k="ROUTE" v="DIRECT · CLEAR OF ZONE-A" tone="dim" />
                </div>
                <div className="sg-mono sg-faint mt-5 mb-2">RANKING</div>
                {ranked.map((r) => (
                  <div key={r.s} className="flex justify-between gap-3 py-1.5 sg-mono" style={{ borderBottom: '1px solid var(--edge-soft)', color: r.ok ? 'var(--text)' : 'var(--text-faint)' }}>
                    <span>{r.ok ? '✓' : '×'} {r.s} · {r.d}</span>
                    <span style={{ color: r.ok ? 'var(--cyan)' : 'var(--text-faint)', fontSize: 9.5 }}>{r.why}</span>
                  </div>
                ))}
                <button type="button" className="sg-cta sg-cta--ghost mt-5" onClick={reset}>Reset</button>
              </>
            )}
          </div>
        </div>
      </div>
    </Section>
  )
}

// ── 10 ask the grid ──────────────────────────────────────────────────────────
type Turn = { q: string; a: [string, string][] }
const SCRIPT: Turn[] = [
  { q: "What's happening across South Bengaluru?", a: [['38', 'aircraft active'], ['03', 'incidents detected'], ['02', 'medical missions require attention'], ['ZONE C', 'weather affecting operations']] },
  { q: 'Close Zone C.', a: [['12', 'missions affected'], ['08', 'can reroute automatically'], ['03', 'should return to hub'], ['01', 'emergency mission requires operator approval']] },
  { q: 'Which aircraft can reach the flood zone in under four minutes?', a: [['D-117', 'medicine · 02:54'], ['D-122', 'water · 03:37'], ['D-113', 'rescue equipment · 03:58'], ['HOLD', 'D-104 · reserve below floor']] },
]

export function AskTheGrid() {
  const [log, setLog] = useState<{ q: string; rows: [string, string][]; done: boolean }[]>([])
  const [busy, setBusy] = useState(false)
  const ask = (t: Turn) => {
    if (busy) return
    setBusy(true)
    setLog((l) => [...l, { q: t.q, rows: [], done: false }])
    t.a.forEach((row, i) => {
      setTimeout(() => {
        setLog((l) => {
          const c = [...l]
          const last = { ...c[c.length - 1] }
          last.rows = [...last.rows, row]
          last.done = i === t.a.length - 1
          c[c.length - 1] = last
          return c
        })
        if (i === t.a.length - 1) setBusy(false)
      }, 420 + i * 380)
    })
    if (t.q.startsWith('Close')) record('OPERATOR', 'CLOSE ZONE-C · VIA GRID')
  }
  const asked = new Set(log.map((l) => l.q))
  return (
    <Section id="ask" mode="GOV" intensity={0.85}>
      <div className="grid w-full gap-10 md:grid-cols-12">
        <div className="md:col-span-5">
          <Eyebrow>10 · AI command center</Eyebrow>
          <H>Ask the grid.</H>
          <Lede>
            An operational copilot, not a chatbot. It answers with structured state from the network, proposes actions with their
            consequences counted, and hands anything irreversible to a human for approval.
          </Lede>
        </div>
        <div className="md:col-span-6 md:col-start-7">
          <div className="sg-panel sg-reveal flex flex-col" style={{ minHeight: 420 }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--edge)' }}>
              <span className="sg-mono" style={{ color: 'var(--cyan)' }}>GRID · OPERATIONAL COPILOT</span>
              <span className="sg-mono sg-faint">SCRIPTED PROTOTYPE</span>
            </div>
            <div className="flex-1 space-y-6 px-4 py-5">
              {log.length === 0 && <div className="sg-mono sg-faint">Choose a question to put to the grid.</div>}
              {log.map((l, i) => (
                <div key={i}>
                  <div className="sg-mono sg-faint">OPERATOR</div>
                  <div className="mt-1 text-[15px]">{l.q}</div>
                  <div className="sg-mono mt-3" style={{ color: 'var(--cyan)' }}>GRID</div>
                  <div className="mt-1">
                    {l.rows.map(([n, t], j) => (
                      <div key={j} className="grid grid-cols-[76px_1fr] items-baseline gap-3 py-1.5" style={{ borderBottom: '1px solid var(--edge-soft)' }}>
                        <span className="sg-mono" style={{ color: n === 'HOLD' ? 'var(--amber)' : 'var(--text)' }}>{n}</span>
                        <span className="sg-dim text-[13px]">{t}</span>
                      </div>
                    ))}
                    {!l.done && <div className="sg-mono sg-faint mt-2">▍</div>}
                    {l.done && l.q.startsWith('Close') && (
                      <div className="mt-3 flex gap-2">
                        <button type="button" className="sg-tab" onClick={() => record('OPERATOR', 'APPROVE EMERGENCY REROUTE')}>Approve 1 emergency reroute</button>
                        <button type="button" className="sg-tab">Hold</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 px-4 py-3" style={{ borderTop: '1px solid var(--edge)' }}>
              {SCRIPT.filter((t) => !asked.has(t.q)).map((t) => (
                <button key={t.q} type="button" className="sg-tab" disabled={busy} onClick={() => ask(t)} style={{ textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--font-ui)', fontSize: 12.5 }}>
                  {t.q}
                </button>
              ))}
              {asked.size === SCRIPT.length && <span className="sg-mono sg-faint">Session complete · every action above is in the audit log</span>}
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}

// ── 11 autonomy with accountability ──────────────────────────────────────────
const PILLARS = [
  ['IDENTITY', 'Every aircraft identified.'], ['ACCESS', 'Every operator permissioned.'], ['TELEMETRY', 'Every mission tracked.'],
  ['INCIDENTS', 'Every event recorded.'], ['AUDIT', 'Critical actions traceable.'],
]
const STAGES = ['TAKEOFF', 'ROUTE', 'ALTITUDE CHANGE', 'CONFLICT', 'REROUTE', 'INCIDENT', 'RECOVERY', 'LANDING']

export function Accountability() {
  const [stage, setStage] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setStage((s) => (s + 1) % STAGES.length), 1500)
    return () => clearInterval(t)
  }, [])
  return (
    <Section id="accountability" mode="NETWORK" intensity={0.55}>
      <div className="w-full">
        <div className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-5">
            <Eyebrow>11 · Autonomy with accountability</Eyebrow>
            <H>Autonomy<br />with<br />accountability.</H>
          </div>
          <div className="md:col-span-6 md:col-start-7 md:pt-8">
            {PILLARS.map(([k, v]) => (
              <div key={k} className="sg-reveal flex items-baseline gap-8 py-4" style={{ borderBottom: '1px solid var(--edge)' }}>
                <span className="sg-mono w-28 shrink-0" style={{ color: 'var(--cyan)' }}>{k}</span>
                <span style={{ font: '500 clamp(16px, 1.6vw, 22px)/1.2 var(--font-ui)' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="sg-reveal mt-16 sg-scroll-x">
          <div className="relative" style={{ minWidth: 760 }}>
            <div className="absolute top-[5px] right-0 left-0 h-px" style={{ background: 'var(--edge)' }} />
            <div className="absolute top-[5px] left-0 h-px" style={{ width: `${(stage / (STAGES.length - 1)) * 100}%`, background: 'var(--cyan)', transition: 'width 1400ms linear' }} />
            <div className="grid" style={{ gridTemplateColumns: `repeat(${STAGES.length}, 1fr)` }}>
              {STAGES.map((s, i) => {
                const on = i <= stage
                const alarm = s === 'CONFLICT' || s === 'INCIDENT'
                return (
                  <div key={s}>
                    <div style={{ width: 11, height: 11, marginLeft: -5, background: on ? (alarm ? 'var(--amber)' : 'var(--cyan)') : 'var(--void)', border: `1px solid ${on ? (alarm ? 'var(--amber)' : 'var(--cyan)') : 'var(--edge)'}`, transition: 'all 300ms' }} />
                    <div className="sg-mono mt-3" style={{ color: i === stage ? 'var(--text)' : 'var(--text-faint)' }}>{s}</div>
                    <div className="sg-mono sg-faint mt-1">T+{fmtClock(i * 47 + 12)}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}

// ── 12 who it is for ─────────────────────────────────────────────────────────
const AUDIENCE: { k: string; items: string[]; mission: MissionKind; line: string }[] = [
  { k: 'HEALTHCARE', items: ['Medical samples', 'Medicines', 'Emergency supplies'], mission: 'MEDICAL', line: 'A blood sample crosses the city in nine minutes, not fifty.' },
  { k: 'GOVERNMENT', items: ['Disaster response', 'Search & rescue', 'Emergency logistics'], mission: 'EMERGENCY', line: 'One aerial picture for the people accountable for the city.' },
  { k: 'INDUSTRY', items: ['Critical spare parts', 'Remote operations', 'Downtime reduction'], mission: 'INDUSTRIAL', line: 'A stopped line restarts before the courier would have left.' },
  { k: 'COMMERCE', items: ['Dark stores', 'Urgent deliveries', 'Last-mile logistics'], mission: 'COMMERCE', line: 'Dense, routine, high-volume, and never in the way of a medical flight.' },
]

export function Audience() {
  const w = useWorld()
  const [hot, setHot] = useState<number | null>(null)
  const spotlight = (m: MissionKind) => {
    const d = w.drones.find((x) => x.mission === m) ?? w.drones[0]
    setFocus(d.id)
  }
  return (
    <Section id="audience" mode="OPS" intensity={1}>
      <div className="w-full">
        <Eyebrow>12 · Who SkyGrid is for</Eyebrow>
        <div className="mt-6 grid md:grid-cols-2" style={{ borderTop: '1px solid var(--edge)', borderLeft: '1px solid var(--edge)' }}>
          {AUDIENCE.map((a, i) => {
            const on = hot === i
            return (
              <div
                key={a.k}
                onMouseEnter={() => { setHot(i); spotlight(a.mission) }}
                onMouseLeave={() => setHot(null)}
                onFocus={() => { setHot(i); spotlight(a.mission) }}
                tabIndex={0}
                className="sg-reveal relative p-7 md:p-10"
                style={{ borderRight: '1px solid var(--edge)', borderBottom: '1px solid var(--edge)', background: on ? 'rgba(53,214,240,0.05)' : 'transparent', transition: 'background 300ms', minHeight: 240, cursor: 'default' }}
              >
                <div className="flex items-baseline justify-between">
                  <span className="sg-h sg-h--sm" style={{ fontSize: 'clamp(26px, 3.4vw, 46px)' }}>{a.k}</span>
                  <span className="sg-mono" style={{ color: on ? 'var(--cyan)' : 'var(--text-faint)' }}>{a.mission} · {w.drones.filter((d) => d.mission === a.mission).length.toString().padStart(2, '0')} ACTIVE</span>
                </div>
                <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2">
                  {a.items.map((it) => <span key={it} className="sg-dim text-[14px]">{it}</span>)}
                </div>
                <div className="mt-6 text-[14px]" style={{ color: on ? 'var(--text)' : 'var(--text-faint)', transition: 'color 300ms', maxWidth: '40ch' }}>{a.line}</div>
              </div>
            )
          })}
        </div>
      </div>
    </Section>
  )
}

// ── 13 the network ───────────────────────────────────────────────────────────
export function Network() {
  const w = useWorld()
  const ops = new Set(w.drones.map((d) => d.operator)).size
  const stats: [string, string][] = [
    ['HUBS', SITES.filter((s) => s.kind === 'HUB' || s.kind === 'HOSPITAL').length.toString().padStart(2, '0')],
    ['DRONES', (103 + w.drones.length).toString()],
    ['SKYPORTS', SITES.filter((s) => s.kind === 'SKYPORT').length.toString().padStart(2, '0')],
    ['EMERGENCY ZONES', ZONES.length.toString().padStart(2, '0')],
    ['OPERATORS', ops.toString().padStart(2, '0')],
    ['MISSIONS', '84'],
  ]
  return (
    <Section id="network" mode="NETWORK" intensity={1}>
      <div className="w-full">
        <div className="grid gap-10 md:grid-cols-12 md:items-end">
          <div className="md:col-span-8">
            <Eyebrow>13 · The network</Eyebrow>
            <H>From individual<br />flights to city-scale<br />intelligence.</H>
          </div>
          <div className="md:col-span-4">
            <div className="grid grid-cols-3 gap-x-6 gap-y-8 sg-reveal">
              {stats.map(([k, v]) => <Big key={k} n={v} label={k} />)}
            </div>
            <div className="sg-mono sg-faint sg-reveal mt-8">EVERY NODE CONNECTED · EVERY FLIGHT ACCOUNTED FOR · SIMULATED SECTOR</div>
          </div>
        </div>
      </div>
    </Section>
  )
}

// ── final ────────────────────────────────────────────────────────────────────
export function Finale() {
  const [beat, setBeat] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let timers: number[] = []
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        timers = [window.setTimeout(() => setBeat(1), 900), window.setTimeout(() => setBeat(2), 2600), window.setTimeout(() => setBeat(3), 4000)]
      } else {
        timers.forEach(clearTimeout)
        setBeat(0)
      }
    }, { threshold: 0.5 })
    io.observe(el)
    return () => { io.disconnect(); timers.forEach(clearTimeout) }
  }, [])
  const show = (n: number) => ({ opacity: beat >= n ? 1 : 0, transform: beat >= n ? 'none' : 'translateY(14px)', transition: 'opacity 1100ms var(--ease-out), transform 1100ms var(--ease-out)' })
  return (
    <Section id="finale" mode="FINALE" intensity={0.16} className="!min-h-[130svh] !items-center">
      <div ref={ref} className="relative w-full text-center">
        <div className="sg-finale-drone" aria-hidden />
        <div style={show(1)}>
          <div className="sg-h" style={{ fontSize: 'clamp(28px, 4.6vw, 64px)' }}>The future of delivery<br />isn't just autonomous.</div>
        </div>
        <div style={{ ...show(2), marginTop: 28 }}>
          <div className="sg-h" style={{ fontSize: 'clamp(40px, 8vw, 128px)', color: 'var(--cyan)' }}>It's coordinated.</div>
        </div>
        <div style={{ ...show(3), marginTop: 64 }}>
          <div style={{ font: '600 20px/1 var(--font-ui)', letterSpacing: '0.34em' }}>SKYGRID</div>
          <div className="sg-mono mt-4" style={{ color: 'var(--text-dim)', letterSpacing: '0.2em' }}>THE OPERATING SYSTEM FOR THE LOW-ALTITUDE WORLD.</div>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <a href={COMMAND_URL} className="sg-cta">Enter command center <Arrow /></a>
            <a href="mailto:hello@skygrid.example?subject=SKYGRID%20demo" className="sg-cta sg-cta--ghost">Request a demo</a>
          </div>
        </div>
      </div>
    </Section>
  )
}

export function Footer() {
  return (
    <footer className="relative z-[2] px-6 py-10 md:px-10" style={{ borderTop: '1px solid var(--edge)', background: 'var(--void)' }}>
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div>
          <div style={{ font: '600 13px/1 var(--font-ui)', letterSpacing: '0.3em' }}>SKYGRID</div>
          <div className="sg-mono sg-faint mt-3" style={{ maxWidth: '62ch', lineHeight: 1.6 }}>
            Hackathon prototype. Every aircraft, telemetry value, incident, route and emergency event on this page is simulated in the
            browser. SkyGrid is a command and decision-support platform concept; it does not control real aircraft and holds no
            regulatory certification or government integration.
          </div>
        </div>
        <div className="sg-mono sg-faint flex gap-8">
          <a href={COMMAND_URL} style={{ color: 'var(--text-dim)' }}>COMMAND CENTER</a>
          <span>BENGALURU · SECTOR BLR-C</span>
          <span>© {new Date().getFullYear()}</span>
        </div>
      </div>
    </footer>
  )
}
