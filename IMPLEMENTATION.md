# SKYGUARD — Implementation Plan

Target: working demo at **08:30**. 17 steps, ~12 hours including rehearsal.

---

## Schedule

Times assume a 20:00 start. Shift the "clock" column if you start later.

| Step | What | Budget | T+ | Clock |
|---|---|---|---|---|
| 0 | Scaffold, dependencies, connectivity check | 20m | 0:00 | 20:00 |
| 1 | Backend core, models, city fixture | 45m | 0:20 | 20:20 |
| 2 | Simulator + WebSocket telemetry | 35m | 1:05 | 21:05 |
| 3 | MapLibre 3D basemap | 40m | 1:40 | 21:40 |
| 4 | deck.gl drones + interpolation | 45m | 2:20 | 22:20 |
| | **▶ GATE A** — 12 drones gliding in 3D | | **3:05** | **23:05** |
| 5 | Airspace volumes, corridors, POIs | 35m | 3:05 | 23:05 |
| 6 | Command shell: top bar, flight strips, timeline | 45m | 3:40 | 23:40 |
| 7 | Delivery creation end-to-end | 40m | 4:25 | 00:25 |
| 8 | Safety engine, incidents, scenarios, incident cam | 55m | 5:05 | 01:05 |
| 9 | MOCK AI, supervisor, approve → real reroute | 60m | 6:00 | 02:00 |
| | **▶ GATE B** — CORE LOOP CLOSED. You have a product. | | **7:00** | **03:00** |
| 10 | Live Claude, ALTITUDE_CHANGE, kill-AI toggle | 30m | 7:00 | 03:00 |
| 11 | Emergency mode + rescue missions | 50m | 7:30 | 03:30 |
| 12 | Emergency landing + replacement dispatch | 40m | 8:20 | 04:20 |
| 13 | Drone drawer + chase cam + HUD | 50m | 9:00 | 05:00 |
| 14 | Roles, weather, reset, state polish | 35m | 9:50 | 05:50 |
| 15 | Visual polish pass | 55m | 10:25 | 06:25 |
| 16 | Rehearsal, recording, offline mode | 45m | 11:20 | 07:20 |
| | **Buffer** | 25m | 12:05 | 08:05 |

---

## The two gates

**GATE A — 23:05.** Twelve drones must be gliding smoothly over extruded 3D buildings.
If not: set `pitch: 0` in the map config, delete Steps 13's chase cam and HUD from your plan, and continue in 2D with the identical codebase. Make the call once. Do not revisit it, do not spend "just another 20 minutes."

**GATE B — 03:00.** The core loop must work: create delivery → drone flies → conflict detected → AI investigates → human approves → **backend mutates the route** → map visibly changes → timeline records it.
If not: stop building forward. Fix the loop. Steps 10–14 are all optional; the loop is not.

---

## Cut policy

When you fall behind, cut in this order. Never negotiate with the list at 5am.

1. Step 14 (roles, weather) — fold into "GOVERNMENT only", hardcode wind
2. Step 13 (chase cam, HUD) — keep the drawer, drop the camera
3. Step 12 (replacement dispatch) — keep landing selection, drop the replacement
4. Step 10 (live Claude) — ship on MOCK_AI, it is indistinguishable
5. Step 11 (emergency mode) — last resort; this costs you demo 3

**Never cut:** Step 15 (a working ugly demo loses to a working beautiful one) or Step 16 (a demo you have never rehearsed will fail in front of judges).

---

## Setup once, before Step 0

```
skyguard/
  CLAUDE.md              ← paste from the kit
  IMPLEMENTATION.md      ← this file
  README.md
  docs/
    BUILD-PLAN.md
    3D-ADDENDUM.md
    UI-SPEC.md
  backend/
  frontend/
  fixtures/
```

Put all three docs in `docs/` before you send Step 0. Claude Code reads them; the prompts reference them by section, which keeps each prompt short and keeps the agent anchored.

---

## Verification tracker

Tick these yourself in a browser. Never accept "it should work."

**Step 0** □ `uvicorn` serves `/health` □ `npm run dev` serves a blank page □ tile URL returns 200 □ Open-Meteo returns JSON

**Step 1** □ `GET /api/city` returns 5 zones, 8 corridors, 3 hubs, 6 landing zones □ C3 and C7 geometrically intersect □ city bbox is ~4km across

**Step 2** □ WS emits a `tick` every 500ms □ drone x/y change between ticks □ battery decreases □ `POST /api/reset` returns identical state

**Step 3** □ 3D buildings visible at zoom 14, pitch 52 □ dark restyle applied □ map does not flicker on pan

**Step 4** □ 12 drones visible □ movement is smooth, not stepped □ each has a ground shadow and a vertical tether □ 60fps in devtools performance

**Step 5** □ NO-FLY renders as a translucent magenta volume □ hospital ceiling at 90m is visible □ corridors render as tubes at altitude

**Step 6** □ flight strips show live telemetry □ numbers do not jitter horizontally □ top bar counts are real □ timeline scrolls

**Step 7** □ create a medicine delivery → a drone departs within 2s □ its route renders □ mission appears in the strip □ ETA counts down

**Step 8** □ TRIGGER COLLISION creates exactly ONE incident, not twenty □ camera flies to the incident □ incident shows separation and t-CPA □ RESET clears it

**Step 9** □ supervisor shows investigating, then alternatives □ Approve is disabled until a decision is ready □ approve → route visibly changes in the 3D view □ **network tab shows the POST before the change** □ timeline has all six steps

**Step 10** □ `USE_LIVE_AI=true` produces a real Claude decision in the same UI □ pull the wifi → falls back to mock silently □ AI OFF shows only a raw alert

**Step 11** □ activate flood → chrome transforms □ affected-flights summary numbers match reality □ rescue mission assigns 4 drones

**Step 12** □ trigger MOTOR FAILURE → landing candidates appear with rejected reasons □ approve → drone diverts and descends □ engineer alert fires

**Step 13** □ VIEW FROM DRONE is smooth, not nauseating □ HUD altitude ladder shows the zone ceiling □ Esc returns to city view

**Step 14** □ each role sees a different data set (verify server-side, not CSS) □ wind shows real Bengaluru values

**Step 15** □ no element has border-radius > 4px □ nothing glows except critical / emergency / selected □ green appears only on execution □ full keyboard pass works

**Step 16** □ three clean end-to-end runs □ recording saved to the presenting laptop □ demo works with wifi off

---

## Roles (if you have a team of 4)

- **A — Backend sim & safety.** Steps 1, 2, 7, 8. Owns determinism.
- **B — AI & decisions.** Steps 9, 10, 11, 12. Owns `apply_action` integrity.
- **C — Map & render.** Steps 3, 4, 5, 13. Owns 60fps.
- **D — UI & demo.** Steps 6, 14, 15, 16. **Owns the demo script and has veto power on new features after Step 14.**

Freeze the WS message shapes and REST paths at the end of Step 2 in `docs/CONTRACTS.md`. After that A/B and C/D never block each other.

If you are solo, run the steps in order and cut aggressively at each gate.
