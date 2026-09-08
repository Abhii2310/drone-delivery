# SKYGUARD — UI System & Free Data Sources

Your UI brief is now the binding spec. This document turns it into something implementable: tokens, systems, exact component anatomy, and choreographed state transitions. Plus the free APIs worth wiring in.

---

# PART 1 — FREE APIS

Six of these are keyless. Verify each still works in your first hour — free tiers change and my knowledge has a cutoff.

| API | Key? | Use in SKYGUARD | When to call |
|---|---|---|---|
| **OpenFreeMap** | No | Basemap + 3D building extrusions. `tiles.openfreemap.org/styles/liberty` | Runtime |
| **Protomaps / PMTiles** | No | Offline 4km Bengaluru extract, served from FastAPI | Build time, once |
| **Overpass (OSM)** | No | Real hospital, school, and building coordinates to seed `city.py` | **Build time only** |
| **Open-Meteo** | No | Real Bengaluru wind, gusts, precipitation, visibility | Runtime, 10-min poll |
| **OpenSky Network** | No | Live ADS-B — real aircraft over Bengaluru | Build time, cached |
| **Nominatim** | No | Geocoding place names while authoring the fixture | Build time only |
| **MapTiler** | Free tier | Backup basemap if OpenFreeMap is down | Runtime |
| **Anthropic** | Yours | Supervisor + policy compiler | Runtime |

## The two that actually change the product

**Open-Meteo** — free, no signup, no key. `api.open-meteo.com/v1/forecast?latitude=12.97&longitude=77.59&current=wind_speed_10m,wind_direction_10m,precipitation,visibility`.

Wire it into the physics, not just a widget:

```python
headwind = wind_speed * cos(radians(drone.heading - wind_direction))
effective_speed = drone.speed - headwind
battery_drain *= 1 + 0.04 * max(0, headwind)      # headwind costs battery
if gusts > 12 or visibility < 2000: emit ADVISORY incident
```

Now your battery-reserve calculation is grounded in *today's real weather over Bengaluru*, your BAD WEATHER scenario button is one line (`wind_override = 18 m/s`), and the AI's reasoning can say "headwind on corridor C3 adds 4.2% battery cost." Cost: about 30 lines. Payoff: disproportionate.

**OpenSky** — `opensky-network.org/api/states/all?lamin=12.7&lomin=77.3&lamax=13.2&lomax=77.9` returns live aircraft state vectors. Bengaluru has KIA and HAL airport, so there is always traffic.

Fetch once at hour 0, dump 60 seconds of it to `fixtures/adsb.json`, replay on loop. Render as grey aircraft glyphs at 2000m+ with their own altitude tethers, and have the safety engine run the *same* CPA function against them.

The claim this buys you: **"SKYGUARD deconflicts drones against real manned aviation, not just against itself."** Cached replay means it cannot fail on stage. Roughly 90 minutes of work; the highest ratio of judge-impact to effort in the whole build.

## Overpass — seed the city with real Bengaluru

Run once, commit the output, never call at runtime (their usage policy forbids hammering it):

```
[out:json][timeout:30];
(
  node["amenity"="hospital"](12.955,77.575,12.995,77.615);
  node["amenity"="school"](12.955,77.575,12.995,77.615);
  way["building"]["height"](12.955,77.575,12.995,77.615);
);
out center;
```

Real hospital names and coordinates in your fixture makes the demo land differently from `Hospital_1` at a made-up point.

## Rules

- Build-time APIs (Overpass, Nominatim, OpenSky) → run once, commit JSON, never at runtime.
- Runtime APIs (tiles, Open-Meteo) → cache aggressively, always have a hardcoded fallback value, never let a fetch block a render.
- Every external call needs a 3-second timeout and a working default. Venue wifi is the enemy.

---

# PART 2 — UI SYSTEM

## 2.1 The direction, and why it isn't the default

"Dark cinematic command center" is your brief and I'm following it exactly. But the default execution of that brief — near-black background, cyan-and-green neon, glowing rounded cards, grid lines everywhere — is what every AI-generated dashboard looks like, and a judge who's seen three of them today will pattern-match instantly.

