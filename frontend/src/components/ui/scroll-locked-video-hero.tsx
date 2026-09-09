import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'

// ─────────────────────────────────────────────────────────────
// ONBOARD FEED
// Adapted from the "Wherever You Run" music hero. The same ideas
// survive: a square floating screen that tilts toward the cursor, a
// list with real momentum physics and an encoder-detent click, and
// working prev/play/next controls. What changed is what it is for.
// The screen is a drone's onboard camera, the list is the missions
// whose cameras are on the grid, and selecting one focuses that
// aircraft in the 3D city behind the screen. Wheel and touch are
// captured on the screen only, so the page underneath still scrolls.
// Zero dependencies, synthesized sound only.
// ─────────────────────────────────────────────────────────────

export interface Feed {
  id: string
  title: string
  artist: string
  colorA: string
  colorB: string
  alt?: number
  speed?: number
  battery?: number
  droneId?: string
}
export type Track = Feed

// Real aerial night footage, CC BY 3.0 via Wikimedia Commons, standing in for a live
// downlink. Two encodings of two clips so one refusal never blanks the screen.
export const DEFAULT_FEED_SOURCES = [
  'https://upload.wikimedia.org/wikipedia/commons/c/cd/City_at_night.webm',
  'https://upload.wikimedia.org/wikipedia/commons/4/45/Night_landscape_of_Bhopal_city.webm',
]
export const FEED_ATTRIBUTION = 'Aerial footage: "City at night", CC BY 3.0, via Wikimedia Commons'

const DEFAULT_FEEDS: Feed[] = [
  { id: 'D-104', droneId: 'D-104', title: 'MEDICAL DELIVERY', artist: 'D-104 · MEDLIFT OPS', colorA: '#56D6EC', colorB: '#0C4A58', alt: 118, speed: 42, battery: 76 },
  { id: 'D-109', droneId: 'D-109', title: 'COMMERCE · DARK STORE', artist: 'D-109 · SWIFTCARGO', colorA: '#9EB0C6', colorB: '#2A3A4E', alt: 140, speed: 51, battery: 64 },
  { id: 'D-113', droneId: 'D-113', title: 'RESCUE EQUIPMENT', artist: 'D-113 · CIVIC AIR', colorA: '#E8A93C', colorB: '#5C3E10', alt: 160, speed: 58, battery: 81 },
  { id: 'D-117', droneId: 'D-117', title: 'EMERGENCY · MEDICINE', artist: 'D-117 · MEDLIFT OPS', colorA: '#E0452F', colorB: '#5C1A12', alt: 168, speed: 62, battery: 70 },
  { id: 'D-121', droneId: 'D-121', title: 'INDUSTRIAL · SPARES', artist: 'D-121 · NORTHFIELD', colorA: '#C8A860', colorB: '#4E3E1A', alt: 100, speed: 47, battery: 88 },
  { id: 'D-106', droneId: 'D-106', title: 'MEDICAL SAMPLES', artist: 'D-106 · MEDLIFT OPS', colorA: '#56D6EC', colorB: '#0C4A58', alt: 120, speed: 44, battery: 59 },
  { id: 'D-110', droneId: 'D-110', title: 'COMMERCE · URGENT', artist: 'D-110 · SWIFTCARGO', colorA: '#9EB0C6', colorB: '#2A3A4E', alt: 120, speed: 49, battery: 92 },
  { id: 'D-122', droneId: 'D-122', title: 'EMERGENCY · WATER', artist: 'D-122 · CIVIC AIR', colorA: '#E0452F', colorB: '#5C1A12', alt: 170, speed: 60, battery: 66 },
  { id: 'D-103', droneId: 'D-103', title: 'MEDICAL DELIVERY', artist: 'D-103 · MEDLIFT OPS', colorA: '#56D6EC', colorB: '#0C4A58', alt: 100, speed: 40, battery: 94 },
  { id: 'D-115', droneId: 'D-115', title: 'INDUSTRIAL · REMOTE SITE', artist: 'D-115 · NORTHFIELD', colorA: '#C8A860', colorB: '#4E3E1A', alt: 100, speed: 46, battery: 73 },
  { id: 'D-108', droneId: 'D-108', title: 'COMMERCE · LAST MILE', artist: 'D-108 · SWIFTCARGO', colorA: '#9EB0C6', colorB: '#2A3A4E', alt: 160, speed: 52, battery: 61 },
  { id: 'D-124', droneId: 'D-124', title: 'RESCUE · SEARCH PATTERN', artist: 'D-124 · CIVIC AIR', colorA: '#E8A93C', colorB: '#5C3E10', alt: 140, speed: 38, battery: 79 },
]

