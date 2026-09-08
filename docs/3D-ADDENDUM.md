# SKYGUARD — 3D City Addendum

This reverses the "skip 3D" call in the main plan. It is doable properly, but only with a different engine choice than the one your spec assumed, and only if you build it from hour 0.5 instead of bolting it on at hour 9.

---

## 1. Engine decision: MapLibre GL JS + deck.gl. Not Cesium. Not Leaflet.

Cesium is the obvious pick and the wrong one for tonight. It wants an Ion account and token, its Vite integration needs asset-copying config, its entity API is a different mental model from everything else you're building, and its default look is a photorealistic globe you then have to fight into an ops-console aesthetic.

**MapLibre GL JS + deck.gl** gives you everything you actually need:

| You need | How you get it |
|---|---|
| 3D buildings | MapLibre `fill-extrusion` on OSM vector tiles — real Bengaluru footprints with heights |
| Tilt, rotate, fly-to | Native to MapLibre: `pitch`, `bearing`, `flyTo`, `jumpTo` |
| Airspace as volumes | deck.gl `PolygonLayer` with `extruded: true` |
| 12 drones at 60fps | deck.gl, designed for 10⁵ objects |
| Routes in 3D | deck.gl `PathLayer` with z-coordinates |
| No account, no token | OpenFreeMap tiles are free and keyless |
| 2D fallback | `pitch: 0`. Same code. Zero rewrite. |

That last row is why you build it from the start. Leaflet → MapLibre at hour 9 is a full rewrite of your render path. MapLibre at pitch 0 *is* your 2D fallback, so the risk of committing early is nearly zero.

```bash
npm i maplibre-gl deck.gl @deck.gl/layers @deck.gl/mapbox
```

Basemap style: `https://tiles.openfreemap.org/styles/liberty` — free, keyless, includes building extrusions. Restyle it dark to match the sectional palette by overriding paint properties after `map.on('load')`; don't author a style JSON from scratch.

**Verify the tile URL is still live before you commit** — my knowledge has a cutoff and free tile hosts change. Backup is a MapTiler free key. Test both in the first 10 minutes.

---

## 2. The actual argument for 3D — build to this, not to "it looks cool"

2D shows you *where* drones are. 3D shows you *airspace*, and airspace is your product.

Your altitude management and geofence features are currently invisible: in 2D, an altitude violation is a red text label. In 3D it is a drone visibly punching through the ceiling of a translucent magenta prism. That is the feature, finally rendered.

So the deck.gl layer that matters most is not the drones. It's this:

**Zones become extruded volumes from `alt_min` to `alt_max`.**

- `NO_FLY` — magenta `#E0398B` at 10% fill, 45% edges, floor to 400m. A solid wall of prohibited air.
- `HOSPITAL` — blue prism with a hard ceiling at 90m, so the low-ceiling rule is legible.
- `SCHOOL` — invisible until the policy compiler activates it at 15:00, then it *rises out of the ground*. That is your policy demo's money shot and it only exists in 3D.
- `RESIDENTIAL_QUIET` — amber, low, wide.
- `TEMP_RESTRICTED` — the one Government closes on stage; it materialises and 24 flights bend around it.

Corridors become tubes at their assigned altitude band, so "reroute to corridor C7" is a visible change of lane in three dimensions.

**Add a new AI action kind: `ALTITUDE_CHANGE`.** Vertical deconfliction is cheaper than lateral rerouting on both battery and SLA, so the AI should often prefer it — and it is the resolution that 3D makes comprehensible. One drone descends 30m under the other and the conflict clears. In 2D that reads as nothing; in 3D it's the most persuasive five seconds of your demo. Your safety engine already computes vertical separation at `t_cpa`, so the facts are there.

---

## 3. Layer stack

Bottom to top. Build in this order; each one is independently demoable.

```
0  MapLibre basemap        dark-restyled, fill-extrusion buildings at zoom ≥ 14
1  SolidPolygonLayer       airspace volumes, extruded, translucent, depth-tested
2  PathLayer               corridors as tubes at their altitude band, width 8m
3  PathLayer               active drone routes, z = flight altitude, vfr-blue
4  PathLayer               ghost route (dashed, 30% opacity) during a reroute
5  ScatterplotLayer        ground shadow ellipse at z=0 under each drone
6  LineLayer               vertical tether, drone → its ground shadow
7  IconLayer               drone glyph, billboard:false, getAngle:heading
8  TextLayer               callsign + altitude, billboard:true, offset above drone
9  ColumnLayer             landing zones as low glowing pads
   HTML overlay            HUD, panels, everything from the main plan
```