So the same brief, executed from a real source: **night VFR sectional charts and ATC flight progress strips.** Deep navy instead of black. Sectional magenta, beacon amber and VFR blue instead of neon cyan. Flight strips instead of cards. It reads as more authentic *and* more distinctive, and it satisfies every line of your brief.

---

## 2.2 Tokens

```css
:root {
  /* surfaces — navy, never tinted black */
  --ink:          #0E1626;   /* app base, behind the map */
  --panel:        #152238;   /* rail glass tint */
  --panel-solid:  #1A2842;   /* drawers, modals */
  --rule:         #2B3D5C;   /* hairlines */
  --rule-soft:    #1F2E47;
  /* text */
  --paper:        #EAF0F8;   /* primary */
  --graticule:    #8195B4;   /* secondary */
  --muted:        #56688A;   /* tertiary, disabled */
  /* operational state — the ONLY saturated colours on screen */
  --nominal:      #5B9DD9;   /* VFR blue — normal ops. calm. no glow. */
  --advisory:     #F5A524;   /* beacon amber — warning */
  --critical:     #E0398B;   /* sectional magenta — critical */
  --emergency:    #FF5A3C;   /* city-wide emergency, chrome only */
  --executed:     #3DD68C;   /* success. tiny. transient. */
  /* geometry */
  --r-sm: 2px;  --r-md: 3px;  --r-lg: 4px;   /* nothing rounder than 4px */
  --rail-l: 292px;  --rail-r: 360px;
  --bar-h: 56px;    --timeline-h: 108px;  --timeline-collapsed: 32px;
  /* motion */
  --t-instant: 90ms;  --t-quick: 180ms;  --t-standard: 320ms;  --t-cine: 1400ms;
  --ease-out: cubic-bezier(0.2, 0, 0, 1);
  --ease-in:  cubic-bezier(0.4, 0, 1, 1);
}
```

**Nominal is blue, not green.** Twelve drones flying normally should be *quiet*. Green is reserved for one thing: the moment an action executes. It appears for 900ms and leaves. This is what makes a critical incident impossible to miss — it's the only saturated thing on screen.

## 2.3 Typography

Two families. Neither is a default UI font.

- **Barlow Semi Condensed** — all UI text. Condensed grotesques are the transport/aviation vernacular, and they let a flight strip carry twice the data per row.
- **IBM Plex Mono** — every number, always with `font-variant-numeric: tabular-nums`. Without tabular figures, altitude and battery readouts jitter horizontally as they tick and the whole thing feels cheap.

```
display   22 / 1.10 / 600   — only the word SKYGUARD. Nothing else is ever this big.
title     15 / 1.30 / 600   — panel headers, drawer titles
body      13 / 1.45 / 400   — reasoning text, descriptions
label     11 / 1.20 / 500 / +0.04em  — field labels
mono-lg   18 / 1.00 / 500   — hero telemetry in the drone drawer
mono      12 / 1.30 / 400   — strip telemetry, timeline stamps
mono-sm  10.5/ 1.20 / 400   — units, secondary readouts
```

Sentence case in all prose. Uppercase only for callsigns (`D-104`), zone codes (`NO-FLY A1`), and status chips — that's real domain usage, not styling. Your brief says no huge headings; the scale enforces it.

## 2.4 Glass, depth and glow — three rules that prevent mud

**Glass never stacks.** Exactly three surface levels, and a blurred surface never sits on another blurred surface.

```css
/* L1 — rails, floating over the map */
.glass-rail {
  background: rgba(21, 34, 56, 0.82);
  backdrop-filter: blur(20px) saturate(1.3);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.07),   /* top-left light */
              0 16px 40px rgba(0, 0, 0, 0.45);
}
/* L2 — drone drawer, modals: more opaque, text must be readable */
.glass-drawer { background: rgba(26,40,66,0.94); backdrop-filter: blur(28px); }
/* L3 — critical alerts: SOLID. No blur. Never compromise legibility under stress. */
.alert-band  { background: var(--panel-solid); backdrop-filter: none; }
```

