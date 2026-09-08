import logging

from shapely.geometry import LineString, Point

import audit
import bus
import routing
import simulator
from geo import dist, nearest_point_on_polyline, polyline_length
from models import Action, Route
from state import AppState

log = logging.getLogger("skyguard.actions")

HOLD_SECONDS = 20.0
RESERVE_PCT = 20.0
IMPLEMENTED = {"REROUTE", "HOLD", "ALTITUDE_CHANGE", "DIVERT_LAND"}


def _snapshot(state: AppState, drone_id: str) -> dict:
    d = state.drones[drone_id]
    return {"drone_id": d.id, "route_id": d.route_id, "status": d.status,
            "target_alt": d.target_alt, "progress_m": round(d.route_progress_m, 1)}


def validate_route(state: AppState, drone_id: str, route: Route) -> str | None:
    """Hard-rule gate. Returns a human-readable reason, or None when the route is legal."""
    drone = state.drones[drone_id]
    for (ax, ay, alt), (bx, by, _) in zip(route.waypoints, route.waypoints[1:]):
        seg = LineString([(ax, ay), (bx, by)])
        for zone in state.zones.values():
            if not routing.zone_active(state, zone) or not seg.intersects(zone.polygon):
                continue
            if zone.allowed_priorities and drone.priority in zone.allowed_priorities:
                continue
            if zone.kind == "NO_FLY" and zone.alt_min <= alt <= zone.alt_max:
                return f"corridor enters {zone.name} at {alt:.0f} m"
            if zone.kind in routing.BLOCKING and zone.alt_min <= alt <= zone.alt_max:
                return f"corridor enters closed {zone.name} at {alt:.0f} m"
            if zone.kind == "HOSPITAL" and alt > zone.alt_max:
                return f"corridor flies at {alt:.0f} m over {zone.name}, whose ceiling is {zone.alt_max:.0f} m"
    speed = drone.speed if drone.speed > 0 else 15.0
    need = 1.25 * 0.055 * route.total_length_m / speed + 1.2
    if drone.battery - need <= RESERVE_PCT:
        return f"route needs {need:.1f}% and would leave {drone.battery - need:.1f}% against a {RESERVE_PCT:.0f}% reserve floor"
    return None


def _join(state: AppState, drone_id: str, route: Route) -> Route:
    """Rebuild the route so it starts at the drone's current position and joins the corridor."""
    drone = state.drones[drone_id]
    line = [(x, y) for x, y, _ in route.waypoints]
    _, along, _ = nearest_point_on_polyline((drone.x, drone.y), line)
    alt = route.waypoints[0][2]
    tail = [(x, y, a) for x, y, a in route.waypoints if
            nearest_point_on_polyline((x, y), line)[1] > along + 1.0]
    joined = [(drone.x, drone.y, drone.alt)]
    join_point = None
    walked = 0.0
    for i in range(len(line) - 1):
        seg = dist(line[i], line[i + 1])
        if walked + seg >= along:
            t = (along - walked) / seg if seg else 0.0
            join_point = (line[i][0] + (line[i + 1][0] - line[i][0]) * t,
                          line[i][1] + (line[i + 1][1] - line[i][1]) * t, alt)
            break
        walked += seg
    if join_point is not None and dist((drone.x, drone.y), join_point[:2]) > 1.0:
        joined.append(join_point)
    joined.extend(tail)
    if len(joined) < 2:
        joined.append(route.waypoints[-1])
    return Route(id=f"{route.id}-join", waypoints=joined, corridor_ids=route.corridor_ids,
                 total_length_m=polyline_length([(x, y) for x, y, _ in joined]),
                 created_by=route.created_by)