**Items 5 and 6 are not optional.** Without a ground shadow and a vertical tether, objects in a tilted 3D view float ambiguously — you genuinely cannot tell where a drone is over the ground or how high it is. Every serious flight visualisation does this. It's 20 lines and it's the difference between readable and confusing.

**Drone glyph:** use `IconLayer` with `billboard: false` and `getAngle: d => -d.heading`. The icon lies flat in the world plane and rotates with heading — like a navigation arrow. This reads correctly at every pitch, needs no 3D asset, and cannot fail. Upgrade to `ScenegraphLayer` with a glTF quadcopter *only* if you're ahead at hour 10. Do not go asset-hunting at 1am.

**Zone volume gotcha:** to float a prism from `alt_min` rather than the ground, give each polygon ring vertex a z of `alt_min` and set `getElevation` to `alt_max - alt_min`. Test this in the first 20 minutes of the layer work; if the base offset doesn't render, fall back to extruding from ground with a distinct floor-plane polygon at `alt_min`.

---

## 4. Fix your city scale before you do anything else

This will bite you and it's invisible until it does.

Drones fly at 80–150m. If your demo city spans 10km, that altitude is ~1% of the view width — completely illegible at city zoom, and the whole point of 3D evaporates. You'd then be tempted to fake a vertical exaggeration, which makes buildings and drones disagree and looks wrong.

**Shrink the fixture to ~4km across.** Real scale, no exaggeration, and at `zoom 14 / pitch 55` both the 30m buildings and the 120m drones read clearly in the same frame. Adjust `city.py` accordingly — corridors 1–2.5km, drone speed 12–18 m/s, so a delivery takes 90–150 seconds. That's also a better demo pace than a five-minute flight.

Camera presets that work at this scale:

```
CITY      zoom 13.8   pitch 52   bearing 0
INCIDENT  zoom 16.0   pitch 45   bearing = perpendicular to the conflict axis
DRONE     zoom 17.2   pitch 72   bearing = drone heading
```

---

## 5. Camera system

Three modes, one controller, driven from the same rAF loop that interpolates telemetry.

### Chase cam — the part that's easy to get wrong

Two mistakes make a follow-cam nauseating: snapping the camera to the drone every frame, and centring the drone in the viewport so you can't see where it's going.

Fix both:

```ts
// runs inside the existing rAF loop, after telemetry interpolation
const LOOK_AHEAD_M = 160;   // camera sits behind the drone
const K_POS = 3.5;          // damping constants
const K_BRG = 2.2;
function updateChaseCam(drone, dt) {
  // target: a point BEHIND the drone along its heading, so the drone
  // renders in the lower third and the route ahead fills the frame
  const back = bearingOffset(drone.lng, drone.lat, drone.heading + 180, LOOK_AHEAD_M);
  // exponential damping — frame-rate independent, no snap
  const a = 1 - Math.exp(-K_POS * dt);
  cam.lng += (back.lng - cam.lng) * a;
  cam.lat += (back.lat - cam.lat) * a;
  // bearing needs shortest-angle wrapping or it spins the long way round
  const b = 1 - Math.exp(-K_BRG * dt);
  let delta = ((drone.heading - cam.bearing + 540) % 360) - 180;
  cam.bearing += delta * b;
  map.jumpTo({ center: [cam.lng, cam.lat], bearing: cam.bearing,
               pitch: 72, zoom: 17.2 });
}
```

Use `jumpTo`, never `easeTo`, inside the rAF loop — you are already interpolating, and easing on top of interpolation produces lag and rubber-banding.

`prefers-reduced-motion`: drop pitch to 40, raise damping to near-instant, disable bearing follow.

### Incident cam

On `incident.created`, `flyTo` a frame containing both drones and the predicted conflict point, `duration: 1400`, pitch 45, bearing perpendicular to the conflict axis so the two converging tracks are both visible rather than one hiding the other. Small detail, big readability win.

### Mode switching

`CITY → DRONE` uses `flyTo` (1200ms) once, then the rAF chase cam takes over. Never leave a mode transition to the damping function; it looks like drift.

---

## 6. HUD for drone view

The HUD sells the drone view far more than the terrain does. Pure HTML/CSS overlay, IBM Plex Mono, no canvas.