**One light source, top-left.** Every surface gets `inset 0 1px 0 rgba(255,255,255,0.07)` on its top edge and drops shadow down-right. Consistent across every element. That single rule is what reads as "depth" instead of "random shadows."

**Glow is a state signal, never decoration.** Exactly three things are ever allowed to glow:

1. A critical incident (magenta, 1.4s pulse)
2. Emergency mode active (the chrome frame)
3. The currently selected drone (steady, subtle)

Everything else is flat. This is the rule that keeps it from sliding into gaming-UI neon.

```css
.glow-critical { box-shadow: 0 0 0 1px var(--critical),
                             0 0 24px -4px rgba(224,57,139,0.55);
                 animation: pulse 1.4s var(--ease-out) infinite; }
```

## 2.5 Motion

| Token | Duration | Used for |
|---|---|---|
| instant | 90ms | hover, focus ring, chip state |
| quick | 180ms | toggles, panel expand, alert band |
| standard | 320ms | drawer slide, strip reorder |
| cinematic | 1400ms | camera flyTo, incident takeover, emergency transform |

**Only one cinematic moment may run at a time.** Queue them. Two competing camera moves is the single fastest way to look broken.

Entrances decelerate (`--ease-out`), exits accelerate (`--ease-in`). No hover lifts, no card entrance animations, no ambient background motion, no scanning lines except during the AI "investigating" state where it signals genuine work in progress. `prefers-reduced-motion` cuts every duration to 0 except camera flyTo, which drops to 200ms.

---

## 2.6 Layout

The map is not a panel in a grid. It fills the viewport edge to edge; everything else floats on it.

```
┌────────────────────────────────────────────────────────────────────────┐
│ ◈ SKYGUARD   BENGALURU · NOMINAL   12 airborne · 8 missions ·         │ 56
│              2 incidents          AI LIVE ●    EMERGENCY OFF      ⌘K  │
├──────────────┬───────────────────────────────────┬─────────────────────┤
│ FLEET        │                                   │ AI SUPERVISOR       │
│              │                                   │                     │
│ ▌D-01  ENR   │        3D city, full bleed        │ No open incidents.  │
│  118m  62%   │        under everything           │ Airspace nominal.   │
│  MED→HOSP-2  │                                   │                     │
│ ─────────────│                                   │ ───────────────     │
│ ▌D-02  ENR   │                                   │ WEATHER             │
│  102m  88%   │                                   │ 8.2 m/s  241°       │
│  PKG→ZONE-C  │           [drone glyphs]          │ vis 9.4km           │
│ ─────────────│                                   │                     │
│  292px       │                                   │  360px              │
├──────────────┴───────────────────────────────────┴─────────────────────┤
│ ◂ 22:14:31 D-04 departed HUB-MED  ·  22:14:38 conflict C3×C7 ▸    ▴   │ 108
└────────────────────────────────────────────────────────────────────────┘
```

Rails: L1 glass, 1px hairline edge, `border-radius: 0` on the outer edges (they meet the viewport), `--r-sm` on inner corners only. 8px spacing base; 16px rail padding; 12px between strips.

---

## 2.7 Flight strips — the fleet list

Not cards. Physical ATC progress strips: hairline separators, no shadows, no rounded corners, no gaps between them.

```
┌────────────────────────────────────────┐
│▌ D-01                        ENROUTE   │  ← 3px status bar, left edge
│  118 m   62%   14.2 m/s   087°         │  ← mono, tabular
│  Medicine → Hospital 2       CRITICAL  │  ← mission, priority chip
└────────────────────────────────────────┘
   64px tall, 1px --rule-soft separator
```

- Left bar colour = operational state. Nominal blue, advisory amber, critical magenta with pulse.
- Hover: background lifts to `rgba(255,255,255,0.03)`, 90ms. No transform, no shadow.
- Selected: left bar widens to 5px, subtle steady glow, background `rgba(91,157,217,0.08)`.
- Strips **reorder by priority**, animated once at 320ms with FLIP. A critical drone rising to the top of the list is itself an alert.
- Battery under 25% renders the number in amber; under 15%, magenta.

