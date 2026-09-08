# SKYGUARD — Build Plan

Assumes an overnight hackathon window (~12 hours), 2–4 people, demo in the morning.

---

## 0. The only success condition

```
CREATE DELIVERY → DRONE FLIES → SAFETY ENGINE DETECTS → AI INVESTIGATES
→ HUMAN APPROVES → BACKEND MUTATES ROUTE → MAP VISIBLY CHANGES → AUDIT TIMELINE
```

Everything else is decoration on this loop. If the loop is not working by hour 6, cut features, not the loop.

The judge-facing claim is: **the drone did not move because the frontend animated it. It moved because a human approved a decision that mutated server state.** Protect that claim architecturally — see §7.

---

## 1. System architecture

```
┌─────────────────────────── BROWSER ───────────────────────────┐
│  React + TS                                                    │
│                                                                │
│  ws.ts ──► telemetryStore (plain object, NOT React state)      │
│              │                                                 │
│              ├──► rAF render loop ──► Leaflet canvas layer     │
│              │        (interpolation, 60fps)                   │
│              └──► React store (Zustand) for incidents/         │
│                   decisions/missions — low frequency only      │
│                                                                │
│  REST (fetch) ──────────────────► all mutations                │
└────────────────────────────────────────────────────────────────┘
        │ WS (server→client only)        │ HTTP (client→server only)
        ▼                                 ▼
┌────────────────────────── FastAPI (one process) ──────────────┐
│                                                                │
│   ┌──────────────┐   10 Hz tick                                │
│   │  simulator   │──────────────┐                              │
│   └──────────────┘              ▼                              │
│                          ┌──────────────┐                      │
│   AppState (singleton) ◄─│ safety_engine│  deterministic       │
│   drones, zones,         └──────┬───────┘  NO LLM              │
│   corridors, hubs,              │ incidents                    │
│   missions, incidents,          ▼                              │
│   decisions, landing     ┌──────────────┐                      │
│   zones, policies,       │ ai_supervisor│  async, off-tick     │
│   audit[]                └──────┬───────┘  Claude OR MOCK      │
│        ▲                        │ decision                     │
│        │                        ▼                              │
│        └──── apply_action() ◄── human approval (REST)          │
│              ↑ THE ONLY WRITER OF ROUTES                       │
│                                                                │
│   event_bus ──► audit log + WS broadcast (2 Hz telemetry,      │
│                 immediate for events)                          │
└────────────────────────────────────────────────────────────────┘
```

**Rules that keep this from collapsing at 3am:**

1. One process, one asyncio event loop, no threads. `AppState` is a module-level singleton.
2. WebSocket is **read-only** (server → client). Every mutation is a REST call. Halves your bug surface.
3. The tick loop never awaits the LLM. AI investigation is `asyncio.create_task(...)`, incident flips `DETECTED → INVESTIGATING → AWAITING_APPROVAL`.
4. `apply_action()` is the single function allowed to change `drone.route_id`, `drone.status`, or `mission.state`. Scenario buttons, AI approvals, emergency mode, and policy compilation all call it. Every call appends an audit event automatically.
5. Seeded determinism: `random.Random(1337)` only, no `time.time()` in sim logic — advance a `sim_clock` by `dt`. `RESET` = rebuild `AppState` from the fixture.

---

## 2. Coordinate system — decide this in the first 10 minutes

Doing collision math in lat/lng degrees is the single most likely thing to sink this build. A degree of longitude in Bengaluru is ~108.5 km; a degree of latitude ~110.9 km. Separation math in degrees will silently be wrong by ~2%, and worse, unreadable.

**Work in local ENU metres. Convert to lat/lng only at the serialization boundary.**

```python
ORIGIN_LAT, ORIGIN_LNG = 12.9716, 77.5946   # Bengaluru datum
M_PER_DEG_LAT = 110_900
M_PER_DEG_LNG = 110_900 * math.cos(math.radians(ORIGIN_LAT))  # ≈ 108_100
def to_xy(lat, lng): return ((lng-ORIGIN_LNG)*M_PER_DEG_LNG, (lat-ORIGIN_LAT)*M_PER_DEG_LAT)
def to_ll(x, y):     return (ORIGIN_LAT + y/M_PER_DEG_LAT, ORIGIN_LNG + x/M_PER_DEG_LNG)
```