```
┌──────────────────────────────────────────────────┐
│  ·····│·····060·····│·····075·····│·····090·····  │  heading tape
│                                                  │
│ ALT                                         BAT  │
│ 150─                                       ─100  │
│ 130─                                        ─75  │
│ 118■   ◄ current                        62■ ─50  │
│ 100─                                        ─25  │
│  80─                                              │
│                      ✛                            │  crosshair
│                                                  │
│  D-01 · MED→HOSP-2 · CRITICAL      14.2 m/s      │
│  ▓ ZONE HOSP-2 CEILING 90m IN 340m               │  advisory strip
└──────────────────────────────────────────────────┘
```

Altitude ladder on the left with the zone ceiling drawn as a magenta line on the same scale — so when the drone approaches a ceiling you watch the marker climb toward it. That's the altitude feature, visualised, in the one place a judge is guaranteed to be looking.

---

## 7. Offline insurance — do this at hour 0, it takes 15 minutes

Venue wifi will fail. A 3D map that needs live tiles is a demo that dies.

1. Pull a PMTiles extract of the Bengaluru area from protomaps.com (a ~4km bounding box is small — tens of MB).
2. `npm i pmtiles`, register the protocol with MapLibre, point the style at the local file.
3. Serve it from the FastAPI static mount.

Now your entire 3D city runs from disk. Combined with `MOCK_AI`, the whole demo works with the wifi switched off. Do this early, while it's cheap, not at hour 11 when it's a panic.

---

## 8. What 3D costs and what pays for it

Honest budget, owned by person C:

| Task | Time |
|---|---|
| MapLibre + dark restyle + building extrusions + pitch | 40 min |
| deck.gl overlay wired to the telemetry buffer | 40 min |
| Extruded zone volumes + corridor tubes | 35 min |
| Drone glyph + shadow + tether + label | 30 min |
| Chase cam with damping + mode transitions | 45 min |
| HUD | 35 min |
| Incident cam | 20 min |
| PMTiles offline | 15 min |
| **Total** | **~4h 20m** |

