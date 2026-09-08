# SKYGUARD — Wire contracts

Frozen shapes for the WebSocket and REST surface. Updated every step. Last updated: Step 6.

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
 "d":[["D-01", 77.599, 12.9668, 110.0, 132.4, 15.7, 88.61, 3], ...]}
```

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
