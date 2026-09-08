from geo import bearing, dist, point_along, polyline_length, to_ll
from models import Drone, DroneStatus, Route
from state import AppState

DRAIN_BASE = 0.040
DRAIN_PER_KG = 0.0085
DRAIN_CLIMB = 0.25
DRAIN_TAKEOFF = 1.8
DRAIN_LANDING = 1.2
CLIMB_RATE = 3.0

STATUS_CODES: list[str] = ["IDLE", "CHARGING", "MAINTENANCE", "ENROUTE", "HOLDING", "DIVERTING", "LANDING", "LANDED", "LOST"]

# id, home hub, operator, payload kg, package, seeded corridor (None = idle at hub), start progress fraction
SEED: list[tuple[str, str, str, float, str | None, str | None, float]] = [
    ("D-01", "HUB-MED", "OP-MEDX", 2.4, "PKG-MED-01", "C4", 0.15),
    ("D-02", "HUB-MED", "OP-MEDX", 0.4, "PKG-SMP-02", "C5", 0.10),
    ("D-03", "HUB-COM", "OP-SWIFT", 1.2, "PKG-COM-03", "C1", 0.30),
    ("D-04", "HUB-COM", "OP-SWIFT", 1.8, "PKG-COM-04", "C2", 0.20),
    ("D-05", "HUB-COM", "OP-SWIFT", 0.9, "PKG-COM-05", "C6", 0.55),
    ("D-06", "HUB-MED", "OP-MEDX", 1.5, "PKG-MED-06", "C3", 0.05),
    ("D-07", "HUB-COM", "OP-SWIFT", 2.0, "PKG-COM-07", "C8", 0.40),
    ("D-08", "HUB-EMG", "OP-GOV", 1.0, None, "C7", 0.70),
    ("D-09", "HUB-COM", "OP-SWIFT", 0.0, None, None, 0.0),
    ("D-10", "HUB-MED", "OP-MEDX", 0.0, None, None, 0.0),
    ("D-11", "HUB-EMG", "OP-GOV", 0.0, None, None, 0.0),
    ("D-12", "HUB-EMG", "OP-GOV", 0.0, None, None, 0.0),
]


def seed(state: AppState) -> None:
    for did, hub_id, op, payload, pkg, cid, frac in SEED:
        hub = state.hubs[hub_id]
        speed = round(state.rng.uniform(12.0, 18.0), 1)
        drone = Drone(id=did, operator_id=op, x=hub.x, y=hub.y, alt=0.0, speed=speed, heading=0.0,
                      battery=round(state.rng.uniform(78.0, 98.0), 1), noise_db=round(60.0 + 2.0 * payload, 1),
                      payload_kg=payload, package_id=pkg, home_hub_id=hub_id,
                      health={"motors": 1.0, "comms": 1.0, "gps": 1.0})
        hub.drone_ids.append(did)
        if cid is not None:
            route = _round_trip(state, f"R-{did}", cid)
            state.routes[route.id] = route
            drone.route_id = route.id
            drone.status = "ENROUTE"
            drone.route_progress_m = route.total_length_m * frac
            drone.target_alt = route.waypoints[0][2]
            drone.alt = drone.target_alt
            _place(drone, route)
        state.drones[did] = drone


def _round_trip(state: AppState, rid: str, cid: str) -> Route:
    c = state.corridors[cid]
    alt = (c.alt_min + c.alt_max) / 2
    pts = c.polyline + c.polyline[-2::-1]
    return Route(id=rid, waypoints=[(x, y, alt) for x, y in pts], corridor_ids=[cid],
                 total_length_m=polyline_length(pts), created_by="fixture")


def depart(drone: Drone) -> None:
    # called by apply_action when a route is attached; the flat takeoff cost lands here
    drone.battery = max(0.0, drone.battery - DRAIN_TAKEOFF)


def _place(drone: Drone, route: Route) -> None:
    line = [(x, y) for x, y, _ in route.waypoints]
    ahead = min(drone.route_progress_m + 1.0, route.total_length_m)
    here = point_along(line, drone.route_progress_m)
    nxt = point_along(line, ahead)
    drone.x, drone.y = here
    if dist(here, nxt) > 1e-6:
        drone.heading = bearing(here, nxt)


def tick(state: AppState, dt: float) -> None:
    state.sim_clock += dt
    for drone in state.drones.values():
        if drone.status != "ENROUTE" or drone.route_id is None:
            continue
        route = state.routes[drone.route_id]
        climbing = drone.alt < drone.target_alt - 1e-6
        if abs(drone.target_alt - drone.alt) <= CLIMB_RATE * dt:
            drone.alt = drone.target_alt
        else:
            drone.alt += CLIMB_RATE * dt if climbing else -CLIMB_RATE * dt
        if drone.route_progress_m >= route.total_length_m:
            if drone.mission_id is None:
                drone.route_progress_m = 0.0  # fixture traffic loops so the city is never static
            else:
                if drone.speed > 0:
                    drone.battery = max(0.0, drone.battery - DRAIN_LANDING)
                    drone.speed = 0.0
                continue
        drone.route_progress_m = min(route.total_length_m, drone.route_progress_m + drone.speed * dt)
        _place(drone, route)
        rate = DRAIN_BASE + DRAIN_PER_KG * drone.payload_kg + (DRAIN_CLIMB if climbing else 0.0)
        drone.battery = max(0.0, drone.battery - rate * dt)
        if drone.mission_id is not None and drone.mission_id in state.missions:
            remaining = route.total_length_m - drone.route_progress_m
            state.missions[drone.mission_id].eta_s = remaining / drone.speed if drone.speed > 0 else None


def status_code(status: DroneStatus) -> int:
    return STATUS_CODES.index(status)


def telemetry_rows(state: AppState) -> list[list]:
    rows = []
    for d in state.drones.values():
        lat, lng = to_ll(d.x, d.y)
        rows.append([d.id, round(lng, 6), round(lat, 6), round(d.alt, 1), round(d.heading, 1),
                     round(d.speed, 1), round(d.battery, 2), status_code(d.status)])
    return rows


def drone_full(d: Drone) -> dict:
    lat, lng = to_ll(d.x, d.y)
    return {**d.model_dump(exclude={"x", "y"}), "lng": round(lng, 6), "lat": round(lat, 6)}