export interface MusicHeroProps {
  title?: string
  videoSrc?: string | string[]
  backgroundSrc?: string
  tracks?: Feed[]
  signature?: { name: string; url: string } | false
  sound?: boolean
  fullBleed?: boolean
  onSelect?: (feed: Feed) => void
  className?: string
  style?: CSSProperties
}

const SANS = "'Barlow Semi Condensed', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
const CYAN = '#35D6F0'
const AMBER = '#E8A93C'
// shadcn-style variables with fallbacks matching SKYGRID's own midnight palette
const bgVar = 'hsl(var(--background, 218 50% 3%))'
const fgVar = 'hsl(var(--foreground, 214 47% 94%))'
const fgMutedVar = (a: number) => `hsl(var(--foreground, 214 47% 94%) / ${a})`
const cardVar = (a = 1) => `hsl(var(--card, 212 35% 7%) / ${a})`
const ROW_HEIGHT = 60
const MAX_VIDEO_VOLUME = 0.32

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const mod = (n: number, m: number) => ((n % m) + m) % m

// synthesized encoder detent: a tight noise transient through a bandpass
function playWheelClick(ctx: AudioContext, velocity: number) {
  const now = ctx.currentTime
  const strength = clamp(velocity, 0, 1)
  const size = Math.floor(ctx.sampleRate * 0.012)
  const buffer = ctx.createBuffer(1, size, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, 2.6)
  const noise = ctx.createBufferSource()
  noise.buffer = buffer
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 4200 + strength * 700
  bp.Q.value = 3
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.11 + strength * 0.07, now)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018)
  noise.connect(bp)
  bp.connect(gain)
  gain.connect(ctx.destination)
  noise.start(now)
}

