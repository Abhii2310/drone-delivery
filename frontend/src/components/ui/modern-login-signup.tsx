import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'

// ─────────────────────────────────────────────────────────────
// SKYGRID SIGN-IN
// Adapted from the "modern login" component. The dot-matrix reveal
// is the same shader, but it runs on raw WebGL2 instead of loading
// Three.js from a CDN: no dependency, works offline, ~40 lines. The
// form is the part that actually matters here: signing in means
// choosing the scope you are accountable for, and the command
// center opens filtered to exactly that role.
// ─────────────────────────────────────────────────────────────

type Role = 'GOVERNMENT' | 'OPERATOR' | 'HUB_ENGINEER' | 'CUSTOMER'

const ROLES: { id: Role; label: string; scope: string; sees: string }[] = [
  { id: 'GOVERNMENT', label: 'Government', scope: 'CITY-WIDE', sees: 'Every aircraft, every operator, zone control, emergency activation' },
  { id: 'OPERATOR', label: 'Fleet operator', scope: 'OWN FLEET', sees: 'Your aircraft, your missions, your incidents' },
  { id: 'HUB_ENGINEER', label: 'Hub engineer', scope: 'ASSIGNED HUB', sees: 'Pad occupancy, landing requests, maintenance queue' },
  { id: 'CUSTOMER', label: 'Customer', scope: 'OWN MISSION', sees: 'Mission status, ETA, proof of delivery' },
]

const CYAN = '#35D6F0'
const SANS = "'Barlow Semi Condensed', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"

const VERT = `#version 300 es
precision mediump float;
in vec2 position;
uniform vec2 u_resolution;
out vec2 fragCoord;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  fragCoord = (position + 1.0) * 0.5 * u_resolution;
  fragCoord.y = u_resolution.y - fragCoord.y;
}`

const FRAG = `#version 300 es
precision mediump float;
in vec2 fragCoord;
uniform float u_time;
uniform float u_opacities[10];
uniform vec3 u_colors[6];
uniform float u_total_size;
uniform float u_dot_size;
uniform vec2 u_resolution;
out vec4 fragColor;
float PHI = 1.61803398874989484820459;
float random(vec2 xy) { return fract(tan(distance(xy * PHI, xy) * 0.5) * xy.x); }
void main() {
  vec2 st = fragCoord.xy;
  st.x -= abs(floor((mod(u_resolution.x, u_total_size) - u_dot_size) * 0.5));
  st.y -= abs(floor((mod(u_resolution.y, u_total_size) - u_dot_size) * 0.5));
  float opacity = step(0.0, st.x) * step(0.0, st.y);
  vec2 st2 = vec2(int(st.x / u_total_size), int(st.y / u_total_size));
  float frequency = 5.0;
  float show_offset = random(st2);
  float rand = random(st2 * floor((u_time / frequency) + show_offset + frequency));
  opacity *= u_opacities[int(rand * 10.0)];
  opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.x / u_total_size));
  opacity *= 1.0 - step(u_dot_size / u_total_size, fract(st.y / u_total_size));
  vec3 color = u_colors[int(show_offset * 6.0)];
  vec2 center_grid = u_resolution / 2.0 / u_total_size;
  float dist_from_center = distance(center_grid, st2);
  float timing = dist_from_center * 0.01 + (random(st2) * 0.15);
  float t = u_time * 3.0;
  opacity *= step(timing, t);
  opacity *= clamp((1.0 - step(timing + 0.1, t)) * 1.25, 1.0, 1.25);
  fragColor = vec4(color * opacity, opacity);
}`

/** The dot-matrix reveal on bare WebGL2. Silently renders nothing if WebGL is unavailable. */
function DotMatrix() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: true })
    if (!gl) return
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
    const pos = gl.getAttribLocation(prog, 'position')
    gl.enableVertexAttribArray(pos)
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0)
    const u = (name: string) => gl.getUniformLocation(prog, name)
    gl.uniform1fv(u('u_opacities'), new Float32Array([0.3, 0.3, 0.3, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 1.0]))
    // mostly the console's cool white, with a cyan minority so the field reads as the grid
    const c = [0.62, 0.72, 0.84, 0.62, 0.72, 0.84, 0.21, 0.84, 0.94, 0.62, 0.72, 0.84, 0.21, 0.84, 0.94, 0.42, 0.52, 0.64]
    gl.uniform3fv(u('u_colors'), new Float32Array(c))
    gl.uniform1f(u('u_total_size'), 20.0)
    gl.uniform1f(u('u_dot_size'), 3.0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    const uRes = u('u_resolution')
    const uTime = u('u_time')
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.floor(canvas.clientWidth * dpr)
      canvas.height = Math.floor(canvas.clientHeight * dpr)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(uRes, canvas.width, canvas.height)
    }
    resize()
    window.addEventListener('resize', resize)
    const start = performance.now()
    let raf = 0
    const frame = () => {
      gl.uniform1f(uTime, (performance.now() - start) / 1000)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      gl.deleteProgram(prog)
      gl.deleteBuffer(buf)
    }
  }, [])
  return <canvas ref={ref} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0, opacity: 0.55 }} />
}

