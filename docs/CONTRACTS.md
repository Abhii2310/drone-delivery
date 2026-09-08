# SKYGUARD — Wire contracts

Frozen shapes for the WebSocket and REST surface. Updated every step. Last updated: Step 10.

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
| POST | `/api/ai` | `{enabled}` | `{ai_enabled}`; also broadcasts `ai.changed` | 10 |

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