All state stores `x, y, alt` in metres. Shapely polygons are built in metre space. `to_ll` is called once per drone per broadcast. Done.

---

## 3. Data model

Pydantic, all in `models.py`. Only the fields you will actually render.

```python
Drone:      id, operator_id, x, y, alt, speed, heading, battery, noise_db,
            payload_kg, package_id, mission_id, priority, status, route_id,
            route_progress_m, health, home_hub_id
            status ∈ IDLE|CHARGING|MAINTENANCE|ENROUTE|HOLDING|DIVERTING|LANDING|LANDED|LOST
Route:      id, waypoints[(x,y,alt)], corridor_ids[], total_length_m, created_by
Mission:    id, type(DELIVERY|RESCUE), priority(CRITICAL|HIGH|NORMAL|LOW),
            payload_kind, origin_hub_id, dest_id, drone_id, state, created_at, eta_s
Zone:       id, name, kind(SCHOOL|HOSPITAL|RESIDENTIAL_QUIET|NO_FLY|TEMP_RESTRICTED|EMERGENCY),
            polygon(Shapely), alt_min, alt_max, allowed_operators[], allowed_priorities[],
            active_hours(start,end), noise_limit_db, is_closed
Hub:        id, kind(COMMERCIAL|MEDICAL|EMERGENCY), x, y, engineer_id,
            landing_capacity, drone_ids[]
LandingZone: id, name, x, y, type(HOSPITAL|SKYPORT|OPEN_GROUND|INDUSTRIAL|BUILDING),
            capacity, occupied, permission(APPROVED|CONDITIONAL|DENIED), safety_score(0-1)
Incident:   id, kind, severity(INFO|WARNING|CRITICAL), drone_ids[], facts{},
            state(DETECTED|INVESTIGATING|AWAITING_APPROVAL|EXECUTED|REJECTED|RESOLVED),
            decision_id, created_at
Decision:   id, incident_id, summary, recommended_action(Action), alternatives[Action],
            reasoning[], risk_before, risk_after, battery_delta_pct, sla_delta_s,
            community_delta_pct, confidence, requires_human_approval, source(LIVE_AI|MOCK_AI)
Action:     kind(REROUTE|HOLD|ALTITUDE_CHANGE|DIVERT_LAND|ABORT|REPLACE_DRONE|
                 PAUSE_PRIORITY_BAND), drone_id, params{}
```

`Action` being a closed enum is what makes `apply_action()` safe and makes the LLM output executable rather than decorative.

---

## 4. Backend file tree (with line budgets — stay under)

```
backend/
  main.py            120   FastAPI app, routes, WS endpoint, lifespan starts tick loop
  state.py            80   AppState singleton, reset(), revision counter
  models.py          180   Pydantic models above
  geo.py              70   to_xy/to_ll, CPA, point-on-polyline, nearest-point-on-route
  city.py            220   THE FIXTURE. zones, corridors, hubs, hospitals, landing zones
  simulator.py       200   tick(dt): move drones, drain battery, advance missions
  safety_engine.py   240   all deterministic checks → Incident objects
  routing.py         140   corridor graph, A*/Dijkstra, find_alternative_routes, evaluate_route
  ai_supervisor.py   220   fact packet builder, Claude call, MOCK_AI, schema validation
  actions.py         160   apply_action() — the single mutation path
  emergency.py       140   activate/deactivate, rescue mission builder, landing selection
  policy_compiler.py 120   NL → policy JSON → apply
  community.py        90   noise ledger, complaint investigation
  scenarios.py       130   deterministic trigger buttons
  audit.py            60   append(), query(), event shapes
  bus.py              50   subscribe/publish, WS fan-out
```

~2,200 lines. That is a real evening. Do not add a `services/` layer, a repository pattern, or dependency injection.

---

## 5. Safety engine — exact algorithms

Write these first and test them with plain `pytest`-less asserts in `__main__`. They are the credibility of the whole product.

### 5.1 Collision — analytic closest point of approach

Do **not** step-simulate forward. Solve it:

```python
HORIZON_S   = 30.0
R_MIN_M     = 15.0     # prototype horizontal separation minimum
R_WARN_M    = 40.0
V_SEP_M     = 20.0     # vertical separation that clears a conflict
def predict_collision(a, b):
    dp = (b.x-a.x, b.y-a.y)
    dv = (b.vx-a.vx, b.vy-a.vy)
    dv2 = dv[0]**2 + dv[1]**2
    t = 0.0 if dv2 < 1e-6 else max(0.0, min(HORIZON_S, -(dp[0]*dv[0]+dp[1]*dv[1]) / dv2))
    sx, sy = dp[0]+dv[0]*t, dp[1]+dv[1]*t
    sep = math.hypot(sx, sy)
    v_sep = abs((a.alt + a.valt*t) - (b.alt + b.valt*t))
    if v_sep > V_SEP_M:
        return None                       # vertically separated, no conflict
    if sep >= R_WARN_M:
        return None
    severity = "CRITICAL" if (sep < R_MIN_M and t < 15) else "WARNING"
    risk = round(100 * (1 - sep/R_WARN_M) * (1 - t/HORIZON_S) ** 0.5)
    return Conflict(t_cpa=t, min_sep_m=sep, vertical_sep_m=v_sep,
                    severity=severity, risk_pct=max(1, min(99, risk)))
```

Broad-phase first: bucket drones into a 500 m grid, only test pairs in adjacent cells. With 12 drones you don't need it, but it costs 15 lines and lets you say "this scales to 10,000."

Emit at most one open incident per unordered drone pair — key it `f"COL:{min(a,b)}:{max(a,b)}"` and dedupe. Otherwise you generate 20 incidents/second and the UI dies.

### 5.2 Geofence — current and predicted

```python
check_geofence(drone)          → violations now (Shapely .contains in metre space)
predict_geofence_entry(drone)  → walk the remaining route polyline, first intersection
                                 with an active restricted polygon, return (zone, eta_s)
```

Zone activity respects `active_hours` against `sim_clock` — that's what makes the policy compiler demo land ("avoid schools 3–4 PM" turns zones on).

### 5.3 Battery reserve — the rule that justifies diversion

```python
DRAIN_CRUISE = 0.055        # %/s
DRAIN_CLIMB  = 0.25         # %/s while ascending
RESERVE_PCT  = 20.0
SAFETY_K     = 1.25
need = SAFETY_K * DRAIN_CRUISE * (dist_to_dest + dist_dest_to_nearest_landing) / speed
battery_ok = drone.battery - need > RESERVE_PCT
```

State the reserve rule in the AI's fact packet verbatim. When the supervisor says *"continuing leaves 11% against a 20% reserve minimum"*, it is quoting a real computed number — that is what separates this from a chatbot.

### 5.4 Altitude, noise, landing capacity

```python
altitude_check(drone, zone)      → BELOW_MIN | OK | ABOVE_MAX, delta_m
noise_check(drone, zone, hour)   → drone.noise_db vs zone.noise_limit_db, logs to noise ledger
landing_capacity_check(lz)       → lz.occupied < lz.capacity and permission == APPROVED
```

Noise ledger: every tick, for each drone inside a `RESIDENTIAL_QUIET` polygon, append `(t, drone_id, operator, zone, noise_db)`. The complaint investigation later just queries this list. Ten lines now, a whole demo feature later.

---

## 6. AI Supervisor — the contract

### Decision: pre-computed fact packet + one structured call. Not a tool-use loop.

A multi-turn tool loop is 4–8 round trips of latency and a live failure mode on stage. Your safety engine already knows every fact the model needs. Compute the packet deterministically, send **one** call, force JSON with a tool schema.

```python
facts = {
  "incident": {...},                       # kind, severity, risk_pct, t_cpa, min_sep_m
  "drones": [{id, priority, battery, mission, eta_s, altitude, operator}],
  "alternatives": [                         # computed by routing.py, 2–4 of them
     {"action": {...}, "risk_pct_after": 8, "sla_delta_s": +31,
      "battery_delta_pct": -1.3, "community_delta_pct": +14,
      "violates": [], "corridor_ids": [...]}
  ],
  "landing_options": [...],                 # only if diversion is plausible
  "active_policies": [...],
  "hard_rules": ["NO_FLY may never be entered",
                 "battery reserve floor is 20%",
                 "CRITICAL missions outrank NORMAL"]
}
```