Empty state: "No drones assigned to this operator." Not "No data."

---

## 2.8 Drone Command Drawer

Slides in from the right **over** the supervisor rail — the map never resizes, because resizing the map re-renders the 3D scene and stutters.

```
380px wide, L2 glass, slides 320ms --ease-out
┌──────────────────────────────────────┐
│ D-01                    ● ENROUTE  ✕ │  title + status chip
├──────────────────────────────────────┤
│  118      62      14.2      087      │  mono-lg, hero telemetry
│  ALT m    BAT %   SPD m/s   HDG °    │  label
├──────────────────────────────────────┤
│ MISSION                              │
│ Medicine · CRITICAL                  │
│ Medical Hub → Hospital 2             │
│ ETA 00:47 · Corridor C3              │
├──────────────────────────────────────┤
│ ALTITUDE PROFILE                     │
│  150 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  ceiling │
│      ╱‾‾‾‾‾‾‾‾‾‾‾╲                   │  ← flight path cross-section
│   90 ────────────────▓▓▓▓───  HOSP-2 │  ← zone ceilings overlaid
│      ▲you                            │
├──────────────────────────────────────┤
│ HEALTH                               │
│ Motors ████████░░  Comms ██████████  │
│ GPS    ██████████  Payload  1.2 kg   │
├──────────────────────────────────────┤
│  [  VIEW FROM DRONE  ]               │  primary, full width
│  [ Hold ]  [ Return to hub ]         │  secondary
└──────────────────────────────────────┘
```

The **altitude profile** is the component that makes this drawer distinctive rather than a spec sheet. A cross-section of the flight path with zone ceilings drawn as horizontal bands and a marker for current position. It uses data you already have, it makes the 3D airspace legible in 2D, and nothing else in the demo shows it. Build it as an inline SVG, ~60 lines.

---

## 2.9 Incident takeover — choreograph this to the millisecond

This is demo 2. Spec it exactly, build it once, don't improvise.

```
t=0      incident.created arrives over WS
t=0      alert band slides down under the top bar (180ms)
         "CONFLICT PREDICTED · D-01 × D-07 · 11.4 m in 18 s"
         magenta, solid background, no blur
t=0      map begins flyTo incident frame (1400ms, cinematic)
t=120    supervisor rail expands 360 → 440px (320ms), auto-focuses
t=200    "Investigating" — scanning line sweeps the panel,
         fact rows stream in one at a time (80ms apart):
           separation 11.4 m · closing 18.2 m/s · t-CPA 18 s
           D-01 CRITICAL medicine · D-07 NORMAL package
t=1400   camera settles; conflict point marker pulses on the map
t≈2000   decision.ready
         alternatives stagger in, 60ms apart, max 4
         recommended one carries a 1px amber ring
         each shows: risk after · SLA delta · battery delta · community delta
         [ Approve reroute ] enables with a 90ms scale-in from 0.98
── human clicks ──
t=0      button → "Applying…" with a spinner. NEVER optimistic.
t≈200    decision.executed arrives from the server
t=200    old route fades to 30% dashed ghost (200ms)
t=280    new route draws from the drone outward, stroke-dashoffset (600ms)
t=400    drone banks — heading eases over the next 8 telemetry ticks
t=900    timeline stamps the event; amber tick turns green for 900ms
t=1100   alert band retracts, supervisor collapses back to 360px
```

Two things that must not be compromised: the approve button never shows success before the server confirms, and the route only changes because `decision.executed` arrived. If a judge opens devtools, the network tab has to tell the same story as the screen.

**AI off:** the alert band appears and the camera flies in. That's all. The supervisor rail stays empty and reads *"AI Supervisor disabled. Raw safety alert only."* The absence is the argument.

---

## 2.10 Emergency mode — transform the chrome, not 200 components

One class on `<body>`, a variable swap, and a frame element. That's the whole transformation.

