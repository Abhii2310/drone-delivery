# SKYGUARD — Wire contracts

Frozen shapes for the WebSocket and REST surface. Updated every step. Last updated: Step 16 (collision hero pass).

All coordinates on the wire are `[lat, lng]` for city geometry and `lng, lat` fields for drones.
Metres never cross the wire. Altitudes are metres above ground.

## WebSocket `GET /ws`

Server → client only. Inbound frames are read and ignored.

### `hello` — sent once on connect, and rebroadcast after `POST /api/reset`

```json
{"t":"hello","rev":1,"clock":0.0,
 "city":{ ...same body as GET /api/city... },
 "drones":[{ ...Drone fields minus x,y..., "lng":77.6,"lat":12.97 }],
 "routes":[{"id":"R-D-01","corridor_ids":["C4"],"total_length_m":2855.9,
            "created_by":"fixture","path":[[lat,lng,alt_m], ...]}],
 "missions":[], "incidents":[]}
```

`Drone` carries `previous_route_id` (null until a reroute sets it). Route `path` uses
`[lat, lng, alt]` like all other city geometry.

### `tick` — every 500 ms (every 5th 100 ms sim tick)

```json
{"t":"tick","clock":12.5,
 "d":[["D-01", 77.599, 12.9668, 110.0, 132.4, 15.7, 88.61, 3], ...],
 "m":[["M-001","ENROUTE",41.2], ...]}
```

`m` carries one row per active mission as `[mission_id, state, eta_s]`, so the ETA counts
down at 2 Hz without any mission data entering React state.

Row layout: `[id, lng, lat, alt_m, heading_deg, speed_mps, battery_pct, status_code]`

| code | status |
|---|---|
| 0 | IDLE |
| 1 | CHARGING |
| 2 | MAINTENANCE |
| 3 | ENROUTE |
| 4 | HOLDING |
| 5 | DIVERTING |
| 6 | LANDING |
| 7 | LANDED |
| 8 | LOST |

### `ev` — immediately on change

```json
{"t":"ev","kind":"<kind>","payload":{...}}
```

Kinds planned (BUILD-PLAN §8): `incident.created`, `incident.updated`, `decision.ready`,
`decision.executed`, `mission.updated`, `zone.changed`, `policy.applied`, `emergency.changed`,
`audit.append`. None are emitted yet as of Step 2.

## REST

| Method | Path | Body | Returns | Since |
|---|---|---|---|---|
| GET | `/health` | — | `{"ok":true}` | 0 |
| GET | `/api/city` | — | city fixture, see below | 1 |
| POST | `/api/reset` | — | the fresh `hello` message; also rebroadcast on `/ws` | 2 |
| POST | `/api/missions` | `{type, payload_kind, priority, origin_hub_id, dest_id}` | the created `Mission`, or 400 with a reason | 7 |
| POST | `/api/scenario/{name}` | — | `{name, detail}`, or 400 for an unknown or impossible scenario | 8 |
| POST | `/api/decisions/{id}/approve` | `{actor, alternative_index?}` | `{ok, detail}`, 400 with the hard-rule reason, 404, or 409 if no longer awaiting | 9 |
| POST | `/api/decisions/{id}/reject` | `{actor}` | `{ok, detail}` | 9 |
| GET | `/api/audit` | `?limit` | `{events: [...]}` | 9 |
| GET | `/api/state` | `?role&operator_id&hub_id&mission_id` | the role-filtered `hello` body | 14 |
| GET | `/api/weather` | — | the current reading | 14 |
| POST | `/api/ai` | `{enabled}` | `{ai_enabled}`; also broadcasts `ai.changed` | 10 |
| POST | `/api/emergency/activate` | `{kind, zone_id}` | the emergency record with its summary, or 400 | 11 |
| POST | `/api/emergency/deactivate` | — | `{ok}`, or 400 when none is active | 11 |
| POST | `/api/missions/rescue` | `{zone_id, payloads[]}` | `{zone_id, dest_id, assignments}` | 11 |
| POST | `/api/missions/{id}/dispatch-replacement` | — | `{mission_id, replacement, replaced, drone, route}` | 12 |

