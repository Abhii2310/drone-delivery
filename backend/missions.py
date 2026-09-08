import logging

import bus
import routing
import simulator
from geo import dist
from models import Mission
from state import AppState

log = logging.getLogger("skyguard.missions")

PAYLOAD_KG = {"Medicine": 2.4, "Medical sample": 0.4, "Food": 1.5, "Package": 1.2}
MAX_PAYLOAD_KG = 3.0
RESERVE_PCT = 20.0
CRUISE_SPEED = 15.0
ARRIVE_M = 100.0
AVAILABLE = {"IDLE", "CHARGING"}


def _publish(state: AppState, kind: str, mission: Mission) -> None:
    payload: dict = {"mission": mission.model_dump(), "clock": round(state.sim_clock, 2)}
    if mission.drone_id:
        payload["drone"] = simulator.drone_full(state.drones[mission.drone_id])
        drone = state.drones[mission.drone_id]
        if drone.route_id:
            payload["route"] = simulator.route_full(state.routes[drone.route_id])
    bus.publish(kind, payload)


def pick_drone(state: AppState, origin_hub_id: str, payload_kg: float) -> str | None:
    hub = state.hubs[origin_hub_id]
    candidates = [
        d
        for d in state.drones.values()
        if d.status in AVAILABLE and d.mission_id is None and payload_kg <= MAX_PAYLOAD_KG and d.battery > RESERVE_PCT + 15
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda d: (round(dist((d.x, d.y), (hub.x, hub.y))), -d.battery, d.id))
    return candidates[0].id


def create_mission(state: AppState, kind: str, payload_kind: str, priority: str, origin_hub_id: str, dest_id: str) -> tuple[Mission | None, str | None]:
    if origin_hub_id not in state.hubs:
        return None, f"unknown hub {origin_hub_id}"
    if dest_id not in state.destinations:
        return None, f"unknown destination {dest_id}"
    if payload_kind not in PAYLOAD_KG:
        return None, f"unknown payload {payload_kind}"

    payload_kg = PAYLOAD_KG[payload_kind]
    drone_id = pick_drone(state, origin_hub_id, payload_kg)
    if drone_id is None:
        return None, "no drone available at this hub with enough battery"

    hub = state.hubs[origin_hub_id]
    dest = state.destinations[dest_id]
    mission_id = f"M-{len(state.missions) + 1:03d}"
    route = routing.plan_route(state, (hub.x, hub.y), (dest.x, dest.y), f"R-{mission_id}", created_by=mission_id)
    if route is None:
        return None, f"no legal corridor route from {origin_hub_id} to {dest_id}"

    mission = Mission(id=mission_id, type=kind, priority=priority, payload_kind=payload_kind,
                      origin_hub_id=origin_hub_id, dest_id=dest_id, drone_id=drone_id,
                      state="ENROUTE", created_at=round(state.sim_clock, 2),
                      eta_s=route.total_length_m / CRUISE_SPEED)
    state.missions[mission_id] = mission

    drone = state.drones[drone_id]
    state.routes[route.id] = route
    drone.x, drone.y = hub.x, hub.y
    drone.mission_id = mission_id
    drone.priority = priority
    drone.payload_kg = payload_kg
    drone.package_id = f"PKG-{mission_id}"
    drone.route_id = route.id
    drone.route_progress_m = 0.0
    drone.target_alt = route.waypoints[0][2]
    drone.speed = CRUISE_SPEED
    drone.status = "ENROUTE"
    simulator.depart(drone)

    log.info("%s assigned %s %s -> %s, %.0f m via %s", mission_id, drone_id, origin_hub_id, dest_id,
             route.total_length_m, route.corridor_ids)
    _publish(state, "mission.created", mission)
    return mission, None


def _send_home(state: AppState, mission: Mission) -> None:
    drone = state.drones[mission.drone_id or ""]
    hub = state.hubs[mission.origin_hub_id]
    route = routing.plan_route(state, (drone.x, drone.y), (hub.x, hub.y), f"{mission.id}-home", created_by=mission.id)
    if route is None:
        mission.state = "COMPLETE"
        drone.status = "HOLDING"
        return
    state.routes[route.id] = route
    drone.previous_route_id = drone.route_id
    drone.route_id = route.id
    drone.route_progress_m = 0.0
    drone.target_alt = route.waypoints[0][2]
    drone.payload_kg = 0.0
    drone.package_id = None
    mission.state = "RETURNING"
    mission.eta_s = route.total_length_m / max(drone.speed, 1.0)


def advance(state: AppState) -> None:
    for mission in list(state.missions.values()):
        if mission.drone_id is None or mission.state in {"COMPLETE", "CANCELLED"}:
            continue
        drone = state.drones[mission.drone_id]
        route = state.routes.get(drone.route_id or "")
        if route is None:
            continue
        remaining = route.total_length_m - drone.route_progress_m
        mission.eta_s = round(remaining / drone.speed, 1) if drone.speed > 0 else None

        if mission.state == "ENROUTE":
            dest = state.destinations[mission.dest_id]
            if dist((drone.x, drone.y), (dest.x, dest.y)) <= ARRIVE_M:
                mission.state = "ARRIVING"
                _publish(state, "mission.updated", mission)
        elif mission.state == "ARRIVING":
            if remaining <= 1.0:
                mission.state = "DELIVERED"
                drone.status = "LANDED"
                drone.speed = 0.0
                drone.battery = max(0.0, drone.battery - simulator.DRAIN_LANDING)
                _publish(state, "mission.updated", mission)
                drone.speed = CRUISE_SPEED
                drone.status = "ENROUTE"
                _send_home(state, mission)
                simulator.depart(drone)
                _publish(state, "mission.updated", mission)
        elif mission.state == "RETURNING":
            if remaining <= 1.0:
                mission.state = "COMPLETE"
                drone.status = "IDLE"
                drone.speed = 0.0
                drone.alt = 0.0
                drone.target_alt = 0.0
                drone.mission_id = None
                drone.priority = "NORMAL"
                drone.route_id = None
                drone.previous_route_id = None
                drone.battery = max(0.0, drone.battery - simulator.DRAIN_LANDING)
                mission.eta_s = None
                _publish(state, "mission.updated", mission)