```css
body.emergency {
  --ink:      #1A1420;      /* base warms from navy toward ember */
  --panel:    #241A26;
  --nominal:  #7C8FB0;      /* normal ops visually recede */
}
body.emergency::after {          /* the frame */
  content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 9999;
  border: 2px solid var(--emergency);
  box-shadow: inset 0 0 80px -30px rgba(255,90,60,0.5);
}
```

Activation sequence (cinematic, 1400ms, runs once):

```
t=0     top bar band expands to 72px, diagonal hazard hatching,
        "FLOOD RESPONSE ACTIVE · ZONE B · 00:04:12"  with a live counter
t=180   frame fades in
t=200   base colour crossfades navy → ember (900ms)
t=400   flood polygon rises on the map as an extruded translucent volume
t=600   emergency corridors illuminate; normal corridors dim to 25%
t=800   paused missions grey out in the fleet list, one strip at a time (50ms apart)
t=1000  left rail gains a section header: AVAILABLE FOR RESCUE — 7 drones
t=1200  summary lands in the supervisor rail:
        "24 flights affected — 17 rerouted, 4 returning, 2 landing, 1 paused"
```

Those numbers come from real state. Never hardcode them; the whole demo rests on them being computed.

Deactivation reverses in 600ms — quicker, because coming out of an emergency shouldn't be dramatic.

---

## 2.11 State design — every surface, every state

Your brief asks for loading, empty, error, confirmation and success states. Here they are, with copy.

| Surface | Loading | Empty | Error |
|---|---|---|---|
| Map | Skeleton grid + "Establishing telemetry link" | — | "Telemetry link lost. Reconnecting… (attempt 3)" band |
| Fleet | 4 shimmer strips | "No drones assigned to this operator." | "Fleet data unavailable." + Retry |
| Supervisor | Scanning line + streaming facts | "No open incidents. Airspace nominal." | "Supervisor unreachable — using local safety engine." |
| Timeline | — | "No events yet. Create a delivery to begin." | — |
| Drawer | Telemetry dashes `—` | — | "Drone D-09 is not reporting." |

**Confirmation** is required for exactly three actions: approving a CRITICAL decision, closing a zone, and activating emergency mode. Inline within the panel — never a modal over the map, because the operator needs to keep watching the airspace. Escape cancels, Enter confirms.

**Success** is quiet and transient: the button label changes to the past tense of itself ("Approve reroute" → "Approved 22:14:41"), a green tick sits in the timeline for 900ms and fades to neutral. No toasts, no confetti, no full-width success banners.

**Errors don't apologise and are never vague.** "Reroute rejected: corridor C7 enters NO-FLY A1 at 340m." Say what happened and what the constraint was.

---

## 2.12 Keyboard

An ops console that can't be driven from the keyboard reads as a mockup. This costs 40 lines and it's a credibility signal.

```
1 / 2 / 3   city view / incident view / drone view
↑ ↓         move through flight strips
Enter       open drone drawer
F           follow selected drone
A           approve the focused decision       (requires the panel to be focused)
X           reject
E           toggle emergency mode              (with confirm)
Space       pause / resume simulation
R           reset demo                         (with confirm)
Esc         close drawer / cancel confirmation
⌘K / Ctrl-K command palette
```

Visible focus rings everywhere: `outline: 2px solid var(--nominal); outline-offset: 2px`. Never `outline: none`.

---

## 2.13 Responsive — be honest about it

A city command center is not a phone app. Degrade truthfully rather than pretending.

- **≥1600px** — full layout, both rails, timeline expanded.
- **1280–1600** — timeline collapses to 32px, right rail 320px.
- **1024–1280** — left rail collapses to a 56px icon strip; drone drawer becomes full-height overlay.
- **768–1024** — both rails become overlay sheets triggered from the top bar. Map stays full-bleed.
- **<768** — read-only monitoring: map, top bar status, incident alerts. Approval controls hidden with the message *"Approvals require a workstation."* That's a deliberate operational statement, not a limitation.

---

## 2.14 Build order — functionality first, exactly as your brief says