### `GET /api/city`

```json
{"origin":[12.9716,77.5946],
 "bbox_m":{"width":3685,"height":3227},
 "zones":[{"id","name","kind","polygon":[[lat,lng],...],"alt_min","alt_max",
           "allowed_operators","allowed_priorities","active_hours","noise_limit_db","is_closed"}],
 "corridors":[{"id","name","polyline":[[lat,lng],...],"alt_min","alt_max","length_m"}],
 "hubs":[{"id","kind","engineer_id","landing_capacity","drone_ids","ll":[lat,lng]}],
 "destinations":[{"id","name","kind","ll":[lat,lng]}],
 "landing_zones":[{"id","name","type","capacity","occupied","permission","safety_score","ll":[lat,lng]}],
 "emergency_polygons":{"ZONE-B":[[lat,lng],...]},
 "conflict_points":{"C3xC7":[lat,lng]}}
```

## Simulation constants (Step 2)

Tick 10 Hz with fixed `dt = 0.1 s`; `sim_clock` is the sum of ticks, never wall time.
Battery `%/s = 0.040 + 0.0085 × payload_kg`, plus `0.25` while climbing.
Flat costs: takeoff `1.8 %`, landing `1.2 %`. Altitude ramps toward `target_alt` at `3 m/s`.

## Frontend client (Step 3)

`frontend/src/lib/ws.ts` mirrors the frames above and is the only WebSocket consumer.
It exposes `connect()`, `disconnect()`, and the subscriptions `onHello`, `onTick`, `onEvent`,
each returning an unsubscribe function. Reconnect uses exponential backoff from 500 ms to 8 s.
It is not wired to any component yet.

Map constants live in `frontend/src/map/MapCanvas.tsx`: basemap style
`https://tiles.openfreemap.org/styles/liberty`, and the `CITY` camera preset
(centre `77.59605, 12.97505` — the fixture centroid — zoom 13.8, pitch 52, bearing 0).

## Render pipeline (Step 4)

`frontend/src/lib/telemetry.ts` holds the last two tick frames at module scope. It is never
React state and never calls `setState`. `getInterpolated(nowMs)` renders at
`serverClock - 500 ms`, lerping position and altitude between the two frames and easing
heading with shortest-angle wrapping (`delta = ((target - current + 540) % 360) - 180`).
Ticks whose `clock` is not newer than the current frame are dropped as duplicates.

`frontend/src/lib/render.ts` runs the single `requestAnimationFrame` loop and pushes deck.gl
layers imperatively via `MapboxOverlay.setProps({ layers })`. Layer ids, bottom to top:
`drone-shadow`, `drone-tether`, `drone-glyph`, `drone-label`. `window.__sky` exposes
`getFps()`, `views()` and `debug()` for verification.

Simulator note: a seeded fixture drone with no `mission_id` loops its round-trip route so the
city is never static. A drone carrying a mission still stops on arrival.

## Airspace layers (Step 5)

`frontend/src/lib/city.ts` holds city statics at module scope and is the single place the
wire's `[lat, lng]` order is swapped to deck.gl's `[lng, lat]`. It exposes `visibleZones()`,
`getActiveRoutes()`, `getGhostRoutes()` and `setZoneVisible(kindOrId, visible)`; SCHOOL starts
hidden so a policy can raise it on stage. `window.__city` exposes the same handles.

`frontend/src/lib/airspace.ts` builds the static layers, memoised on the city revision.
Full layer order, bottom to top: `zone-volume`, `zone-edge`, `corridor-tube`, `route-active`,
`route-ghost`, `landing-pad`, `site-glyph`, `site-label`, then the Step 4 drone layers
`drone-shadow`, `drone-tether`, `drone-glyph`, `drone-label`.