The model's job: pick one alternative, explain the trade-off, set confidence. It may **not** invent an action outside `alternatives` — validate `recommended_action ∈ alternatives` server-side and fall back to the lowest-risk alternative if it does.

**Model:** `claude-sonnet-4-6`. `max_tokens: 1000`. Temperature 0. Force output shape with a `tool` definition rather than prompting for JSON — no fence-stripping regex.

**Timeout 8s.** On timeout, exception, rate limit, or schema failure → MOCK_AI. Silently. The demo never stalls.

### MOCK_AI is not a stub — build it first

Write `mock_supervisor(facts) -> Decision` before you write the Claude call. It picks the lowest `risk_pct_after` alternative, formats reasoning from templates, returns the identical schema. Consequences:

- You build and test the entire approval → mutation → map pipeline in hour 5 with zero API dependency.
- `USE_LIVE_AI=false` gives you a demo that runs on airplane wifi.
- You can A/B them on stage, which is a better answer to "is the AI real?" than any claim.

### Kill-AI toggle

`AI_ENABLED=false` → incident is created and displayed, and nothing else happens. Raw alert, no investigation panel, no recommendation, no approval control. That contrast is the argument for the product. Wire it as a header switch, not a config file.

---

## 7. `apply_action()` — the integrity guarantee

```python
def apply_action(action: Action, actor: str, incident_id: str | None) -> ActionResult:
    # 1. re-validate against CURRENT state (facts may be 4s stale)
    # 2. hard-rule gate: NO_FLY, battery floor, landing permission — reject and say why
    # 3. mutate: build/attach route, set status, update mission
    # 4. audit.append(actor, action, before, after)
    # 5. bus.publish("decision.executed", ...)
```

Reroute must be visually legible. When swapping routes:

1. Find the nearest point on the new polyline to the drone's current position.
2. Insert a joining leg from current position → that point.
3. Set `route_progress_m = 0` on the new route.

The drone then *visibly banks* onto the new corridor instead of teleporting. This is the money shot; spend the 20 lines.

**Frontend must never move a drone.** If a reviewer opens devtools and finds a client-side `setInterval` nudging positions, the entire narrative dies.

---

## 8. WebSocket protocol

```
server → client, on connect:
  {"t":"hello", "rev": 7, "city": {...zones, corridors, hubs, landing_zones...},
   "drones":[...full...], "missions":[...], "incidents":[...]}
server → client, every 500ms:
  {"t":"tick", "clock": 1288.5,
   "d":[["D01", 4210.2, -1885.4, 118, 87.3, 12.0, 62.1, 3], ...]}
        # id, x, y, alt, heading, speed, battery, status_code — array not object
server → client, immediately on change:
  {"t":"ev", "kind":"incident.created"|"incident.updated"|"decision.ready"
            |"decision.executed"|"mission.updated"|"zone.changed"|"policy.applied"
            |"emergency.changed"|"audit.append", "payload":{...}}
```

Compact arrays for telemetry, full objects for events. Bump `rev` when city geometry changes (zone closure) so the client re-fetches statics instead of you diffing polygons over the wire.

---

## 9. Frontend architecture

```
src/
  lib/ws.ts              connect, reconnect w/ backoff, dispatch to stores
  lib/telemetry.ts       ring buffer of last 2 ticks; NOT React state
  lib/render.ts          rAF loop, interpolation, drives Leaflet layer imperatively
  lib/geo.ts             mirrors backend to_ll (only needed if you send x/y — see below)
  store.ts               Zustand: incidents, decisions, missions, role, emergency, policies
  App.tsx
  map/MapCanvas.tsx      Leaflet init, tile layer, static overlays (zones/corridors)
  map/DroneLayer.ts      canvas-rendered drone glyphs + trails + route lines
  map/FollowCam.ts       "View from drone" mode
  panels/FlightStrips.tsx
  panels/Supervisor.tsx
  panels/Timeline.tsx
  panels/Scenarios.tsx
  panels/Emergency.tsx
  panels/DeliveryComposer.tsx
  panels/PolicyConsole.tsx
  chrome/StatusBar.tsx
  chrome/RolePicker.tsx
```

### The one performance decision that makes it feel premium

At 2 Hz telemetry, naive rendering gives you drones that jump 12 times per minute. Use **entity interpolation with a render delay**:

- Keep the last two ticks in a buffer.
- Render at `serverClock - 500ms` and lerp position/heading between the two.
- Run that in `requestAnimationFrame`, writing directly to a Leaflet canvas layer.

Drones glide at 60fps, headings ease, and you can drop a tick without anyone noticing. ~40 lines. It is the difference between "student project" and "operations console."

**Never put telemetry in React state.** `setState` at 2 Hz × 12 drones will re-render your panels and stutter the map. Telemetry lives in a module-scope object read by the rAF loop. React only re-renders on incidents, decisions, missions, and role changes — a few times a minute.

Leaflet with `preferCanvas: true`, or better, one custom `L.Canvas` layer you draw all 12 drones into yourself. Do not create 12 React components with `<Marker>`.

---

## 10. UI — design system

The default for this brief is a near-black dashboard with an acid-green accent and identical rounded cards. Skip it. Ground the design in the actual vernacular: **VFR sectional charts and ATC flight progress strips.**

### Palette — night sectional

| token | hex | use |
|---|---|---|
| `chart-ink` | `#0E1626` | app base — deep navy, not tinted black |
| `chart-panel` | `#152238` | floating rails, glass at 88% opacity |
| `chart-rule` | `#2B3D5C` | hairlines, grid, zone outlines |
| `chart-graticule` | `#7C8FB0` | secondary text, corridor lines, labels |
| `sectional-magenta` | `#E0398B` | restricted airspace, CRITICAL, no-fly hatching |
| `beacon-amber` | `#F5A524` | advisory, WARNING, awaiting approval |
| `vfr-blue` | `#5B9DD9` | nominal drones, active corridors, normal ops |
| `paper` | `#EAF0F8` | primary text |

Nominal state is **quiet blue**, not green. Alerts get the only saturated colour on screen, so a magenta pulse is impossible to miss. Green appears once, tiny, on "executed."

### Type

- **Barlow Semi Condensed** — UI, labels, headings. Condensed grotesques are the transport/aviation vernacular and they let flight strips carry twice the data per row.
- **IBM Plex Mono** — every number. `font-variant-numeric: tabular-nums` everywhere so altitudes and batteries don't jitter as they tick.

Two families, clearly distinct, neither is the default UI font. Sentence case in prose. Reserve uppercase for callsigns (`D-104`), zone codes, and status chips — that is real domain usage, not decoration.

### Layout — map is the app

```
┌───────────────────────────────────────────────────────────────────────┐
│ SKYGUARD   12 airborne · 8 missions · 2 incidents · EMERGENCY: OFF   ⚙│  56px, sits ON map
├──────────────┬──────────────────────────────────────┬─────────────────┤
│              │                                      │                 │
│ FLIGHT       │                                      │  SUPERVISOR     │
│ STRIPS       │        full-bleed map                │                 │
│              │        edge to edge, under           │  incident 004   │
│ ┌──────────┐ │        everything                    │  ─────────────  │
│ │D-01 ▸ ENR│ │                                      │  investigating… │
│ │118m 62%  │ │                                      │                 │
│ │MED→HOSP2 │ │                                      │  [ APPROVE  ]   │
│ └──────────┘ │                                      │  [ REJECT   ]   │
│  292px       │                                      │   340px         │
├──────────────┴──────────────────────────────────────┴─────────────────┤
│ ◂ 22:14:31 detected · 22:14:34 alternatives · 22:14:41 approved ▸    │  collapsible
└───────────────────────────────────────────────────────────────────────┘
```

The map is **not** a panel in a grid. It fills the viewport; the rails float over it as translucent glass with a 1px `chart-rule` edge and no border radius above 2px. Chrome floats on the world; the world is the truth.

**Flight strips, not cards.** Each drone is a horizontal strip with a 3px left status bar, callsign in condensed caps, telemetry in mono, mission on line two. Strips reorder by priority: CRITICAL rises to the top and the list animates once. No shadows, no rounded corners, hairline separators — a physical strip board.

### Motion — spend it once

One orchestrated moment, on approval:

1. Old route fades to a 30%-opacity dashed ghost (200ms).
2. New route draws from the drone outward via `stroke-dashoffset` (600ms, ease-out).
3. Map eases to fit both drone and new destination (400ms).
4. Timeline stamps a new event with a single amber → green tick.

