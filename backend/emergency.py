import logging

from shapely.geometry import LineString, Point

import actions
import bus
import city
import routing
import simulator
from geo import dist
from models import Action, Mission, Zone
from state import AppState

log = logging.getLogger("skyguard.emergency")

KINDS = ("FLOOD", "FIRE", "EARTHQUAKE", "LANDSLIDE")
RETURN_HOME_BATTERY_PCT = 40.0
PAUSE_PRIORITIES = {"LOW", "NORMAL"}
RANK = {"CRITICAL": 0, "HIGH": 1, "NORMAL": 2, "LOW": 3}
DEPARTURE_SPACING_M = 90.0  # keeps a stream well outside the 40 m warning radius
RESCUE_PAYLOADS = {"MEDICINE": 2.4, "WATER": 2.8, "FOOD": 1.5, "EQUIPMENT": 2.0}
EMERGENCY_CORRIDORS = ("C3", "C7")  # the two that serve the emergency hub


def _step(state: AppState, n: int, name: str, payload: dict) -> None:
    bus.publish("emergency.step", {"step": n, "name": name, **payload, "clock": round(state.sim_clock, 2)})


def _route_hits(state: AppState, drone, polygon) -> bool:
    route = state.routes.get(drone.route_id or "")
    if route is None:
        return polygon.contains(Point(drone.x, drone.y))
    return LineString([(x, y) for x, y, _ in route.waypoints]).intersects(polygon)


def activate(state: AppState, kind: str, zone_id: str) -> tuple[dict | None, str | None]:
    if kind not in KINDS:
        return None, f"unknown disaster kind {kind}"
    if kind != "FLOOD":
        return None, f"{kind} is defined but not implemented; FLOOD is the supported response"
    if state.emergency is not None:
        return None, "an emergency is already active"
    if zone_id not in city.EMERGENCY_POLYGONS:
        return None, f"no pre-authored polygon for {zone_id}"

    polygon = city.EMERGENCY_POLYGONS[zone_id]

    # 1 — mark the zone EMERGENCY and open the emergency corridors
    state.zones[zone_id] = Zone(id=zone_id, name=f"{kind.title()} response {zone_id}", kind="EMERGENCY",
                                polygon=polygon, alt_min=0.0, alt_max=400.0,
                                allowed_priorities=["CRITICAL"])  # rescue traffic may enter
    state.emergency = {"kind": kind, "zone_id": zone_id, "since": round(state.sim_clock, 2),
                       "corridor_ids": list(EMERGENCY_CORRIDORS)}
    state.revision += 1
    _step(state, 1, "zone_marked", {"zone_id": zone_id, "corridor_ids": list(EMERGENCY_CORRIDORS), "rev": state.revision})

    airborne = [d for d in state.drones.values() if d.status in {"ENROUTE", "HOLDING", "DIVERTING"}]
    paused, returning, rerouted, landing = [], [], [], []

    # 2 — pause LOW and NORMAL missions; the low-battery ones go home instead
    for drone in sorted(airborne, key=lambda d: d.id):
        mission = state.missions.get(drone.mission_id or "")
        if mission is None or mission.priority not in PAUSE_PRIORITIES:
            continue
        if drone.battery < RETURN_HOME_BATTERY_PCT:
            hub = state.hubs[drone.home_hub_id]
            route = routing.plan_route(state, (drone.x, drone.y), (hub.x, hub.y), f"R-EMG-HOME-{drone.id}", created_by="emergency")
            if route is not None:
                state.routes[route.id] = route
                if actions.apply_action(state, Action(kind="REROUTE", drone_id=drone.id, params={"route_id": route.id}),
                                        "emergency", None)["ok"]:
                    mission.state = "RETURNING"
                    returning.append(drone.id)
                    continue
        if actions.apply_action(state, Action(kind="HOLD", drone_id=drone.id, params={}), "emergency", None)["ok"]:
            mission.state = "PAUSED"
            paused.append(drone.id)
    _step(state, 2, "missions_paused", {"paused": paused, "returning": returning})

    # 3 — re-rank the mission queue by priority
    order = sorted(state.missions.values(), key=lambda m: (RANK[m.priority], m.created_at))
    state.missions = {m.id: m for m in order}
    _step(state, 3, "queue_reranked", {"order": [m.id for m in order]})

    # 4 — release the emergency hub
    available = sorted(d.id for d in state.drones.values()
                       if d.status in {"IDLE", "CHARGING"} and d.mission_id is None)
    _step(state, 4, "hub_released", {"hub_id": "HUB-EMG", "available": available})

    # 5 — recompute every affected route, through apply_action
    affected = []
    for drone in sorted(airborne, key=lambda d: d.id):
        if drone.id in paused or drone.id in returning or not _route_hits(state, drone, polygon):
            continue
        affected.append(drone.id)
        route = state.routes.get(drone.route_id or "")
        end = (route.waypoints[-1][0], route.waypoints[-1][1]) if route else (drone.x, drone.y)
        clear = routing.plan_route(state, (drone.x, drone.y), end, f"R-EMG-{drone.id}", created_by="emergency")
        if clear is not None:
            state.routes[clear.id] = clear
            if actions.apply_action(state, Action(kind="REROUTE", drone_id=drone.id, params={"route_id": clear.id}),
                                    "emergency", None)["ok"]:
                rerouted.append(drone.id)
                continue
        if actions.apply_action(state, Action(kind="HOLD", drone_id=drone.id, params={}), "emergency", None)["ok"]:
            landing.append(drone.id)
    _step(state, 5, "routes_recomputed", {"rerouted": rerouted, "emergency_landing": landing})

    # 6 — landing zones inside and near the polygon, with live capacity
    pads = sorted(
        ({"id": lz.id, "name": lz.name, "permission": lz.permission, "capacity": lz.capacity,
          "occupied": lz.occupied, "free": lz.capacity - lz.occupied, "safety_score": lz.safety_score,
          "inside": polygon.contains(Point(lz.x, lz.y)),
          "distance_m": round(polygon.distance(Point(lz.x, lz.y)))}
         for lz in state.landing_zones.values()),
        key=lambda p: (not p["inside"], p["distance_m"]))
    _step(state, 6, "landing_surfaced", {"landing_zones": pads})

    # 7 — the summary, every number counted from state
    summary = {"affected": len(set(paused + returning + affected)), "rerouted": len(rerouted),
               "returning": len(returning), "emergency_landing": len(landing), "paused": len(paused),
               "available_for_rescue": len(available), "drone_ids": {
                   "paused": paused, "returning": returning, "rerouted": rerouted,
                   "emergency_landing": landing, "available": available}}
    state.emergency["summary"] = summary
    state.emergency["landing_zones"] = pads
    log.info("FLOOD %s: %s", zone_id, {k: v for k, v in summary.items() if k != "drone_ids"})
    _step(state, 7, "summary", {"summary": summary})
    bus.publish("emergency.changed", {"emergency": state.emergency, "clock": round(state.sim_clock, 2)})
    return state.emergency, None