def apply_action(state: AppState, action: Action, actor: str, incident_id: str | None = None) -> dict:
    if action.kind not in IMPLEMENTED:
        return {"ok": False, "reason": f"{action.kind} is not implemented yet"}
    drone_id = action.drone_id
    if drone_id is None or drone_id not in state.drones:
        return {"ok": False, "reason": f"unknown drone {drone_id}"}
    drone = state.drones[drone_id]
    if drone.status not in {"ENROUTE", "HOLDING", "DIVERTING"}:
        return {"ok": False, "reason": f"{drone_id} is {drone.status} and cannot be commanded"}

    before = _snapshot(state, drone_id)

    if action.kind == "REROUTE":
        route_id = action.params.get("route_id")
        route = state.routes.get(route_id or "")
        if route is None:
            return {"ok": False, "reason": f"route {route_id} no longer exists"}
        reason = validate_route(state, drone_id, route)
        if reason is not None:
            log.info("rejected reroute of %s: %s", drone_id, reason)
            audit.append(state, actor, "REROUTE_REJECTED", before, before, reason)
            return {"ok": False, "reason": reason}
        joined = _join(state, drone_id, route)
        state.routes[joined.id] = joined
        drone.previous_route_id = drone.route_id
        drone.route_id = joined.id
        drone.route_progress_m = 0.0
        drone.target_alt = joined.waypoints[-1][2]
        drone.status = "ENROUTE"
        detail = f"{drone_id} rerouted via {'+'.join(route.corridor_ids) or 'direct'}, {joined.total_length_m:.0f} m"
    elif action.kind == "DIVERT_LAND":
        pad = state.landing_zones.get(str(action.params.get("landing_zone_id")))
        if pad is None:
            return {"ok": False, "reason": f"unknown landing zone {action.params.get('landing_zone_id')}"}
        if pad.permission != "APPROVED":
            reason = f"{pad.name} permission is {pad.permission.lower()}, not approved"
            audit.append(state, actor, "DIVERT_REJECTED", before, before, reason)
            return {"ok": False, "reason": reason}
        if pad.occupied >= pad.capacity:
            reason = f"{pad.name} is at capacity, {pad.occupied}/{pad.capacity}"
            audit.append(state, actor, "DIVERT_REJECTED", before, before, reason)
            return {"ok": False, "reason": reason}
        route = routing.plan_route(state, (drone.x, drone.y), (pad.x, pad.y), f"R-LAND-{drone.id}",
                                   created_by="divert", priority=drone.priority)
        if route is None:
            reason = f"no legal route from {drone.id} to {pad.name}"
            audit.append(state, actor, "DIVERT_REJECTED", before, before, reason)
            return {"ok": False, "reason": reason}
        state.routes[route.id] = route
        drone.previous_route_id = drone.route_id
        drone.route_id = route.id
        drone.route_progress_m = 0.0
        drone.target_alt = 30.0  # ramps down on approach; the simulator flies it to the deck
        drone.status = "LANDING"
        drone.landing_zone_id = pad.id
        hub = state.hubs[drone.home_hub_id]
        bus.publish("engineer.alerted", {"drone_id": drone.id, "hub_id": hub.id, "engineer_id": hub.engineer_id,
                                         "landing_zone_id": pad.id, "landing_zone_name": pad.name,
                                         "reason": f"{drone.id} diverting to {pad.name}",
                                         "clock": round(state.sim_clock, 2)})
        detail = f"{drone_id} diverting to {pad.name}, {route.total_length_m:.0f} m"
    elif action.kind == "ALTITUDE_CHANGE":
        target = float(action.params.get("target_alt", drone.alt))
        for zone in state.zones.values():
            if zone.polygon.contains(Point(drone.x, drone.y)) and not zone.alt_min <= target <= zone.alt_max:
                reason = f"{target:.0f} m is outside the {zone.name} band of {zone.alt_min:.0f}-{zone.alt_max:.0f} m"
                audit.append(state, actor, "ALTITUDE_CHANGE_REJECTED", before, before, reason)
                return {"ok": False, "reason": reason}
        # target_alt only; the simulator ramps at CLIMB_RATE so the change is visible in 3D
        drone.target_alt = target
        seconds = abs(target - drone.alt) / simulator.CLIMB_RATE
        detail = f"{drone_id} {'descending' if target < drone.alt else 'climbing'} to {target:.0f} m over {seconds:.0f} s"
    else:  # HOLD
        drone.previous_route_id = drone.route_id
        drone.status = "HOLDING"
        drone.speed = 0.0
        detail = f"{drone_id} holding for {HOLD_SECONDS:.0f} s"

    after = _snapshot(state, drone_id)
    audit.append(state, actor, action.kind, before, after, detail)
    payload = {"action": action.model_dump(), "actor": actor, "incident_id": incident_id,
               "detail": detail, "drone": simulator.drone_full(drone), "clock": round(state.sim_clock, 2)}
    if drone.route_id:
        payload["route"] = simulator.route_full(state.routes[drone.route_id])
    bus.publish("decision.executed", payload)
    log.info("apply_action %s by %s: %s", action.kind, actor, detail)
    return {"ok": True, "detail": detail}
