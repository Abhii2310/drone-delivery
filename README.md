# SKYGUARD

AI-powered airspace operations and emergency management for autonomous drone fleets.

SKYGUARD is not a drone. It is the software layer that manages a fleet of them across a city — routing normal deliveries, preventing collisions, enforcing airspace rules, and switching the whole city into government-led emergency operations when a disaster hits.

The prototype simulates 12 drones over a 4 km area of Bengaluru. The architecture treats their telemetry exactly as it would treat real hardware.

## The loop

The differentiator is not drones on a map. It is this:

```
OBSERVE → INVESTIGATE → COMPARE → RECOMMEND → HUMAN APPROVE → EXECUTE → AUDIT
```

A deterministic safety engine detects a conflict and computes the geometry. An AI supervisor receives those trusted facts, compares pre-evaluated alternatives, and recommends one with its trade-offs. A human approves. The backend mutates real state. The map changes because the state changed — never because the frontend animated it.

## What it does

**Normal operations** — hospitals, pharmacies, dark stores and logistics operators create deliveries. SKYGUARD assigns a drone, computes a corridor route respecting altitude bands and restricted airspace, and flies it.

**Safety** — deterministic collision prediction (analytic closest point of approach), geofence entry prediction, battery reserve enforcement, altitude ceilings, and noise limits over residential zones. The LLM never touches geometry.

**Emergency operations** — government activates a disaster response. Low-priority missions pause, rescue missions take precedence, emergency corridors open, and every affected flight is rerouted, returned or landed with a live count.

**Emergency landing** — drones never land on arbitrary buildings. An approved landing network is filtered by permission, capacity, reachability and safety score, and the rejected candidates are shown with their reasons.

**Explainability** — every incident produces a timestamped audit trail from detection through approval to execution.

## Architecture

```
React + TypeScript                    FastAPI (single process)
MapLibre GL + deck.gl                 in-memory AppState
                                      10 Hz sim tick, 2 Hz telemetry
  telemetry buffer ──rAF──► deck.gl   deterministic safety engine
  REST ────────────────────────────►  AI supervisor (async, off-tick)
  WebSocket (read-only) ◄───────────  apply_action() — sole state mutator
```

No database. No Docker. No microservices. One backend, one frontend, one simulator, one supervisor.

Full detail in `docs/BUILD-PLAN.md`, `docs/3D-ADDENDUM.md` and `docs/UI-SPEC.md`.

## Run it

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
USE_LIVE_AI=false uvicorn main:app --reload --port 8000

# frontend
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

To use live Claude:

```bash
ANTHROPIC_API_KEY=sk-... USE_LIVE_AI=true uvicorn main:app --port 8000
```

With `USE_LIVE_AI=false` the entire system runs offline. The mock supervisor returns the identical decision schema.

## Demo

**1 — Delivery** Create a medicine delivery from the medical hub to Hospital 2. A drone is assigned and departs. Click View from drone to follow it.

**2 — Autonomous safety** Turn the AI off and trigger a collision: you get a raw alert and nothing else. Turn it on and trigger again: the supervisor investigates, compares alternatives with risk, battery, SLA and community trade-offs, and recommends one. Approve it and watch the drone bank onto the new corridor.

**3 — Government emergency** Activate flood response for Zone B. The command center transforms, low-priority flights stand down, and a live count reports what happened to every affected mission. Create a rescue mission; four drones are assigned by payload. One suffers a motor failure — SKYGUARD ranks the approved landing zones, shows why the nearer ones were rejected, alerts the hub engineer, and dispatches a replacement.

Press `R` to reset to an identical starting state.

## Keyboard

`1` `2` `3` camera modes · `↑` `↓` fleet · `Enter` open drone · `F` follow · `A` approve · `X` reject · `E` emergency · `Space` pause · `R` reset · `Esc` close

## Data sources

OpenFreeMap (basemap and building extrusions), Open-Meteo (live Bengaluru wind and visibility, fed into battery and speed models), OpenStreetMap via Overpass (hospital and school locations, fetched once at build time), OpenSky Network (real ADS-B aircraft, cached and replayed), Anthropic Claude (supervisor reasoning and policy compilation).

## Scope

Built overnight. Simulated drones, in-memory state, no authentication, no hardware. The telemetry interface is deliberately hardware-agnostic — the same control plane would accept ground robots or autonomous delivery vehicles without changing the safety engine.