Zone volumes extrude from a per-vertex base: each ring vertex carries `z = alt_min` and
`getElevation` returns `alt_max - alt_min`. This was tested with a floating prism and renders
correctly, so the ground-plus-floor-plane fallback was not needed.

## Chrome and stores (Step 6)

`frontend/src/store.ts` is the Zustand store for low-frequency state only: `incidents`,
`decisions`, `missions`, `events`, `selectedDroneId`, `role`, `emergency`, `cameraMode`,
`weather`, `aiEnabled`. Telemetry never enters it.

`frontend/src/lib/fleet.ts` publishes one shared 4 Hz slice of the telemetry buffer through
`useSyncExternalStore`. The 60 fps rAF render loop is untouched by it, and only the panels
that subscribe re-render. `ingestFleetMeta(hello)` caches per-drone static fields
(operator, priority, mission, package, home hub, payload) and exposes them as
`window.__fleetMeta`.

Chrome components, all floating over a map that never resizes:
`chrome/StatusBar.tsx` (56 px), `panels/FleetRail.tsx` (292 px flight strips),
`panels/SupervisorRail.tsx` (360 px), `panels/Timeline.tsx` (108 px, collapses to 32 px).

Glass and interaction values from UI-SPEC 2.4 live as tokens in `index.css`
(`--glass-rail-bg`, `--glass-border`, `--glass-hilite`, `--glass-shadow`, `--hover-lift`,
`--select-tint`, `--glow-nominal`, `--glow-critical`) so no component hardcodes a colour.

Simulator note: a drone seeded with no route now reports `speed = 0.0`, so an IDLE strip does
not show a cruise speed it is not flying at.

## Missions (Step 7)

`backend/routing.py` builds a graph from corridor vertices, snapping hubs and destinations to
the nearest vertex within 500 m. `plan_route` is Dijkstra over that graph and rejects an edge
that enters an active NO_FLY, TEMP_RESTRICTED, SCHOOL or EMERGENCY volume at the edge's
altitude, that breaches a HOSPITAL ceiling, or that falls outside the drone's altitude band.
`find_alternative_routes` re-plans while banning each winning corridor in turn.
`evaluate_route` returns `length_m`, `eta_s`, `battery_cost_pct`, `zones_crossed`,
`quiet_zone_seconds` and `min_sep_to_other_drones`, all deterministic, for Step 9's fact packet.

`backend/missions.py` assigns a drone (available, unassigned, within payload capacity, above
reserve plus margin; ranked by distance to the origin hub, then battery, then id), plans the
route, and drives the lifecycle in the tick:
`ENROUTE -> ARRIVING` within 100 m of the destination, `-> DELIVERED` on route completion,
`-> RETURNING` on a freshly planned route home, `-> COMPLETE` at the hub with the drone IDLE.
Each transition publishes `mission.created` or `mission.updated` carrying
`{mission, drone, route, clock}`.

Mission state constants: payload weights Medicine 2.4 kg, Medical sample 0.4 kg, Food 1.5 kg,
Package 1.2 kg; capacity 3.0 kg; reserve floor 20%; cruise 15.0 m/s; arrival radius 100 m.

## Safety engine (Step 8)

`backend/safety_engine.py` runs every 5th tick (2 Hz), offset one tick from the broadcast.
`predict_collision` is analytic closest point of approach: `t_cpa` is clamped to a 30 s
horizon, a vertical separation above 20 m clears the conflict, CRITICAL needs `min_sep < 15 m`
and `t_cpa < 15 s`, and `risk_pct = 100·(1 − min_sep/40)·(1 − t_cpa/30)^0.5`. Broad phase
buckets drones into a 500 m grid and tests adjacent cells only.

Other checks: `check_geofence`, `predict_geofence_entry` (walks the remaining route polyline
in 25 m steps), `battery_ok` (20% floor, 1.25 safety factor, includes the leg to the nearest
approved landing zone plus the landing cost), `altitude_check`, `noise_check` (appends to
`state.noise_ledger` and raises no incident) and `landing_capacity_check`.