export default function MusicHero({
  title = 'EVERY FLIGHT, RECORDED.',
  videoSrc = DEFAULT_FEED_SOURCES,
  backgroundSrc,
  tracks = DEFAULT_FEEDS,
  signature = false,
  sound = true,
  fullBleed = false,
  onSelect,
  className,
  style,
}: MusicHeroProps) {
  const listViewportRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const videoWrapRef = useRef<HTMLDivElement>(null)
  const bgRef = useRef<HTMLDivElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const offsetRef = useRef(0)
  const velocityRef = useRef(0)
  const snapTargetRef = useRef<number | null>(null)
  const lastDetentRef = useRef(0)
  const isDraggingRef = useRef(false)
  const lastDragYRef = useRef(0)
  const lastDragTRef = useRef(0)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])
  const [videoSoundOn, setVideoSoundOn] = useState(false)
  const [videoVolume, setVideoVolume] = useState(0.16)
  const [activeIndex, setActiveIndex] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isPlaying, setIsPlaying] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isCoarsePointer, setIsCoarsePointer] = useState(false)
  const [feedOk, setFeedOk] = useState(true)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  const n = tracks.length
  const sources = Array.isArray(videoSrc) ? videoSrc : [videoSrc]

  useEffect(() => {
    const check = () => {
      const coarse = window.matchMedia?.('(pointer: coarse)').matches
      setIsCoarsePointer(Boolean(coarse || window.innerWidth < 700))
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    if (announceTimerRef.current) clearTimeout(announceTimerRef.current)
    announceTimerRef.current = setTimeout(() => {
      const t = tracks[activeIndex]
      if (t) {
        setAnnouncement(`Now showing ${t.title}, ${t.artist}`)
        onSelectRef.current?.(t)
      }
    }, 400)
    return () => {
      if (announceTimerRef.current) clearTimeout(announceTimerRef.current)
    }
  }, [activeIndex, tracks])

  useEffect(() => {
    setAnnouncement(isPlaying ? 'Feed playing' : 'Feed paused')
  }, [isPlaying])

  useEffect(() => {
    if (!isFullscreen) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFullscreen(false) }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [isFullscreen])

  const getCtx = useCallback((): AudioContext | null => {
    try {
      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        audioCtxRef.current = new Ctx()
      }
      return audioCtxRef.current
    } catch {
      return null
    }
  }, [])
  const fireClick = useCallback((velocity: number) => {
    const ctx = getCtx()
    if (!ctx) return
    if (ctx.state === 'suspended') ctx.resume().then(() => playWheelClick(ctx, velocity)).catch(() => {})
    else playWheelClick(ctx, velocity)
  }, [getCtx])

  // unlock audio on the first gesture the browser accepts; the click and the
  // video's quiet ambience turn on together
  useEffect(() => {
    const unlock = () => {
      const ctx = getCtx()
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
      if (sound) setVideoSoundOn(true)
    }
    const opts = { once: true } as const
    window.addEventListener('pointerdown', unlock, opts)
    window.addEventListener('keydown', unlock, opts)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [getCtx, sound])

  // render loop: coverflow lean, scale, fade
  useEffect(() => {
    let rafId = 0
    const render = () => {
      const centerIndexFloat = offsetRef.current / ROW_HEIGHT
      rowRefs.current.forEach((el, i) => {
        if (!el) return
        let d = i - centerIndexFloat
        d = mod(d + n / 2, n) - n / 2
        const absD = Math.abs(d)
        el.style.transform = `translateY(${d * ROW_HEIGHT}px) translateZ(${-absD * 18}px) rotateX(${clamp(d * 9, -22, 22)}deg) scale(${clamp(1 - absD * 0.1, 0.72, 1)})`
        el.style.opacity = String(clamp(1 - absD * 0.4, 0, 1))
        el.style.pointerEvents = absD < 0.5 ? 'auto' : 'none'
        el.style.zIndex = String(1000 - Math.round(absD * 10))
      })
      const nearest = mod(Math.round(centerIndexFloat), n)
      setActiveIndex((prev) => (prev === nearest ? prev : nearest))
      rafId = requestAnimationFrame(render)
    }
    rafId = requestAnimationFrame(render)
    return () => cancelAnimationFrame(rafId)
  }, [n])

  // physics: snap, or flick-and-settle with a detent click per row
  useEffect(() => {
    let rafId = 0
    const physics = () => {
      if (snapTargetRef.current !== null) {
        const target = snapTargetRef.current
        offsetRef.current += (target - offsetRef.current) * 0.22
        if (Math.abs(target - offsetRef.current) < 0.4) {
          offsetRef.current = target
          snapTargetRef.current = null
        }
      } else if (!isDraggingRef.current) {
        offsetRef.current += velocityRef.current
        velocityRef.current *= 0.93
        if (Math.abs(velocityRef.current) < 0.02) velocityRef.current = 0
      }
      const detent = Math.round(offsetRef.current / ROW_HEIGHT)
      if (detent !== lastDetentRef.current) {
        lastDetentRef.current = detent
        fireClick(clamp(Math.abs(velocityRef.current) / ROW_HEIGHT, 0.15, 1))
      }
      rafId = requestAnimationFrame(physics)
    }
    rafId = requestAnimationFrame(physics)
    return () => cancelAnimationFrame(rafId)
  }, [fireClick])

  // wheel and touch are captured on the screen only, never on the window,
  // so the page around it keeps scrolling normally
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      snapTargetRef.current = null
      velocityRef.current = clamp(velocityRef.current + e.deltaY * 0.045, -14, 14)
    }
    const onTouchStart = (e: TouchEvent) => {
      isDraggingRef.current = true
      snapTargetRef.current = null
      velocityRef.current = 0
      lastDragYRef.current = e.touches[0]?.clientY ?? 0
      lastDragTRef.current = performance.now()
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current) return
      e.preventDefault()
      const y = e.touches[0]?.clientY ?? lastDragYRef.current
      const dy = lastDragYRef.current - y
      offsetRef.current += dy
      const t = performance.now()
      velocityRef.current = (dy / Math.max(1, t - lastDragTRef.current)) * 16
      lastDragYRef.current = y
      lastDragTRef.current = t
    }
    const onTouchEnd = () => { isDraggingRef.current = false }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [isCoarsePointer])

  const BASE_ROTATE_Y = -13
  const BASE_ROTATE_X = 5

  const onCardMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (isCoarsePointer) return
    const rect = cardRef.current?.getBoundingClientRect()
    if (!rect) return
    const px = (e.clientX - rect.left) / rect.width - 0.5
    const py = (e.clientY - rect.top) / rect.height - 0.5
    if (isFullscreen) {
      const el = videoWrapRef.current
      if (!el) return
      el.style.transition = 'transform 0.05s linear'
      el.style.transform = `scale(1.45) rotateY(${px * 26}deg) rotateX(${-py * 20}deg)`
      return
    }
    const el = cardRef.current
    if (!el) return
    el.style.transition = 'width 0.5s cubic-bezier(.2,.8,.2,1), height 0.5s cubic-bezier(.2,.8,.2,1), transform 0.05s linear'
    el.style.transform = `rotateY(${px * 46}deg) rotateX(${-py * 38}deg) scale(1.03)`
    if (bgRef.current) bgRef.current.style.transform = `translate(${-px * 34}px, ${-py * 24}px) scale(1.06)`
  }, [isCoarsePointer, isFullscreen])

  const onCardLeave = useCallback(() => {
    if (isFullscreen) {
      const el = videoWrapRef.current
      if (el) {
        el.style.transition = 'transform 0.6s cubic-bezier(.2,.8,.2,1)'
        el.style.transform = 'scale(1.45) rotateY(0deg) rotateX(0deg)'
      }
      return
    }
    const el = cardRef.current
    if (el) {
      el.style.transition = 'width 0.5s cubic-bezier(.2,.8,.2,1), height 0.5s cubic-bezier(.2,.8,.2,1), transform 0.6s cubic-bezier(.2,.8,.2,1)'
      el.style.transform = `rotateY(${BASE_ROTATE_Y}deg) rotateX(${BASE_ROTATE_X}deg) scale(1)`
    }
    if (bgRef.current) {
      bgRef.current.style.transition = 'transform 0.6s cubic-bezier(.2,.8,.2,1)'
      bgRef.current.style.transform = 'translate(0px, 0px) scale(1.06)'
    }
  }, [isFullscreen])

  const setRowRef = useCallback((i: number) => (el: HTMLDivElement | null) => { rowRefs.current[i] = el }, [])

  const goStep = (dir: 1 | -1) => {
    snapTargetRef.current = (Math.round(offsetRef.current / ROW_HEIGHT) + dir) * ROW_HEIGHT
    velocityRef.current = 0
    fireClick(0.5)
  }
  const togglePlay = () => setIsPlaying((p) => !p)
  const handlePlayerKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); goStep(1) }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); goStep(-1) }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); togglePlay() }
  }

  const activeTrack = tracks[activeIndex]
  const label = `Onboard feed. Showing ${activeTrack.title}, ${activeTrack.artist}. Use arrow keys to change feed, space to pause.`

  const screen = (
    <>
      <span aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}>{announcement}</span>
      <div
        ref={videoWrapRef}
        style={{
          position: 'absolute', inset: 0, background: bgVar, transformStyle: 'preserve-3d',
          transform: isFullscreen ? 'scale(1.45) rotateY(0deg) rotateX(0deg)' : 'none',
          transition: 'transform 0.5s cubic-bezier(.2,.8,.2,1)',
        }}
      >
        {feedOk ? (
          <SeamlessLoopVideo sources={sources} muted={!videoSoundOn} volume={videoVolume} playing={isPlaying} onFail={() => setFeedOk(false)} />
        ) : (
          <NoSignal />
        )}
      </div>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 85% 85% at 50% 50%, transparent 55%, rgba(0,4,14,0.55) 100%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(3,5,14,0.32) 0%, rgba(3,5,14,0) 28%, rgba(3,5,14,0.3) 55%, rgba(3,5,14,0.88) 100%)', pointerEvents: 'none' }} />
      <FeedHud feed={activeTrack} playing={isPlaying} compact={isCoarsePointer} />
      <div
        ref={listViewportRef}
        className="mh-list-fade"
        style={{
          position: 'absolute', left: 0, right: 0, bottom: isCoarsePointer ? 128 : 118, height: isCoarsePointer ? '34%' : '46%',
          overflow: 'hidden', perspective: '1500px', perspectiveOrigin: '50% 30%', touchAction: 'none',
        }}
      >
        <div style={{ position: 'absolute', left: 0, right: 0, top: '30%', height: 0, transformStyle: 'preserve-3d' }}>
          {tracks.map((t, i) => <TrackRow key={t.id} t={t} i={i} isActive={i === activeIndex} isPlaying={isPlaying} setRowRef={setRowRef} />)}
        </div>
      </div>
      <PlayerControls
        onPrev={() => goStep(-1)} onNext={() => goStep(1)} onPlay={togglePlay} isPlaying={isPlaying} track={activeTrack}
        videoSoundOn={videoSoundOn} onToggleVideoSound={() => setVideoSoundOn((s) => !s)} videoVolume={videoVolume}
        onVideoVolumeChange={setVideoVolume} compact={isCoarsePointer}
      />
    </>
  )

  const css = (
    <style>{`
      @keyframes mh-pulse { 0%, 100% { opacity: 0.55 } 50% { opacity: 1 } }
      @keyframes mh-drift { 0%, 100% { transform: translate(0,0) scale(1.06) } 50% { transform: translate(1.5%, -1%) scale(1.1) } }
      @keyframes mh-eq1 { 0%,100% { height: 4px } 50% { height: 14px } }
      @keyframes mh-eq2 { 0%,100% { height: 13px } 50% { height: 5px } }
      @keyframes mh-eq3 { 0%,100% { height: 7px } 50% { height: 15px } }
      @keyframes mh-rec { 0%, 100% { opacity: 1 } 50% { opacity: 0.25 } }
      @keyframes mh-scan { from { transform: translateY(-100%) } to { transform: translateY(100vh) } }
      .mh-focusable:focus-visible { outline: 2px solid ${CYAN}; outline-offset: 3px; }
      .mh-list-fade { mask-image: linear-gradient(to bottom, transparent 0%, black 22%, black 78%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, transparent 0%, black 22%, black 78%, transparent 100%); }
    `}</style>
  )

  // ── touch and narrow windows: a phone-shaped frame, in flow, no chrome ──
  if (isCoarsePointer) {
    return (
      <div className={className} style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center', ...style }}>
        {css}
        <div
          className="mh-focusable"
          onKeyDown={handlePlayerKeyDown}
          tabIndex={0}
          role="application"
          aria-label={label}
          ref={cardRef}
          style={{ position: 'relative', width: 'min(100%, 380px)', aspectRatio: '9 / 16', background: bgVar, overflow: 'hidden', border: `1px solid ${CYAN}33`, boxShadow: '0 30px 80px rgba(0,0,0,0.6)' }}
        >
          {screen}
        </div>
      </div>
    )
  }

  // ── desktop: the floating tilting screen ──
  return (
    <div
      className={className}
      style={{
        position: 'relative', height: fullBleed ? '100dvh' : undefined, width: '100%',
        background: backgroundSrc ? bgVar : 'transparent', overflow: 'visible',
        display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', ...style,
      }}
    >
      {css}
      {backgroundSrc && (
        <>
          <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 30% 25%, ${CYAN}44, transparent 55%), radial-gradient(circle at 75% 70%, ${AMBER}33, transparent 55%), #05060a` }} />
          <div ref={bgRef} style={{ position: 'absolute', inset: '-6%', backgroundImage: `url(${backgroundSrc})`, backgroundSize: 'cover', backgroundPosition: 'center', transform: 'scale(1.06)', animation: 'mh-drift 16s ease-in-out infinite', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 70% at 50% 45%, transparent 40%, rgba(2,3,10,0.7) 100%)', pointerEvents: 'none' }} />
        </>
      )}

      {isFullscreen && (
        <span style={{ position: 'fixed', top: 'clamp(16px, 4vh, 28px)', left: 0, right: 0, zIndex: 60, textAlign: 'center', fontFamily: SANS, fontWeight: 600, fontSize: 'clamp(18px, 2.4vw, 28px)', letterSpacing: '0.02em', color: fgVar, textShadow: '0 4px 30px rgba(0,10,40,0.6)', pointerEvents: 'none' }}>
          {title}
        </span>
      )}
      {signature && (
        <a href={signature.url} target="_blank" rel="noopener noreferrer" style={{ position: 'absolute', bottom: -22, right: 0, fontFamily: MONO, fontSize: 10, color: fgMutedVar(0.5), textDecoration: 'none' }}>{signature.name}</a>
      )}

      <div style={{ position: 'relative' }}>
        <div aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', width: '128%', height: '118%', transform: 'translate(-50%, -50%)', background: `radial-gradient(ellipse, ${CYAN}55, transparent 68%)`, filter: 'blur(40px)', mixBlendMode: 'screen', animation: 'mh-pulse 4s ease-in-out infinite', pointerEvents: 'none' }} />
        <div
          ref={cardRef}
          onPointerMove={onCardMove}
          onPointerLeave={onCardLeave}
          onKeyDown={handlePlayerKeyDown}
          tabIndex={0}
          role="application"
          aria-label={label}
          className="mh-focusable"
          style={{
            position: isFullscreen ? 'fixed' : 'relative',
            inset: isFullscreen ? 0 : undefined,
            width: isFullscreen ? '100vw' : 'min(58dvh, 480px)',
            height: isFullscreen ? '100dvh' : 'min(58dvh, 480px)',
            overflow: 'hidden',
            background: bgVar,
            boxShadow: isFullscreen ? 'none' : `0 40px 100px rgba(0,0,0,0.65), 0 0 0 1px ${CYAN}2b, inset 0 0 60px rgba(0,0,0,0.25)`,
            transformStyle: 'preserve-3d',
            perspective: '1700px',
            transform: isFullscreen ? 'none' : `rotateY(${BASE_ROTATE_Y}deg) rotateX(${BASE_ROTATE_X}deg)`,
            transition: 'width 0.5s cubic-bezier(.2,.8,.2,1), height 0.5s cubic-bezier(.2,.8,.2,1), transform 0.5s cubic-bezier(.2,.8,.2,1)',
            zIndex: isFullscreen ? 50 : undefined,
          }}
        >
          {screen}
          <button
            onClick={() => setIsFullscreen((f) => !f)}
            aria-label={isFullscreen ? 'Exit expanded feed' : 'Expand feed'}
            title={isFullscreen ? 'Exit (Esc)' : 'Expand feed'}
            style={{ position: 'absolute', top: 12, right: 12, zIndex: 6, background: 'rgba(10,14,26,0.55)', backdropFilter: 'blur(10px)', border: `1px solid ${isFullscreen ? AMBER : CYAN}55`, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isFullscreen ? AMBER : fgMutedVar(0.7), cursor: 'pointer' }}
          >
            {isFullscreen ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3v4a1 1 0 0 1-1 1H4M15 3v4a1 1 0 0 0 1 1h4M9 21v-4a1 1 0 0 0-1-1H4M15 21v-4a1 1 0 0 1 1-1h4" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3" /></svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// two stacked videos crossfading before the loop point, so the seam never shows;
// each element carries every source so the browser falls through to one it can play
const CROSSFADE_S = 1
function SeamlessLoopVideo({ sources, muted, volume, playing, onFail }: { sources: string[]; muted: boolean; volume: number; playing: boolean; onFail: () => void }) {
  const aRef = useRef<HTMLVideoElement>(null)
  const bRef = useRef<HTMLVideoElement>(null)
  const activeRef = useRef<'a' | 'b'>('a')
  const crossfadingRef = useRef(false)
  const [aOpacity, setAOpacity] = useState(1)
  const [bOpacity, setBOpacity] = useState(0)

  useEffect(() => {
    for (const v of [aRef.current, bRef.current]) {
      if (!v) continue
      v.muted = muted
      v.volume = volume
    }
  }, [muted, volume])

  useEffect(() => {
    const active = activeRef.current === 'a' ? aRef.current : bRef.current
    if (!active) return
    if (playing) active.play().catch(() => {})
    else active.pause()
  }, [playing])

  useEffect(() => {
    const a = aRef.current
    const b = bRef.current
    if (!a || !b) return
    a.play().catch(() => {})
    let rafId = 0
    const tick = () => {
      const active = activeRef.current === 'a' ? a : b
      const inactive = activeRef.current === 'a' ? b : a
      if (active.duration) {
        const remaining = active.duration - active.currentTime
        if (!crossfadingRef.current && remaining <= CROSSFADE_S) {
          crossfadingRef.current = true
          inactive.currentTime = 0
          inactive.play().catch(() => {})
        }
        if (crossfadingRef.current) {
          const t = clamp(1 - remaining / CROSSFADE_S, 0, 1)
          if (activeRef.current === 'a') { setAOpacity(1 - t); setBOpacity(t) } else { setBOpacity(1 - t); setAOpacity(t) }
          if (remaining <= 0.03) {
            active.pause()
            crossfadingRef.current = false
            activeRef.current = activeRef.current === 'a' ? 'b' : 'a'
          }
        }
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  const base: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'saturate(0.85) contrast(1.05)' }
  const srcs = sources.map((s) => <source key={s} src={s} type={s.endsWith('.webm') ? 'video/webm' : 'video/mp4'} />)
  return (
    <>
      <video ref={aRef} playsInline preload="auto" muted style={{ ...base, opacity: aOpacity }} onError={onFail}>{srcs}</video>
      <video ref={bRef} playsInline preload="auto" muted style={{ ...base, opacity: bOpacity }}>{srcs}</video>
    </>
  )
}

function NoSignal() {
  return (
    <div style={{ position: 'absolute', inset: 0, background: `repeating-linear-gradient(0deg, #05070C 0 2px, #0A1018 2px 4px)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.2em', color: AMBER }}>NO SIGNAL · FEED OFFLINE</span>
    </div>
  )
}

function FeedHud({ feed, playing, compact }: { feed: Feed; playing: boolean; compact: boolean }) {
  const [tc, setTc] = useState(0)
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setTc((v) => v + 1), 1000)
    return () => clearInterval(t)
  }, [playing])
  const h = Math.floor(tc / 3600).toString().padStart(2, '0')
  const m = Math.floor((tc % 3600) / 60).toString().padStart(2, '0')
  const s = (tc % 60).toString().padStart(2, '0')
  const mono: CSSProperties = { fontFamily: MONO, fontSize: compact ? 9.5 : 10.5, letterSpacing: '0.1em', color: fgMutedVar(0.85), textShadow: '0 1px 8px rgba(0,0,0,0.9)' }
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }}>
      <div style={{ position: 'absolute', inset: '6% 6% auto 6%', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ ...mono, color: CYAN, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: playing ? '#E0452F' : fgMutedVar(0.4), animation: playing ? 'mh-rec 1.6s ease-in-out infinite' : 'none' }} />
            {playing ? 'REC' : 'HOLD'} · {feed.droneId ?? feed.id} · CAM 1
          </div>
          <div style={{ ...mono, marginTop: 6 }}>{h}:{m}:{s} · 1080P30</div>
        </div>
        <div style={{ textAlign: 'right', marginTop: compact ? 0 : 40 }}>
          <div style={mono}>ALT {feed.alt ?? 120} M</div>
          <div style={{ ...mono, marginTop: 6 }}>SPD {feed.speed ?? 42} KM/H</div>
          <div style={{ ...mono, marginTop: 6, color: (feed.battery ?? 80) < 30 ? AMBER : undefined }}>BAT {feed.battery ?? 80}%</div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: '50%', top: '38%', width: 26, height: 26, transform: 'translate(-50%,-50%)', border: `1px solid ${CYAN}88` }} />
      <div style={{ position: 'absolute', left: '50%', top: '38%', width: 90, height: 1, transform: 'translate(-50%,-50%)', background: `${CYAN}44` }} />
      <div style={{ position: 'absolute', inset: '9% 4%', border: `1px solid ${CYAN}22`, pointerEvents: 'none' }} />
    </div>
  )
}

function TrackRow({ t, i, isActive, isPlaying, setRowRef }: { t: Feed; i: number; isActive: boolean; isPlaying: boolean; setRowRef: (i: number) => (el: HTMLDivElement | null) => void }) {
  return (
    <div
      ref={setRowRef(i)}
      style={{
        position: 'absolute', left: '6%', right: '6%', top: -ROW_HEIGHT / 2, height: ROW_HEIGHT, display: 'flex', alignItems: 'center', gap: 12, padding: '0 10px',
        background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
        backdropFilter: isActive ? 'blur(14px)' : 'none', WebkitBackdropFilter: isActive ? 'blur(14px)' : 'none',
        boxShadow: isActive ? `inset 0 0 0 1px ${t.colorA}55, 0 0 26px ${t.colorA}22` : 'none',
        transformOrigin: 'center center', willChange: 'transform, opacity', transition: 'background 0.25s ease, box-shadow 0.25s ease',
      }}
    >
      <div style={{ position: 'relative', width: 36, height: 36, flexShrink: 0, overflow: 'hidden', background: `linear-gradient(135deg, ${t.colorA}, ${t.colorB})`, boxShadow: isActive ? `0 0 18px ${t.colorA}55` : '0 2px 8px rgba(0,0,0,0.55)' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(255,255,255,0.3), rgba(255,255,255,0) 55%)' }} />
        <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 9, color: '#04070C', fontWeight: 600 }}>{(t.droneId ?? t.id).replace('D-', '')}</span>
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: SANS, fontWeight: isActive ? 600 : 500, fontSize: isActive ? 15 : 13, letterSpacing: '0.02em', color: isActive ? fgVar : fgMutedVar(0.68), textShadow: '0 1px 8px rgba(0,0,0,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
        <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.06em', color: isActive ? fgMutedVar(0.7) : fgMutedVar(0.4), textShadow: '0 1px 6px rgba(0,0,0,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.artist}</div>
      </div>
      {isActive && (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 15, flexShrink: 0 }}>
          <span style={{ width: 3, background: t.colorA, animation: isPlaying ? 'mh-eq1 0.9s ease-in-out infinite' : 'none', height: isPlaying ? undefined : 4 }} />
          <span style={{ width: 3, background: t.colorA, animation: isPlaying ? 'mh-eq2 0.75s ease-in-out infinite' : 'none', height: isPlaying ? undefined : 4 }} />
          <span style={{ width: 3, background: t.colorA, animation: isPlaying ? 'mh-eq3 1.05s ease-in-out infinite' : 'none', height: isPlaying ? undefined : 4 }} />
        </div>
      )}
    </div>
  )
}

function PlayerControls({ onPrev, onNext, onPlay, isPlaying, track, videoSoundOn, onToggleVideoSound, videoVolume, onVideoVolumeChange, compact }: {
  onPrev: () => void; onNext: () => void; onPlay: () => void; isPlaying: boolean; track: Feed
  videoSoundOn: boolean; onToggleVideoSound: () => void; videoVolume: number; onVideoVolumeChange: (v: number) => void; compact?: boolean
}) {
  const iconBtn: CSSProperties = { background: 'none', border: 'none', color: fgMutedVar(0.65), display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 6 }
  return (
    <div style={{ position: 'absolute', left: compact ? 10 : 14, right: compact ? 10 : 14, bottom: compact ? 12 : 14, zIndex: 4, background: cardVar(0.6), backdropFilter: 'blur(20px) saturate(1.2)', WebkitBackdropFilter: 'blur(20px) saturate(1.2)', boxShadow: `inset 0 0 0 1px ${CYAN}2a`, padding: compact ? '8px 12px 10px' : '10px 16px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: compact ? 34 : 40, height: compact ? 34 : 40, flexShrink: 0, background: `linear-gradient(135deg, ${track.colorA}, ${track.colorB})`, boxShadow: `0 0 16px ${track.colorA}55` }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: compact ? 12.5 : 13.5, letterSpacing: '0.03em', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</div>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.06em', color: fgMutedVar(0.55), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist}</div>
        </div>
        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.16em', color: CYAN, border: `1px solid ${CYAN}55`, padding: '3px 6px' }}>LIVE</span>
        <button onClick={onPrev} aria-label="Previous feed" style={iconBtn}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zM20 6 10 12l10 6z" /></svg>
        </button>
        <button onClick={onPlay} aria-label={isPlaying ? 'Pause feed' : 'Play feed'} style={{ ...iconBtn, width: compact ? 38 : 42, height: compact ? 38 : 42, borderRadius: 999, background: track.colorA, boxShadow: `0 0 18px ${track.colorA}66` }}>
          {isPlaying ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="#04070C"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="#04070C"><path d="M7 5v14l12-7z" /></svg>
          )}
        </button>
        <button onClick={onNext} aria-label="Next feed" style={iconBtn}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM4 6l10 6-10 6z" /></svg>
        </button>
      </div>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <style>{`
          @keyframes mh-progress { 0% { width: 0% } 100% { width: 100% } }
          .mh-vol-slider { -webkit-appearance: none; appearance: none; width: ${compact ? 46 : 60}px; height: 3px; background: rgba(255,255,255,0.18); outline: none; }
          .mh-vol-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 11px; height: 11px; border-radius: 50%; background: ${CYAN}; box-shadow: 0 0 6px ${CYAN}aa; cursor: pointer; }
          .mh-vol-slider::-moz-range-thumb { width: 11px; height: 11px; border: none; border-radius: 50%; background: ${CYAN}; box-shadow: 0 0 6px ${CYAN}aa; cursor: pointer; }
        `}</style>
        <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.14)', overflow: 'hidden' }}>
          <div key={track.id} style={{ height: '100%', background: track.colorA, animation: isPlaying ? 'mh-progress 28s linear infinite' : 'none', width: isPlaying ? undefined : '22%' }} />
        </div>
        <button onClick={onToggleVideoSound} aria-label={videoSoundOn ? 'Mute feed ambience' : 'Unmute feed ambience'} style={{ background: 'none', border: 'none', padding: 2, display: 'flex', cursor: 'pointer', color: videoSoundOn ? CYAN : fgMutedVar(0.5) }}>
          {videoSoundOn ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 5 6 9H2v6h4l5 4V5z" /><line x1="21" y1="9" x2="16" y2="14" /><line x1="16" y1="9" x2="21" y2="14" /></svg>
          )}
        </button>
        <input className="mh-vol-slider" type="range" min={0} max={MAX_VIDEO_VOLUME} step={0.01} value={videoVolume} onChange={(e) => onVideoVolumeChange(Number(e.target.value))} aria-label="Feed ambience volume" />
      </div>
    </div>
  )
}
