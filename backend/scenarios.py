import logging

import bus
import city
import simulator
from shapely.geometry import Point

from geo import nearest_point_on_polyline, polyline_length
from models import Route
from state import AppState

log = logging.getLogger("skyguard.scenarios")

CRUISE = 15.0
LEADS = (("C3", 200.0), ("C7", 212.0))  # 212 offsets the second drone so the miss distance is real, not zero

NAMES = [
    "TRIGGER_COLLISION", "GPS_FAILURE", "COMMS_LOSS", "LOW_BATTERY", "ALTITUDE_VIOLATION",
    "BAD_WEATHER", "CLOSE_ZONE", "LANDING_ZONE_UNAVAILABLE", "MOTOR_FAILURE",
]


def _available(state: AppState) -> list:
    return sorted([d for d in state.drones.values() if d.status in {"IDLE", "CHARGING"} and d.mission_id is None],
                  key=lambda d: d.id)


def _airborne(state: AppState) -> list:
    return sorted([d for d in state.drones.values() if d.status == "ENROUTE"], key=lambda d: d.id)


def _fly_corridor(state: AppState, drone, corridor_id: str, lead_m: float) -> None:
    corridor = state.corridors[corridor_id]
    alt = (corridor.alt_min + corridor.alt_max) / 2
    route = Route(id=f"R-SCN-{drone.id}", waypoints=[(x, y, alt) for x, y in corridor.polyline],
                  corridor_ids=[corridor_id], total_length_m=polyline_length(corridor.polyline),
                  created_by="scenario")
    state.routes[route.id] = route
    _, along, _ = nearest_point_on_polyline(city.C3_C7_CONFLICT, corridor.polyline)
    drone.route_id = route.id
    drone.route_progress_m = max(0.0, along - lead_m)
    drone.alt = drone.target_alt = alt
    drone.speed = CRUISE
    drone.status = "ENROUTE"
    simulator._place(drone, route)
    bus.publish("drone.updated", {"drone": simulator.drone_full(drone), "route": simulator.route_full(route),
                                  "clock": round(state.sim_clock, 2)})


def _pick_two(state: AppState) -> list:
    # reuse the pair already staged for this scenario so the trigger is repeatable
    staged = sorted([d for d in state.drones.values() if (d.route_id or "").startswith("R-SCN-")], key=lambda d: d.id)
    if len(staged) >= 2:
        return staged[:2]
    return _available(state)[:2]


def trigger_collision(state: AppState) -> str:
    free = _pick_two(state)
    if len(free) < 2:
        return "need two available drones"
    for drone, (corridor_id, lead) in zip(free, LEADS):
        _fly_corridor(state, drone, corridor_id, lead)
    log.info("collision scenario: %s on C3, %s on C7 converging on %s", free[0].id, free[1].id, city.C3_C7_CONFLICT)
    return f"{free[0].id} on C3 and {free[1].id} on C7 converging near Hospital 2"


def _degrade(state: AppState, part: str, value: float, divert: bool = False) -> str:
    flying = _airborne(state)
    if not flying:
        return "no airborne drone"
    # prefer a drone actually carrying a mission, so a replacement has something to take over
    drone = next((d for d in flying if d.mission_id is not None), flying[0])
    drone.health[part] = value
    if divert:
        # a physical failure, not a decision: the airframe is degraded and holds for a ruling
        drone.status = "DIVERTING"
    return f"{drone.id} {part} at {value:.0%}"


def run(state: AppState, name: str) -> tuple[str | None, str | None]:
    if name not in NAMES:
        return None, f"unknown scenario {name}"

    if name == "TRIGGER_COLLISION":
        detail = trigger_collision(state)
    elif name == "GPS_FAILURE":
        detail = _degrade(state, "gps", 0.2)
    elif name == "COMMS_LOSS":
        detail = _degrade(state, "comms", 0.0, divert=True)
    elif name == "MOTOR_FAILURE":
        detail = _degrade(state, "motors", 0.3, divert=True)
    elif name == "LOW_BATTERY":
        flying = _airborne(state)
        if not flying:
            return None, "no airborne drone"
        flying[0].battery = 18.0
        detail = f"{flying[0].id} battery at 18%"
    elif name == "ALTITUDE_VIOLATION":
        flying = _airborne(state)
        if not flying:
            return None, "no airborne drone"
        # prefer a drone already inside a ceilinged zone so the breach is real, not notional
        inside = [(d, z) for d in flying for z in state.zones.values() if z.polygon.contains(Point(d.x, d.y))]
        if inside:
            drone, zone = inside[0]
            ceiling = zone.alt_max
        else:
            drone, ceiling = flying[0], 150.0
        drone.alt = drone.target_alt = ceiling + 15.0
        detail = f"{drone.id} climbed to {drone.alt:.0f} m"
    elif name == "BAD_WEATHER":
        state.weather = {"wind_speed": 18.0, "wind_direction": 241.0, "wind_gusts": 22.0,
                         "visibility_m": 1800.0, "precipitation": 4.0, "source": "SCENARIO", "override": True}
        detail = "wind 18 m/s, visibility 1.8 km"
    elif name == "CLOSE_ZONE":
        zone = state.zones["Z-TEMP-B"]
        zone.is_closed = True
        state.revision += 1
        bus.publish("zone.changed", {"zone_id": zone.id, "is_closed": True, "rev": state.revision})
        detail = f"{zone.name} closed"
    else:  # LANDING_ZONE_UNAVAILABLE
        lz = state.landing_zones["LZ-3"]
        lz.occupied = lz.capacity
        state.revision += 1
        bus.publish("zone.changed", {"landing_zone_id": lz.id, "occupied": lz.occupied, "rev": state.revision})
        detail = f"{lz.name} at capacity"

    log.info("scenario %s: %s", name, detail)
    bus.publish("scenario.fired", {"name": name, "detail": detail, "clock": round(state.sim_clock, 2)})
    return detail, None