**Incident dedupe.** Each condition has a stable key, collisions using
`COL:{min(a,b)}:{max(a,b)}`. One open incident per key, updated in place while the condition
holds, auto-resolved after 3 consecutive clear checks. Incident ids are unique per occurrence
(`INC-001`, `INC-002`, …) and the dedupe key lives in `facts.key`, so re-triggering after a
resolve produces a genuinely new incident rather than reviving the old one.

Incident events carry `{incident, conflict_ll, clock}`; `conflict_ll` is `[lat, lng]` for the
predicted conflict point, with `facts.conflict_point` staying in metres.

`backend/scenarios.py` exposes nine deterministic scenarios. `TRIGGER_COLLISION` stages two
available drones onto C3 and C7 with 200 m and 212 m leads to the crossing, so the conflict is
computed from real geometry; the 12 m offset makes the miss distance a real 6.4 m rather than
zero. It reuses the same pair on repeat triggers, so it is idempotent.

Simulator notes: C3 and C7 carry no seeded traffic, since they are reserved for the engineered
conflict. Only routes with `created_by == "fixture"` loop; scenario and mission routes end.

## Core loop (Step 9)

`backend/ai_supervisor.py` builds a deterministic fact packet from the safety engine only:
incident facts, drone states, 2-4 pre-evaluated alternatives from `find_alternative_routes`
plus `evaluate_route`, landing options when battery is low, active policies, and the three
hard rules as literal strings. `risk_pct_after` re-runs the analytic CPA with the yielding
drone turned onto the alternative's first leg, so it is a real number, not a heuristic.
`mock_supervisor` picks the lowest `risk_pct_after` with no violations, breaking ties on SLA,
and derives confidence from the margin between the best two. A 900 ms delay makes the
investigating state visible. `dispatch` uses `asyncio.create_task`; the tick loop never awaits.

Incident states: `DETECTED -> INVESTIGATING -> AWAITING_APPROVAL -> EXECUTED | REJECTED`.
Auto-resolve applies only to `DETECTED` and `INVESTIGATING`; once a recommendation is on the
table the human owns it, and `apply_action` re-validates against current state.

`backend/actions.py::apply_action` is the only function permitted to change `drone.route_id`,
`drone.status`, `drone.target_alt` or `mission.state`. It re-validates, enforces the hard
rules with a readable reason, mutates, appends an audit event and publishes
`decision.executed`. On REROUTE it rebuilds the route to start at the drone's current
position and join the corridor at the nearest point, so the drone banks rather than teleports,
and sets `previous_route_id` to feed the ghost route layer.

Event kinds added: `drone.updated`, `decision.alternatives`, `decision.ready`,
`decision.approved`, `decision.executed`, `decision.rejected`, `audit.append`.

Routing fix: a waypoint carries the altitude of the leg leaving it. It previously carried the
arriving leg's altitude, which made the hard-rule gate read the wrong altitude per segment.
`_attach` links an off-graph point to several nearby nodes, otherwise a drone mid-corridor is
stranded when that corridor is excluded and no alternative can be found.

## Live supervisor and altitude change (Step 10)

`live_supervisor(facts)` makes one call to the model named by `SKYGUARD_MODEL`
(default `claude-sonnet-4-6`), `max_tokens` 1000, with `client.messages.create` on
`AsyncAnthropic(max_retries=0, timeout=8)` wrapped in `asyncio.wait_for(..., 8)`. Output shape
is forced with a `strict` tool definition (`submit_decision`) plus
`tool_choice={"type":"tool","name":"submit_decision"}` — there is no JSON prompting, fence
stripping or regex parsing. The tool takes `chosen_alternative_index`, so the model can only
pick from the supplied alternatives; the index is re-validated server-side and an out-of-range
or rule-violating pick falls back to the lowest-risk legal alternative with a log line.