That is the whole motion budget. No hover lifts, no card entrance animations, no gradient washes. Respect `prefers-reduced-motion` by jumping straight to the end state.

### Copy

Buttons say what happens: **Approve reroute**, **Activate flood response**, **Close Zone B**. The same word carries through: approve → "Approved 22:14:41" in the timeline. Empty supervisor panel says "No open incidents. Airspace nominal." not "Nothing to show."

---

## 11. View from drone

Do **not** attempt Cesium tonight. It is a 3–4 hour tarpit for a visual you can fake convincingly in 30 minutes.

Leaflet follow-cam:

1. Zoom to 18, `map.setView` each rAF frame to the interpolated drone position with no animation.
2. Rotate the map container: `transform: rotate(-headingDeg)` on the tile pane, counter-rotate labels.
3. Apply `perspective(800px) rotateX(55deg)` to the map container for a tilted forward-looking view.
4. Overlay an HUD: altitude ladder left, battery/speed right, heading tape top, crosshair centre, route line ahead in `vfr-blue`, restricted polygons rendered in `sectional-magenta` hatching.

The HUD is what sells it, not the terrain. Budget 45 minutes, hard stop, revert to a centred follow if it fights you.

---

## 12. City fixture — engineer the demo into the geometry

`city.py` is not scenery, it is your script. Build it so scenarios are inevitable, not lucky.

- **8 corridors**, of which **C3 × C7 cross at a known point** near a hospital, and **C2 × C5 cross** inside a residential quiet zone. Place hubs and destinations so the default assignment sends drones down C3 and C7 with overlapping ETAs — the collision demo then fires without you nudging it.
- **5 zones**: `NO_FLY` over the airport approach (large, unmissable, magenta hatch), `SCHOOL` (inactive until the policy demo turns it on at 15:00), `HOSPITAL` (low altitude ceiling), `RESIDENTIAL_QUIET` (noise limit 55 dB, feeds the complaint demo), `TEMP_RESTRICTED` (the one Government closes on stage).
- **3 hubs**: Commercial dark store (west), Medical hub (centre, next to Hospital 2), Emergency hub (north, dormant until flood mode).
- **6 landing zones** with deliberately *interesting* scores so the selection algorithm has a real choice: the nearest one is `CONDITIONAL` permission, the second-nearest is at capacity, the third is the right answer. That is how you demonstrate reasoning instead of a `min()`.
- **Flood polygon** for Zone B pre-authored, covering 2 hospitals and cutting one corridor.

Write the fixture as plain lat/lng literals converted at load. No procedural generation.

---

## 13. Emergency mode and landing selection

`activate_emergency(kind, zone_id)` does exactly seven things, in order, each publishing an event so the UI narrates itself:

1. Mark zone `EMERGENCY`, open emergency corridors.
2. Pause `LOW` + `NORMAL` missions → status `HOLDING`, return-to-hub for those below 40% battery.
3. Re-rank the mission queue by priority.
4. Mark emergency-hub drones available.
5. Recompute affected routes through `apply_action`.
6. Surface landing zones inside/near the polygon with live capacity.
7. Emit a summary: `24 flights affected — 17 rerouted, 4 returning, 2 emergency landing, 1 paused`.

That summary line is the government demo. Make it a real count from real state.

**Landing selection** — hard filters, then a weighted score, both shown in the UI:

```
filter:  permission == APPROVED
         occupied < capacity
         reachable within battery reserve
         not inside NO_FLY or the disaster polygon
         type compatible with drone class
score = 0.45·proximity + 0.25·safety_score + 0.20·capacity_headroom + 0.10·permission_weight
        proximity = 1 − clamp(dist / max_reachable_dist, 0, 1)
```

Render the rejected candidates greyed with the reason (`at capacity`, `conditional permission`). Showing the discarded options is more persuasive than showing the winner.

---

## 14. Policy compiler

Government types free text → Claude returns:

```json
{"name":"School quiet hours","constraints":[
  {"type":"zone_avoid","zone_kind":"SCHOOL","time_start":"15:00","time_end":"16:00"},
  {"type":"priority_boost","payload_kind":"MEDICAL","delta":1}]}
```