That is real time and it has to come from somewhere. **Cut, in this order: community/noise complaints (gone), policy compiler (build only if you're green at hour 10), replacement-drone dispatch (fold into a single "dispatch D-11" button with no route logic).**

Do not pay for 3D by cutting anything in the core loop. If you're behind at the hour-2.5 gate, set `pitch: 0` and ship the 2D version of the same code — you lose the visual, you lose nothing else, and it costs you zero minutes to make that call.

---

## 9. Revised schedule

| Hour | Deliverable | Gate |
|---|---|---|
| 0.0–0.4 | Scaffold, WS handshake, tick loop, **verify tile URL + pull PMTiles** | — |
| 0.4–1.2 | `geo.py`, `city.py` at 4km scale, simulator | Telemetry in console |
| 1.2–2.0 | MapLibre, dark style, building extrusions, pitch 52 | **3D Bengaluru on screen** |
| 2.0–2.8 | deck.gl overlay, drone icons + shadow + tether, rAF interpolation | **12 drones gliding in 3D** ← hard gate |
| 2.8–3.6 | Zone volumes, corridor tubes, route paths | Airspace is visible |
| 3.6–4.4 | Delivery composer, assignment, routing | Create → drone departs |
| 4.4–5.6 | Safety engine, incidents, scenario buttons, incident cam | Trigger collision → camera flies in |
| 5.6–7.0 | MOCK_AI, supervisor panel, approve → `apply_action` → reroute | **Core loop closed** |
| 7.0–7.5 | Live Claude behind the same interface + `ALTITUDE_CHANGE` action | Vertical deconfliction demo |
| 7.5–8.3 | Chase cam + HUD | View from drone works |
| 8.3–9.3 | Emergency mode, flood, rescue mission | Affected-flights summary is real |
| 9.3–10.2 | Emergency landing + engineer alert | Demo 3 end-to-end |
| 10.2–11.0 | Roles, kill-AI, reset, timeline, UI pass | — |
| 11.0–12.0 | **Three rehearsals + screen recording** | Video backup exists |

The 2.0–2.8 gate is now the one that decides everything. If 12 drones are not gliding over extruded buildings by hour 2.8, set `pitch: 0`, delete the chase cam and HUD from the plan, and reclaim 80 minutes for the core loop. Make that call at 2.8 and do not revisit it.

---

## 10. Prompt block for Claude Code

Replace the frontend/render sections of your previous prompt with this.

```
## 3D map — MapLibre GL JS + deck.gl. Do NOT use Cesium or Leaflet.
npm i maplibre-gl deck.gl @deck.gl/layers @deck.gl/mapbox pmtiles
Basemap: OpenFreeMap Liberty style (free, no API key). Verify the URL loads before building
on it. After map load, override paint properties to a dark scheme; do not author a style JSON.
Enable fill-extrusion for buildings at zoom >= 14 using OSM height/render_height.
Camera presets:
  CITY     zoom 13.8  pitch 52  bearing 0
  INCIDENT zoom 16.0  pitch 45  bearing perpendicular to the conflict axis
  DRONE    zoom 17.2  pitch 72  bearing = drone heading
City fixture must span roughly 4 km, not 10 km. At larger extents a 120 m altitude is
illegible and the 3D view is pointless. Corridors 1–2.5 km. Drone speed 12–18 m/s.
## deck.gl layer stack, bottom to top
1. SolidPolygonLayer  — airspace zones as EXTRUDED VOLUMES. Each ring vertex carries
   z = zone.alt_min; getElevation = alt_max - alt_min. Translucent fill (10%), bright edges.
   NO_FLY magenta #E0398B floor-to-400m, HOSPITAL blue with a 90 m ceiling, SCHOOL hidden
   until a policy activates it (it must visibly rise out of the ground), RESIDENTIAL_QUIET
   amber, TEMP_RESTRICTED closable on stage.
2. PathLayer — corridors as tubes at their altitude band, width 8 m.
3. PathLayer — active routes at flight altitude in #5B9DD9.
4. PathLayer — ghost route, dashed, 30% opacity, shown during a reroute.
5. ScatterplotLayer — ground shadow ellipse at z=0 under each drone.
6. LineLayer — vertical tether from drone to its ground shadow. REQUIRED: without a shadow
   and tether, altitude is unreadable in a tilted view.
7. IconLayer — drone glyph, billboard:false, getAngle: -heading, so it lies flat in the world
   plane and rotates with heading. Do NOT use a glTF model or go looking for 3D assets.
8. TextLayer — callsign and altitude, billboard:true, offset above the drone.
9. ColumnLayer — landing zones as low glowing pads.
## Chase camera
Drive it from the SAME requestAnimationFrame loop that interpolates telemetry, using
map.jumpTo — never easeTo inside rAF, that double-smooths and rubber-bands.
Camera target is a point 160 m BEHIND the drone along its heading, so the drone sits in the
lower third and the route ahead fills the frame.
Damping must be frame-rate independent: alpha = 1 - exp(-k*dt), k=3.5 for position,
k=2.2 for bearing. Bearing must use shortest-angle wrapping:
  delta = ((target - current + 540) % 360) - 180
Mode transitions use flyTo(1200ms) once, then rAF takes over. On prefers-reduced-motion,
drop pitch to 40 and disable bearing follow.
## Incident camera
On incident.created, flyTo a frame containing both drones and the predicted conflict point,
duration 1400ms, pitch 45, bearing perpendicular to the conflict axis so both converging
tracks are visible.
## Drone-view HUD
HTML/CSS overlay in IBM Plex Mono, no canvas. Heading tape across the top, altitude ladder
left with the current zone's ceiling drawn as a magenta line on the same scale, battery
ladder right, centre crosshair, bottom strip with callsign, mission, priority, ground speed,
and an advisory line ("ZONE HOSP-2 CEILING 90m IN 340m").
## New AI action kind: ALTITUDE_CHANGE
The safety engine already computes vertical separation at t_cpa. Add ALTITUDE_CHANGE to the
Action enum and generate it as an alternative whenever a 25–40 m vertical offset clears the
conflict without breaching the zone's alt_min/alt_max. It is usually cheaper than a lateral
reroute on both battery and SLA, so the supervisor should often prefer it. apply_action must
ramp altitude over ~8 s rather than teleporting, so the descent is visible.
## Offline tiles
Pull a PMTiles extract covering the 4 km demo bbox, serve it from FastAPI static, register
the pmtiles protocol with MapLibre. Do this in the first hour. Combined with MOCK_AI the
entire demo must run with the network disconnected.
## Fallback rule
If 12 drones are not gliding smoothly over extruded buildings by the 2.8-hour mark, set
pitch: 0, drop the chase cam and HUD, and continue with the identical codebase in 2D.
Tell me if we reach that point rather than spending extra time on it.
```