`decide(facts)` chooses live or mock from `USE_LIVE_AI`, and any failure at all — timeout,
connection error, DNS, auth, schema — falls back to `mock_supervisor` silently, logged at
warning level. `source` is `LIVE_AI` or `MOCK_AI` and renders as a chip in the rail.

`temperature` is not sent: it was removed from the Messages API in the installed SDK
generation (anthropic 1.4.0) and raises a TypeError. Determinism comes from the closed tool
schema and server-side validation instead.

`ALTITUDE_CHANGE` is generated whenever a 25-40 m offset clears the conflict while staying
inside the operating envelope tightened by every zone containing the drone. `apply_action`
sets `target_alt` only; the simulator ramps at 3 m/s so a 25 m change takes about 8 s and is
visible in 3D. Alternatives are ordered altitude, two reroutes, hold, capped at four.

`state.ai_enabled` gates `dispatch`. With it false an incident is still created, the band still
appears and the camera still flies, but no investigation runs and the rail reads
"AI Supervisor disabled. Raw safety alert only." with no approval control. Reset restores it
to true.

## Emergency operations (Step 11)

`backend/emergency.py::activate` runs BUILD-PLAN 13's seven steps in order, publishing an
`emergency.step` event at each so the UI can narrate itself: mark the zone EMERGENCY and open
the emergency corridors (C3, C7); pause LOW and NORMAL missions to HOLDING, sending those
under 40% battery home instead; re-rank the mission queue by priority; release the emergency
hub; recompute every affected route; surface landing zones inside and near the polygon with
live capacity; emit the summary. Every mutation goes through `apply_action` — nothing is
mutated directly. The summary `{affected, rerouted, returning, emergency_landing, paused,
available_for_rescue}` is counted from state and carries the drone ids behind each number.

Only FLOOD is implemented; FIRE, EARTHQUAKE and LANDSLIDE are enum values and return 400.

The emergency zone is created with `allowed_priorities: ["CRITICAL"]`. Routing, the hard-rule
gate in `apply_action`, and both geofence checks all honour that field, so rescue traffic may
enter the flood zone while everything else is kept out. Rescue departures from one hub are
spaced 90 m apart along the route so a group dispatch does not stack drones on top of each
other.