def deactivate(state: AppState) -> tuple[dict, str | None]:
    if state.emergency is None:
        return {}, "no emergency is active"
    zone_id = state.emergency["zone_id"]
    state.zones.pop(zone_id, None)
    for mission in state.missions.values():
        if mission.state == "PAUSED":
            mission.state = "ENROUTE"
            drone = state.drones.get(mission.drone_id or "")
            if drone is not None and drone.status == "HOLDING":
                drone.status = "ENROUTE"
                drone.speed = 15.0
    state.emergency = None
    state.revision += 1
    bus.publish("emergency.changed", {"emergency": None, "rev": state.revision, "clock": round(state.sim_clock, 2)})
    return {"ok": True}, None


def create_rescue(state: AppState, zone_id: str, payloads: list[str]) -> tuple[dict | None, str | None]:
    if zone_id not in city.EMERGENCY_POLYGONS:
        return None, f"no pre-authored polygon for {zone_id}"
    unknown = [p for p in payloads if p not in RESCUE_PAYLOADS]
    if unknown:
        return None, f"unknown payload(s) {unknown}"

    centre = city.EMERGENCY_POLYGONS[zone_id].centroid
    dest = min(state.destinations.values(), key=lambda d: dist((d.x, d.y), (centre.x, centre.y)))
    assignments: dict[str, str] = {}
    taken: set[str] = set()
    departed_from: dict[str, int] = {}  # sequence departures per hub so drones do not stack

    for payload in payloads:
        pool = [d for d in state.drones.values()
                if d.status in {"IDLE", "CHARGING"} and d.mission_id is None and d.id not in taken
                and d.battery > 35.0]
        if not pool:
            return None, f"no drone available for {payload}"
        pool.sort(key=lambda d: (round(dist((d.x, d.y), (centre.x, centre.y))), -d.battery, d.id))
        drone = pool[0]
        taken.add(drone.id)
        drone.priority = "CRITICAL"  # set before routing so the emergency zone admits it

        mission_id = f"R-{len(state.missions) + 1:03d}"
        hub = state.hubs[drone.home_hub_id]
        route = routing.plan_route(state, (hub.x, hub.y), (dest.x, dest.y), f"RT-{mission_id}",
                                   created_by=mission_id, priority="CRITICAL")
        if route is None:
            return None, f"no legal route to {dest.id} for {payload}"
        state.routes[route.id] = route

        mission = Mission(id=mission_id, type="RESCUE", priority="CRITICAL", payload_kind=payload,
                          origin_hub_id=drone.home_hub_id, dest_id=dest.id, drone_id=drone.id,
                          state="ENROUTE", created_at=round(state.sim_clock, 2),
                          eta_s=route.total_length_m / 15.0)
        state.missions[mission_id] = mission
        drone.x, drone.y = hub.x, hub.y
        drone.mission_id = mission_id
        drone.priority = "CRITICAL"
        drone.payload_kg = RESCUE_PAYLOADS[payload]
        drone.package_id = f"RSC-{payload}"
        drone.route_id = route.id
        slot = departed_from.get(drone.home_hub_id, 0)
        departed_from[drone.home_hub_id] = slot + 1
        drone.route_progress_m = min(slot * DEPARTURE_SPACING_M, max(0.0, route.total_length_m - 1.0))
        simulator._place(drone, route)
        drone.target_alt = route.waypoints[0][2]
        drone.speed = 15.0
        drone.status = "ENROUTE"
        simulator.depart(drone)
        assignments[payload] = drone.id
        bus.publish("mission.created", {"mission": mission.model_dump(), "drone": simulator.drone_full(drone),
                                        "route": simulator.route_full(route), "clock": round(state.sim_clock, 2)})

    log.info("rescue to %s (%s): %s", zone_id, dest.id, assignments)
    bus.publish("rescue.dispatched", {"zone_id": zone_id, "dest_id": dest.id, "assignments": assignments,
                                      "clock": round(state.sim_clock, 2)})
    return {"zone_id": zone_id, "dest_id": dest.id, "assignments": assignments}, None