Do not apply the visual layer until the loop works. But do these three things early, because retrofitting them is expensive:

1. **Tokens in `index.css` at hour 1.** Every component uses variables from the start. The polish pass then becomes editing eight hex values, not 40 files.
2. **Layout shell at hour 1.5** — rails floating over a full-bleed map. The structure is hard to change later; the styling is easy.
3. **The state-colour semantic at hour 4**, when the safety engine lands. Nominal/advisory/critical/emergency wired to real state from the beginning means the polish pass has nothing to rewire.

Everything else — glass, motion choreography, the altitude profile, the HUD, the emergency transformation — lands in the 10.2–11.0 window.

---

# PART 3 — PROMPT BLOCK FOR CLAUDE CODE

Append to your existing prompt.

```
## UI — this is a binding specification, not a suggestion
Build a dark cinematic airspace command center. Do NOT build a Tailwind admin dashboard.
Build functionality first; apply the full visual layer in the final polish pass. But define
the CSS tokens and the layout shell in the first two hours so polish is a token edit, not a
rewrite.
### Tokens (index.css :root)
--ink #0E1626 (deep navy base, never tinted black) · --panel #152238 · --panel-solid #1A2842
--rule #2B3D5C · --rule-soft #1F2E47 · --paper #EAF0F8 · --graticule #8195B4 · --muted #56688A
--nominal #5B9DD9 · --advisory #F5A524 · --critical #E0398B · --emergency #FF5A3C
--executed #3DD68C
Radius never exceeds 4px. Rails 292px left / 360px right. Top bar 56px. Timeline 108px.
Motion: instant 90ms, quick 180ms, standard 320ms, cinematic 1400ms.
Ease out cubic-bezier(0.2,0,0,1); ease in cubic-bezier(0.4,0,1,1).
### Type
Barlow Semi Condensed for all UI. IBM Plex Mono for every number, always tabular-nums.
Largest text on screen is 22px and it is only the word SKYGUARD. Sentence case in prose;
uppercase only for callsigns, zone codes and status chips.
### Three hard rules
1. Nominal state is BLUE and calm, never green. Green appears only on execution, for 900ms.
   Saturated colour on screen means something is wrong.
2. Glass never stacks. Rails are rgba(21,34,56,0.82) + blur(20px) saturate(1.3) + 1px
   rgba(255,255,255,0.06) border + inset 0 1px 0 rgba(255,255,255,0.07) + 0 16px 40px
   rgba(0,0,0,0.45). Critical alert bands are SOLID with no blur — legibility over effect.
3. Glow is a state signal, never decoration. Only three things ever glow: a critical incident,
   emergency mode, and the selected drone. Everything else is flat. No neon.
### Layout
Map is full-bleed, edge to edge, filling the viewport. Rails FLOAT over it as glass. The map
never resizes when a panel opens — resizing re-renders the 3D scene and stutters.
### Fleet list = FLIGHT STRIPS, not cards
64px rows, 3px left status bar coloured by operational state, callsign in condensed caps,
telemetry in mono, mission and priority on line two, 1px hairline separators, no gaps, no
shadows, no rounded corners. Hover raises background 3%, 90ms, no transform. Selected widens
the bar to 5px with a steady glow. Strips reorder by priority with a single 320ms FLIP
animation. Battery under 25% renders amber, under 15% magenta.
### Drone Command Drawer
380px, slides from the right OVER the right rail, 320ms. Hero telemetry row (alt / battery /
speed / heading) in 18px mono with 11px labels. Mission block. Health bars. Then an ALTITUDE
PROFILE: an inline SVG cross-section of the flight path with zone ceilings drawn as horizontal
bands and a marker at the current position. Then a full-width primary "VIEW FROM DRONE" button
and secondary Hold / Return to hub.
### Incident takeover — implement this choreography exactly
t=0 alert band slides down (180ms, solid magenta, no blur) with separation and t-CPA
t=0 map flyTo the incident frame (1400ms)
t=120 right rail expands 360→440px (320ms)
t=200 "Investigating": scanning line, fact rows stream in 80ms apart
t=1400 camera settles, conflict marker pulses
t=2000 alternatives stagger in 60ms apart, recommended one gets a 1px amber ring, each showing
       risk after / SLA delta / battery delta / community delta; Approve enables with a 90ms
       scale-in
On click: button shows "Applying…" with a spinner and NEVER shows success optimistically.
On decision.executed: old route fades to a 30% dashed ghost (200ms), new route draws outward
from the drone via stroke-dashoffset (600ms), drone banks over 8 telemetry ticks, timeline
stamps the event with a green tick that fades after 900ms, alert band retracts.
With AI disabled: the alert band and camera move happen and nothing else. The rail reads
"AI Supervisor disabled. Raw safety alert only."
### Emergency mode — transform the chrome via one body class
body.emergency swaps --ink to #1A1420, --panel to #241A26, desaturates --nominal, and adds a
::after fixed frame with a 2px --emergency border and inset 0 0 80px -30px rgba(255,90,60,0.5).
Activation sequence: top band expands to 72px with diagonal hazard hatching and a live elapsed
counter → frame fades in → base colour crossfades over 900ms → flood polygon rises as an
extruded volume → emergency corridors illuminate while normal corridors dim to 25% → paused
missions grey out one strip at a time 50ms apart → left rail gains "AVAILABLE FOR RESCUE — n
drones" → the affected-flights summary lands in the right rail. Every number must be computed
from real state. Deactivation reverses in 600ms.
### States — implement all of them
Loading: map "Establishing telemetry link" with a skeleton grid; fleet shimmer strips;
supervisor scanning line.
Empty: "No open incidents. Airspace nominal." / "No events yet. Create a delivery to begin."
Error: never vague, never apologising. "Reroute rejected: corridor C7 enters NO-FLY A1 at 340m."
Confirmation: inline in the panel, never a modal over the map. Required for approving CRITICAL
decisions, closing a zone, and activating emergency mode. Esc cancels, Enter confirms.
Success: quiet. The button becomes its own past tense ("Approved 22:14:41"), a green timeline
tick fades after 900ms. No toasts.
### Keyboard
1/2/3 camera modes · ↑↓ flight strips · Enter open drawer · F follow · A approve · X reject ·
E emergency (confirm) · Space pause · R reset (confirm) · Esc close · ⌘K palette.
Visible focus rings everywhere: outline 2px solid var(--nominal), offset 2px. Never
outline:none.
### Motion discipline
Only ONE cinematic animation at a time — queue them. No hover lifts, no card entrance
animations, no ambient background motion, no gradient washes. The only scanning line is the AI
investigating state, where it signals real work. prefers-reduced-motion cuts all durations to 0
except camera moves, which drop to 200ms.
### Responsive
≥1600 full · 1280–1600 timeline collapses, right rail 320px · 1024–1280 left rail becomes a
56px icon strip · 768–1024 rails become overlay sheets · <768 read-only monitoring with
approval controls hidden and the message "Approvals require a workstation."
### Weather (Open-Meteo, keyless)
Poll api.open-meteo.com every 10 minutes for wind_speed_10m, wind_direction_10m, precipitation,
visibility at 12.97/77.59. 3-second timeout with a hardcoded fallback. Feed it into the physics:
headwind = wind_speed * cos(heading - wind_direction); effective speed reduced; battery drain
multiplied by (1 + 0.04 * max(0, headwind)); emit an ADVISORY when gusts exceed 12 m/s or
visibility drops below 2000 m. Show wind speed and bearing in the right rail. The BAD WEATHER
scenario button overrides wind to 18 m/s.
### Real aircraft (OpenSky, keyless) — build only if ahead of schedule
Fetch opensky-network.org/api/states/all for the Bengaluru bbox ONCE at build time, save 60
seconds of it to fixtures/adsb.json, replay on loop. Render as grey aircraft glyphs above
2000 m with altitude tethers. Run the SAME predict_collision function against them so drones
deconflict from real manned aviation. Cached replay only — never fetch at runtime.
```