const field: CSSProperties = {
  width: '100%', padding: '12px 14px', border: '1px solid #1A2634', background: '#070C14', color: '#E9EFF7',
  fontFamily: SANS, fontSize: 14, outline: 'none', boxSizing: 'border-box',
}
const secondary: CSSProperties = {
  width: '100%', padding: '11px 14px', border: '1px solid #1A2634', background: 'transparent', color: '#E9EFF7',
  fontFamily: SANS, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
}
const primary: CSSProperties = {
  width: '100%', padding: '13px 14px', border: `1px solid ${CYAN}`, background: CYAN, color: '#04070C',
  fontFamily: SANS, fontWeight: 600, fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', cursor: 'pointer',
}

export default function Component({ commandUrl = '/command', homeUrl = '/' }: { commandUrl?: string; homeUrl?: string }) {
  const [isLogin, setIsLogin] = useState(true)
  const [role, setRole] = useState<Role>('GOVERNMENT')
  const [email, setEmail] = useState('')
  const [org, setOrg] = useState('')
  const [requested, setRequested] = useState(false)
  const [entering, setEntering] = useState(false)

  const enter = () => {
    setEntering(true)
    // a beat so the reveal reads as a transition, not a page flash
    setTimeout(() => { window.location.href = `${commandUrl}?role=${role}` }, 420)
  }
  const onSignIn = (e: FormEvent) => { e.preventDefault(); enter() }
  const onRequest = (e: FormEvent) => { e.preventDefault(); setRequested(true) }
  const active = ROLES.find((r) => r.id === role)!

  return (
    <div style={{ position: 'relative', width: '100%', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#04070C', color: '#E9EFF7', fontFamily: SANS, padding: 20, boxSizing: 'border-box' }}>
      <style>{`
        .sg-in:focus { border-color: ${CYAN} !important; box-shadow: 0 0 0 3px ${CYAN}22; }
        .sg-role[aria-pressed='true'] { border-color: ${CYAN}; background: ${CYAN}0f; }
        .sg-role:hover { border-color: #2A3B4E; }
        .sg-btn-secondary:hover { border-color: ${CYAN}; color: ${CYAN}; }
        .sg-btn-primary:hover { background: #7BE8FA; box-shadow: 0 0 34px ${CYAN}55; }
        @keyframes sg-enter { to { opacity: 0; transform: scale(0.985); } }
      `}</style>
      <DotMatrix />
      <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'radial-gradient(ellipse 60% 55% at 50% 50%, rgba(4,7,12,0.85) 0%, rgba(4,7,12,0.2) 70%, rgba(4,7,12,0) 100%)', pointerEvents: 'none' }} />

      <a href={homeUrl} style={{ position: 'absolute', top: 22, left: 24, zIndex: 3, display: 'flex', alignItems: 'center', gap: 10, color: '#E9EFF7', textDecoration: 'none' }}>
        <span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, border: `1.5px solid ${CYAN}`, transform: 'rotate(45deg)' }} />
        <span style={{ fontWeight: 600, fontSize: 14, letterSpacing: '0.26em' }}>SKYGRID</span>
      </a>
      <span style={{ position: 'absolute', top: 26, right: 24, zIndex: 3, fontFamily: MONO, fontSize: 10, letterSpacing: '0.18em', color: '#566373' }}>SECTOR BLR-C · PROTOTYPE</span>

      <div style={{ position: 'relative', zIndex: 2, width: '100%', maxWidth: 440, background: 'rgba(7,12,20,0.86)', backdropFilter: 'blur(18px)', border: '1px solid #1A2634', boxShadow: '0 30px 90px rgba(0,0,0,0.7)', padding: '30px 30px 24px', animation: entering ? 'sg-enter 420ms cubic-bezier(0.2,0,0,1) forwards' : undefined }}>
        <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.22em', color: CYAN }}>{isLogin ? 'SIGN IN' : 'REQUEST ACCESS'}</div>
        <h1 style={{ margin: '12px 0 0', fontWeight: 600, fontSize: 30, lineHeight: 1, letterSpacing: '-0.01em', textTransform: 'uppercase' }}>
          {isLogin ? <>Enter the<br />command center.</> : <>Bring your fleet<br />onto the grid.</>}
        </h1>
        <p style={{ margin: '12px 0 0', fontSize: 14, lineHeight: 1.5, color: '#8494A6' }}>
          {isLogin ? 'Choose the scope you are accountable for. The console opens filtered to exactly that, nothing more.' : 'Operators, hubs and agencies are onboarded per sector. Tell us who you are and we will follow up.'}
        </p>

        {isLogin ? (
          <form onSubmit={onSignIn} style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {ROLES.map((r) => (
                <button key={r.id} type="button" className="sg-role" aria-pressed={role === r.id} onClick={() => setRole(r.id)} style={{ textAlign: 'left', padding: '10px 12px', border: '1px solid #1A2634', background: 'transparent', color: '#E9EFF7', cursor: 'pointer', transition: 'all 160ms' }}>
                  <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 13, letterSpacing: '0.02em' }}>{r.label}</div>
                  <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.14em', color: role === r.id ? CYAN : '#566373', marginTop: 4 }}>{r.scope}</div>
                </button>
              ))}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.06em', color: '#566373', lineHeight: 1.5, minHeight: 32 }}>SEES · {active.sees.toUpperCase()}</div>
            <input className="sg-in" style={field} type="email" placeholder="name@agency.gov.in" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            <button type="submit" className="sg-btn-primary" style={primary}>Continue as {active.label} →</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0' }}>
              <span style={{ flex: 1, height: 1, background: '#1A2634' }} />
              <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.18em', color: '#566373' }}>OR</span>
              <span style={{ flex: 1, height: 1, background: '#1A2634' }} />
            </div>
            <button type="button" className="sg-btn-secondary" style={secondary} onClick={enter}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" /><path d="M3 9h18M8 14h4" /></svg>
              Organisation single sign-on
            </button>
            <button type="button" className="sg-btn-secondary" style={secondary} onClick={enter}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="12" r="4" /><path d="M12 12h9M18 12v3M15 12v2" /></svg>
              Hardware security key
            </button>
            <div style={{ marginTop: 10, fontSize: 13, color: '#8494A6', textAlign: 'center' }}>
              New sector or operator?{' '}
              <button type="button" onClick={() => setIsLogin(false)} style={{ color: '#E9EFF7', fontWeight: 600, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit' }}>Request access</button>
            </div>
          </form>
        ) : requested ? (
          <div style={{ marginTop: 22 }}>
            <div style={{ border: `1px solid ${CYAN}55`, background: `${CYAN}0a`, padding: 16 }}>
              <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.18em', color: CYAN }}>● REQUEST LOGGED</div>
              <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, color: '#E9EFF7' }}>{org || 'Your organisation'} is queued for sector onboarding. This is a prototype: nothing was sent anywhere.</div>
            </div>
            <button type="button" className="sg-btn-secondary" style={{ ...secondary, marginTop: 12 }} onClick={() => { setRequested(false); setIsLogin(true) }}>Back to sign in</button>
          </div>
        ) : (
          <form onSubmit={onRequest} style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input className="sg-in" style={field} type="text" placeholder="Organisation" value={org} onChange={(e) => setOrg(e.target.value)} required />
            <input className="sg-in" style={field} type="email" placeholder="name@organisation.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <select className="sg-in" style={{ ...field, appearance: 'none' }} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label} · {r.scope}</option>)}
            </select>
            <button type="submit" className="sg-btn-primary" style={primary}>Request access →</button>
            <div style={{ marginTop: 10, fontSize: 13, color: '#8494A6', textAlign: 'center' }}>
              Already onboarded?{' '}
              <button type="button" onClick={() => setIsLogin(true)} style={{ color: '#E9EFF7', fontWeight: 600, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit' }}>Sign in</button>
            </div>
          </form>
        )}

        <div style={{ marginTop: 20, paddingTop: 14, borderTop: '1px solid #111A25', fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.06em', lineHeight: 1.6, color: '#566373' }}>
          Hackathon prototype. No credentials are collected or stored; the role you choose only filters a simulated network. Not connected to real aircraft.
        </div>
      </div>
    </div>
  )
}