Frontend: the chrome transformation is one `body.emergency` class plus a token swap in
`index.css` (`--ink` #1A1420, `--panel` #241A26, `--nominal` #7C8FB0) and a `::after` frame;
no component is recoloured individually. The activation sequence is driven by
`store.emergencyPhase`, stepped through 200, 400, 600, 800, 1000 and 1200 ms to match
UI-SPEC 2.10. Deactivation reverses in 600 ms.

## Emergency landing (Step 12)

`emergency.select_landing_zone(drone)` applies the hard filters in order, recording a reason
for every rejection: `permission denied`, `conditional permission`, `at capacity`,
`beyond battery range, N m against M m reachable`, `inside restricted airspace, <zone>`,
`incompatible pad type`. Reachable range is
`(battery - 20) x speed / (1.25 x 0.055)`. Survivors are then scored
`0.45*proximity + 0.25*safety_score + 0.20*capacity_headroom + 0.10*permission_weight`, with
`proximity = 1 - clamp(dist / max_reachable, 0, 1)`. It returns both `ranked` and `rejected`.

MOTOR_FAILURE and COMMS_LOSS degrade health and set the drone DIVERTING, preferring a drone
that is carrying a mission so a replacement has something to take over. The safety engine
raises HEALTH_DEGRADED, the supervisor investigates with the full landing selection in
`landing_options`, and recommends `DIVERT_LAND` requiring approval.

`apply_action` DIVERT_LAND re-checks permission and capacity, plans the landing route, sets
`target_alt` to 30 m and status LANDING, and publishes `engineer.alerted` with the hub's
engineer id. The simulator flies the approach, descends inside the last 200 m, sets LANDED,
increments the pad's `occupied` and publishes `drone.landed`.

`dispatch_replacement(mission_id)` picks the next best available drone by distance to the
destination, then battery, then id, moves the mission onto it and publishes
`replacement.dispatched`.

Frontend: the supervisor rail lists ranked candidates with score, distance, safety and
headroom, and below them the rejected candidates greyed with their reason. The chosen pad
pulses on the map as a `landing-pulse` layer. A "Dispatch replacement" action appears once the
divert executes. The engineer alert is its own timeline row carrying the engineer's name.

Routing: the corridor snap radius is 900 m so landing pads and hubs attach, and an unreachable
point now returns None from `plan_route` instead of raising.

## Drone view (Step 13)

`frontend/src/map/FollowCam.ts` is driven from the same rAF loop as telemetry interpolation
and uses `map.jumpTo`, never `easeTo`, so easing is not layered on interpolation. Damping is
frame-rate independent (`alpha = 1 - exp(-k*dt)`, k=3.5 position, k=2.2 bearing) and bearing
uses shortest-angle wrapping `((target - current + 540) % 360) - 180`. Preset is zoom 17.2,
pitch 72. Entry is a single `flyTo` of 1200 ms; the damping never handles the transition.
Under `prefers-reduced-motion` the pitch drops to 40 and bearing follow is disabled.

One deviation, deliberate: the addendum describes the camera target as a point 160 m BEHIND
the drone. MapLibre's `center` is the point the camera looks AT, not where it sits, so a
centre behind the drone renders the drone ABOVE mid-screen and fills the frame with where it
has been. The look-at point is therefore 160 m AHEAD along the heading, which puts the drone
at 64% of frame height, in the lower third, with the route ahead filling the view. That is the
effect the addendum asks for.

`frontend/src/lib/profile.ts` samples a route into a cross-section and works out which zones
it passes through, returning `points` and `bands` (zone id, kind, ceiling, floor, from/to
distance). `ceilingAt` and `nextCeiling` drive the HUD advisory, and `progressAlong` places the
marker. `panels/AltitudeProfile.tsx` renders it as inline SVG with each zone's restricted air
shaded above its ceiling line.

`panels/DroneDrawer.tsx` is 380 px of L2 glass sliding over the supervisor rail; the map never
resizes. `chrome/DroneHud.tsx` is HTML and CSS only, with a heading tape, an altitude ladder
carrying the current zone ceiling as a magenta line on the same scale, a battery ladder, a
crosshair and the bottom strip plus advisory.

Keyboard: `1` city, `2` incident, `3` drone view for the selected drone, `Esc` exits drone
view or closes the drawer.

## Roles and weather (Step 14)

Filtering is server-side. Every REST call and the WebSocket handshake accept
`role`, `operator_id`, `hub_id` and `mission_id`; `roles.py` resolves them to a `Viewer` and
computes the visible drones, missions, incidents and hubs. `GET /api/state` returns exactly
what a given viewer may see, so role filtering is inspectable in the network tab.

| Role | Drones | Hubs | Capabilities |
|---|---|---|---|
| GOVERNMENT | all 12 | all 3 | approve, emergency, fleet, incidents, scenarios, zones |
| OPERATOR | its own operator's | all 3 | approve, fleet, incidents |
| HUB_ENGINEER | its own hub's | 1 | fleet, incidents (health and battery only) |
| CUSTOMER | the one on its delivery | 1 | none |

`bus.broadcast_per(build)` renders one message per connection from that connection's viewer,
so telemetry ticks are filtered too, not just the handshake. Capability gates return 403:
emergency and scenarios need GOVERNMENT, approval needs `approve`.

`weather.py` polls Open-Meteo every 10 minutes with a 3 s timeout and a hardcoded fallback of
8.0 m/s from 240°; after a fallback it retries in 30 s rather than waiting the full interval.
The reading feeds the physics, not just a widget:
`headwind = wind_speed x cos(heading - wind_direction)`, ground speed is airspeed minus
headwind, and battery drain is multiplied by `1 + 0.04 x max(0, headwind)`. The safety engine
raises a WEATHER_ADVISORY when gusts exceed 12 m/s or visibility drops below 2000 m, and the
AI fact packet carries a weather block so the reasoning can cite the headwind and its battery
penalty. BAD_WEATHER overrides the reading and marks it so polling does not undo it.

Reset note: `POST /api/reset` must not await anything. It briefly awaited a weather fetch,
during which the tick loop kept running and reset stopped being byte-identical. The observed
weather now carries across a reset, since the sky is not part of the simulation's state.

## Visual audit (Step 15)

Token audit found no hex, rgb or rgba literals outside `index.css`, and no hardcoded radii.
It did find three hardcoded durations (FLIP 320 ms, camera 1200 ms, incident camera 1400 ms)
and two hardcoded geometries (drawer 380 px, strip 64 px); all now read tokens
(`--t-standard-ms`, `--t-camera-ms`, `--t-cine-ms`, `--drawer-w`, `--strip-h`, `--band-h`,
`--emergency-band-h`, `--t-scan`). The three remaining `#fff` are inside SVG icon masks, where
deck.gl replaces the colour via `mask: true`.

Glass has exactly three levels: `.glass-rail` (L1), `.glass-drawer` (L2, 0.94 / blur 28) and
`.band-solid` (L3, no blur). The drone drawer previously applied L1 and L2 together; it is now
L2 only. A live check confirms four blurred elements, none nested inside another.

Glow is limited to three: `.glow-critical` on a critical alert band, the emergency `::after`
frame, and `.glow-selected` on the selected strip. Green (`--executed`) no longer appears as a
normal state: the landing pulse and the top-ranked landing candidate are now `--nominal`, and
the reset control no longer turns green on success.

Motion goes through `lib/cinematic.ts`, a queue that runs one cinematic at a time, so an
incident firing during an emergency activation waits rather than fighting. Under
`prefers-reduced-motion` queued durations collapse to 200 ms and the camera helper uses 200 ms.

Keyboard is centralised in `lib/keyboard.ts`: `1/2/3` camera, arrows move through strips,
`Enter` opens the drawer, `F` follows, `A` approves, `X` rejects, `E` toggles emergency with
confirmation, `Space` pauses via `POST /api/pause`, `R` resets with confirmation, `Esc` closes,
`Cmd/Ctrl-K` toggles the palette flag.

Responsive: rails narrow at 1600, 1280 and 1024, and below 768 they are hidden, approval
controls carry `.workstation-only`, and a band reads "Approvals require a workstation."

## Predictive collision control (hero pass)

The conflict lifecycle is now proven end to end, not assumed:

`DETECTED -> INVESTIGATING -> AWAITING_APPROVAL -> EXECUTING -> RESOLVED`

`apply_action` no longer resolves a collision incident. It sets `EXECUTING`, records the
separation at detection and publishes `maneuver.started`. `safety_engine.verify_resolutions`
runs on every 2 Hz check and only resolves the incident when the geometry proves it:

- `cpa_separation(a, b, alt_a, alt_b)` computes the closest point of approach with no
  thresholds applied, optionally at commanded altitudes — what the maneuver will actually
  deliver rather than a mid-climb snapshot.
- Verification waits for both drones to settle within 2 m of their commanded altitude.
- It resolves only when the projected 3D separation clears the 15 m minimum, then publishes
  `separation.verified` and `incident.resolved` with before, after, required, horizontal and
  vertical components plus both altitudes.

Deterministic across three consecutive runs: predicted 6.7 m against a 15 m minimum with
13.2 s to CPA, resolved by descending one drone 25 m, verified at 27.4 m with a 25 m vertical
gap. The other drone holds its corridor and altitude, and the remaining eight keep flying.

Mission isolation was audited and is correct: assigning a mission changes exactly one drone's
mission, route and position.

Palette moved from navy to neutral graphite (`--ink #0B0D10`, `--panel #14171C`), with
restrained cyan-blue nominal, amber advisory, red critical. Emergency controls are discreet in
normal operations and escalate to "CRITICAL INCIDENT · DISASTER RESPONSE AVAILABLE" only when
a critical incident is open.

## Photorealistic 3D city (optional)

Cesium ion was evaluated against the requirement for a more realistic view. CesiumJS itself is
not used: swapping engines would mean rewriting the deck.gl layer stack, the chase camera, the
extruded airspace volumes and the HUD. Instead the ion token buys the thing that actually
carries the realism — Google Photorealistic 3D Tiles, ion asset 2275207 — and deck.gl's own
`Tile3DLayer` renders it inside the existing `MapboxOverlay`. The map engine, every layer and
the camera are unchanged.

- Token lives in `frontend/.env` as `VITE_CESIUM_ION_TOKEN`, which is gitignored.
  `frontend/.env.example` documents it. Without a token the toggle does not render.
- `lib/photoreal.ts` resolves the ion endpoint, moves the Google API key into an
  `X-GOOG-API-KEY` header and preflights the tileset root, so a spent quota reports itself once
  instead of through deck's per-frame retry.
- Google references its tiles to the ellipsoid, so the ground under the city fixture arrives
  910 m up. Each tile's `cartographicOrigin` is lowered by that amount in `onTileLoad`, which
  puts the imagery on the same z = 0 ground every other layer assumes.
- The tileset is capped at screen-space error 20 with memory-adjusted refinement, trading a
  level of detail for frame budget.
- While the imagery draws, the vector basemap layers are hidden and restored exactly — only
  layers `applyDarkScheme` left visible come back, so the POI pins stay hidden. Verified by a
  round trip: 20 hidden layers before, 20 after.
- The toggle is `3D CITY` in the status bar, remembered in `localStorage`, and defaults off.
  Graphite stays the operating basemap because corridors and drone glyphs read better on it;
  photoreal is for briefing and for the demo.

Token pool and recovery. `VITE_CESIUM_ION_TOKEN` accepts several tokens separated by commas.
Each retry advances to the next one, so a revoked token falls through. Measured caveat: ion
hands every token on the same account the identical Google API key, verified by comparing the
key across three tokens, so extra tokens buy resilience against revocation and not extra
imagery quota. The quota is the shared key's, and it refuses in bursts.

What that means in practice, and what the code does about it:

- Tile requests are throttled to six in flight, which is what keeps the key out of its burst
  limit during a camera move.
- A refusal is retried with a backoff doubling from 5 s to 40 s, advancing the token each
  time, rather than latched as a permanent failure.
- A tileset root can be refused without any individual tile erroring, leaving a layer that
  will never draw. A 12 s watchdog rebuilds it instead of leaving a dead layer on screen.
- `photorealReady()` is true only once a tile has actually loaded, not when the tileset JSON
  parses. The vector basemap hides on that signal, so a throttled session shows the graphite
  map rather than a black screen. Observed recovering on its own from token 1 to token 2
  mid-session with the graphite map up throughout.

The imagery is tinted `[30, 36, 46]`, multiplied into every texel by the scenegraph sublayer's
`getColor`. The luma PBR shader computes `texture * baseColorFactor * vertexColor`, so this is
a direct exposure control rather than a lighting trick, and it leaves the unlit overlay layers
untouched. `window.__sky.tint([r,g,b])` rebuilds the tileset at another value for tuning
against a projector.

Cesium OSM Buildings (ion asset 96188) was built as a second source and then removed. Its
tileset resolves and loads, but the traversal selected no tiles and requested no geometry in
this environment, and an unverifiable fallback that holds the screen for 12 s before reaching
the graphite map is worse than going to the graphite map directly.

Known limits: frame rate under the tileset could not be measured here — the automation pane
throttles `requestAnimationFrame` to 1 fps with the tileset both on and off — so it needs one
check on the demo machine.