Backend activates matching zones, re-evaluates every active route, calls `apply_action` for each violator, returns `{routes_recalculated, drones_rerouted, crossings_eliminated, added_delay_s}`. Set `sim_clock` to 14:58 before the demo so activation is 2 minutes away and the audience watches zones light up.

Constraint types are a closed enum — same discipline as `Action`. The model classifies; it does not author behaviour.

---

## 15. Hour-by-hour

| Hour | Deliverable | Gate |
|---|---|---|
| 0.0–0.5 | Both apps scaffolded, WS handshake, tick loop printing | — |
| 0.5–2.0 | `city.py` + simulator + Leaflet + interpolated rendering | **12 drones gliding on the map** |
| 2.0–3.0 | Delivery composer, drone assignment, corridor routing | Create delivery → drone departs |
| 3.0–4.5 | Safety engine, incident dedupe, scenario buttons | Trigger collision → incident appears |
| 4.5–6.0 | MOCK_AI, decision panel, approve → `apply_action` → reroute | **Route visibly changes. Core loop closed.** |
| 6.0–6.5 | Live Claude behind the same interface, timeout fallback | Toggle live/mock, identical UI |
| 6.5–7.5 | Emergency mode, flood, rescue mission composer | Affected-flights summary is real |
| 7.5–8.5 | Failure → landing selection → engineer alert → replacement | Full demo 3 end-to-end |
| 8.5–9.5 | Roles, kill-AI toggle, reset, audit timeline | Reset returns to identical state |
| 9.5–11.0 | UI pass: type, palette, flight strips, approval motion, drone view | — |
| 11.0–12.0 | **Three full rehearsals + screen recording** | Video backup exists |

**Hard gates.** Not gliding by 2.0 → drop drone view and 3D permanently. Loop not closed by 6.0 → drop policy compiler and community. Never miss the 11.0 rehearsal slot; a demo you have never run end-to-end will fail in front of judges.

---

## 16. Team split (4 people)

- **A — Sim & safety:** `geo`, `city`, `simulator`, `safety_engine`, `routing`. Owns determinism.
- **B — Decisions & AI:** `ai_supervisor`, `actions`, `emergency`, `policy_compiler`, `audit`. Owns `apply_action` integrity.
- **C — Map & render:** `ws`, `telemetry`, `render`, `MapCanvas`, `DroneLayer`, `FollowCam`. Owns 60fps.
- **D — Panels, UI system & demo:** all panels, design tokens, and — critically — **owns the demo script and runs the rehearsals**. D has veto power on new features after hour 9.

Freeze the WS message shapes and the REST contract in hour 0.5 in a shared `contracts.md`, then A/B and C/D never block each other.

---

## 17. Demo runbook + insurance

Three demos, six minutes total. Nothing else.

1. **Medicine delivery** (90s) — create, deploy, view from drone, arrive.
2. **Autonomous safety** (150s) — kill-AI on first (raw alert, silence), then AI on, investigate, alternatives, approve, route bends, timeline.
3. **Flood response** (180s) — activate, 24-flights summary, rescue mission, D-09 comms loss, landing candidates with rejected options, approve divert, engineer alerted, replacement dispatched, mission completes.

Insurance, all cheap:

- `MOCK_AI` default-on for the live run. Show live AI once, early, when the network is calm.
- `RESET DEMO` bound to a visible button **and** a keyboard shortcut.
- Screen recording of a clean run made at hour 11, on the presenting laptop, playable offline.
- Backend + frontend both bound to `0.0.0.0`, run from a terminal you can see, so a crash is a restart not a mystery.
- One person's only job during the demo is watching the console.

---

## 18. Cut list, in order

When behind, cut from the bottom up: visual polish → community/noise → policy compiler → drone view → replacement dispatch → emergency landing → emergency mode. Everything above emergency mode is the loop and does not get cut.

---

## Setup

```bash
# backend
cd backend && python -m venv .venv && source .venv/bin/activate
pip install fastapi uvicorn[standard] pydantic shapely anthropic
ANTHROPIC_API_KEY=... USE_LIVE_AI=false uvicorn main:app --reload --port 8000
# frontend
cd frontend && npm create vite@latest . -- --template react-ts
npm i leaflet react-leaflet zustand && npm i -D tailwindcss @types/leaflet
npm run dev    # 5173, proxy /api and /ws to 8000 via vite.config.ts
```
