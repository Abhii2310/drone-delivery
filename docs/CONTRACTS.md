# SKYGUARD — Wire contracts

Frozen shapes for the WebSocket and REST surface. Updated every step. Last updated: Step 3.

All coordinates on the wire are `[lat, lng]` for city geometry and `lng, lat` fields for drones.
Metres never cross the wire. Altitudes are metres above ground.

## WebSocket `GET /ws`

Server → client only. Inbound frames are read and ignored.

### `hello` — sent once on connect, and rebroadcast after `POST /api/reset`

```json
{"t":"hello","rev":1,"clock":0.0,
 "city":{ ...same body as GET /api/city... },
 "drones":[{ ...Drone fields minus x,y..., "lng":77.6,"lat":12.97 }],
 "missions":[], "incidents":[]}
```

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
