import logging
from math import cos, hypot, radians, sin

from shapely.geometry import LineString, Point

import ai_supervisor
import bus
import routing
from geo import dist, point_along, to_ll
from models import Drone, Incident
from state import AppState

log = logging.getLogger("skyguard.safety")

HORIZON_S = 30.0
R_MIN_M = 15.0
R_WARN_M = 40.0
V_SEP_M = 20.0
CLIMB_RATE = 3.0
CELL_M = 500.0

DRAIN_CRUISE = 0.055
DRAIN_LANDING = 1.2
RESERVE_PCT = 20.0
SAFETY_K = 1.25

CLEAR_CHECKS_TO_RESOLVE = 3
OPEN_STATES = {"DETECTED", "INVESTIGATING", "AWAITING_APPROVAL"}


def velocity(d: Drone) -> tuple[float, float, float]:
    rad = radians(d.heading)
    valt = 0.0
    if d.alt < d.target_alt - 0.1:
        valt = CLIMB_RATE
    elif d.alt > d.target_alt + 0.1:
        valt = -CLIMB_RATE
    return d.speed * sin(rad), d.speed * cos(rad), valt


def predict_collision(a: Drone, b: Drone) -> dict | None:
    avx, avy, avz = velocity(a)
    bvx, bvy, bvz = velocity(b)
    dp = (b.x - a.x, b.y - a.y)
    dv = (bvx - avx, bvy - avy)
    dv2 = dv[0] ** 2 + dv[1] ** 2
    t = 0.0 if dv2 < 1e-6 else max(0.0, min(HORIZON_S, -(dp[0] * dv[0] + dp[1] * dv[1]) / dv2))
    sep = hypot(dp[0] + dv[0] * t, dp[1] + dv[1] * t)
    v_sep = abs((a.alt + avz * t) - (b.alt + bvz * t))
    if v_sep > V_SEP_M or sep >= R_WARN_M:
        return None
    severity = "CRITICAL" if (sep < R_MIN_M and t < 15) else "WARNING"
    risk = round(100 * (1 - sep / R_WARN_M) * (1 - t / HORIZON_S) ** 0.5)
    return {
        "t_cpa_s": round(t, 1),
        "min_sep_m": round(sep, 1),
        "vertical_sep_m": round(v_sep, 1),
        "severity": severity,
        "risk_pct": max(1, min(99, risk)),
        "closing_speed_mps": round(hypot(dv[0], dv[1]), 1),
        "conflict_point": [round((a.x + avx * t + b.x + bvx * t) / 2, 1), round((a.y + avy * t + b.y + bvy * t) / 2, 1)],
        "conflict_alt_m": round((a.alt + avz * t + b.alt + bvz * t) / 2, 1),
    }


def _airborne(state: AppState) -> list[Drone]:
    return [d for d in state.drones.values() if d.status in {"ENROUTE", "HOLDING", "DIVERTING", "LANDING"}]


def candidate_pairs(drones: list[Drone]) -> list[tuple[Drone, Drone]]:
    grid: dict[tuple[int, int], list[Drone]] = {}
    for d in drones:
        grid.setdefault((int(d.x // CELL_M), int(d.y // CELL_M)), []).append(d)
    pairs, seen = [], set()
    for (cx, cy), bucket in grid.items():
        neighbours = [n for dx in (-1, 0, 1) for dy in (-1, 0, 1) for n in grid.get((cx + dx, cy + dy), [])]
        for a in bucket:
            for b in neighbours:
                if a.id >= b.id:
                    continue
                key = (a.id, b.id)
                if key in seen:
                    continue
                seen.add(key)
                pairs.append((a, b))
    return pairs


def _sanctioned(zone, drone: Drone) -> bool:
    """Traffic the zone explicitly admits, e.g. CRITICAL rescue into an emergency zone."""
    return bool(zone.allowed_priorities) and drone.priority in zone.allowed_priorities


def check_geofence(state: AppState, drone: Drone) -> list[str]:
    here = Point(drone.x, drone.y)
    return [
        z.id
        for z in state.zones.values()
        if routing.zone_active(state, z)
        and z.kind in routing.BLOCKING
        and not _sanctioned(z, drone)
        and z.polygon.contains(here)
        and z.alt_min <= drone.alt <= z.alt_max
    ]


def predict_geofence_entry(state: AppState, drone: Drone) -> tuple[str, float] | None:
    route = state.routes.get(drone.route_id or "")
    if route is None or drone.speed <= 0:
        return None
    line = [(x, y) for x, y, _ in route.waypoints]
    step, walked = 25.0, drone.route_progress_m
    while walked < route.total_length_m:
        p = point_along(line, walked)
        for z in state.zones.values():
            if (routing.zone_active(state, z) and z.kind in routing.BLOCKING
                    and not _sanctioned(z, drone) and z.polygon.contains(Point(p))):
                return z.id, round((walked - drone.route_progress_m) / drone.speed, 1)
        walked += step
    return None


def battery_ok(state: AppState, drone: Drone) -> tuple[bool, float, float]:
    route = state.routes.get(drone.route_id or "")
    speed = drone.speed if drone.speed > 0 else 15.0
    to_dest = (route.total_length_m - drone.route_progress_m) if route else 0.0
    dest = (route.waypoints[-1][0], route.waypoints[-1][1]) if route else (drone.x, drone.y)
    pads = [lz for lz in state.landing_zones.values() if lz.permission == "APPROVED" and lz.occupied < lz.capacity]
    to_pad = min((dist(dest, (lz.x, lz.y)) for lz in pads), default=0.0)
    need = SAFETY_K * DRAIN_CRUISE * (to_dest + to_pad) / speed + DRAIN_LANDING
    return drone.battery - need > RESERVE_PCT, round(need, 2), round(drone.battery - need, 2)


def altitude_check(state: AppState, drone: Drone) -> tuple[str, str, float] | None:
    here = Point(drone.x, drone.y)
    for z in state.zones.values():
        if not z.polygon.contains(here):
            continue
        if drone.alt > z.alt_max:
            return z.id, "ABOVE_MAX", round(drone.alt - z.alt_max, 1)
        if drone.alt < z.alt_min:
            return z.id, "BELOW_MIN", round(z.alt_min - drone.alt, 1)
    return None


def noise_check(state: AppState, drone: Drone) -> str | None:
    here = Point(drone.x, drone.y)
    for z in state.zones.values():
        if z.kind != "RESIDENTIAL_QUIET" or not z.polygon.contains(here):
            continue
        state.noise_ledger.append({"t": round(state.sim_clock, 1), "drone_id": drone.id,
                                   "operator": drone.operator_id, "zone": z.id, "noise_db": drone.noise_db})
        if z.noise_limit_db is not None and drone.noise_db > z.noise_limit_db:
            return z.id
    return None


def landing_capacity_check(state: AppState, lz_id: str) -> bool:
    lz = state.landing_zones[lz_id]
    return lz.occupied < lz.capacity and lz.permission == "APPROVED"


def _wire(state: AppState, inc: Incident) -> dict:
    payload = {"incident": inc.model_dump(), "clock": round(state.sim_clock, 2)}
    point = inc.facts.get("conflict_point")
    if point is not None:
        lat, lng = to_ll(point[0], point[1])
        payload["conflict_ll"] = [round(lat, 6), round(lng, 6)]
    return payload


def _open(state: AppState, key: str) -> Incident | None:
    for inc in state.incidents.values():
        if inc.state in OPEN_STATES and inc.facts.get("key") == key:
            return inc
    return None


def _raise(state: AppState, key: str, kind: str, severity: str, drone_ids: list[str], facts: dict) -> None:
    existing = _open(state, key)
    if existing is not None:
        existing.facts = {**facts, "key": key, "clear_checks": 0}
        existing.severity = severity
        bus.publish("incident.updated", _wire(state, existing))
        return
    incident_id = f"INC-{len(state.incidents) + 1:03d}"
    incident = Incident(id=incident_id, kind=kind, severity=severity, drone_ids=drone_ids,
                        facts={**facts, "key": key, "clear_checks": 0}, state="DETECTED",
                        created_at=round(state.sim_clock, 2))
    state.incidents[incident_id] = incident
    log.info("incident %s (%s) %s %s", incident_id, key, severity, facts.get("min_sep_m", ""))
    bus.publish("incident.created", _wire(state, incident))
    ai_supervisor.dispatch(state, incident)


def _age_out(state: AppState, live_keys: set[str]) -> None:
    for inc in list(state.incidents.values()):
        # an incident awaiting a human decision is the human's to close; apply_action
        # re-validates against current state, so a stale approval is caught there
        if inc.facts.get("key") in live_keys or inc.state not in {"DETECTED", "INVESTIGATING"}:
            continue
        inc.facts["clear_checks"] = inc.facts.get("clear_checks", 0) + 1
        if inc.facts["clear_checks"] >= CLEAR_CHECKS_TO_RESOLVE:
            inc.state = "RESOLVED"
            bus.publish("incident.updated", _wire(state, inc))


def run_checks(state: AppState) -> None:
    live: set[str] = set()
    airborne = _airborne(state)

    for a, b in candidate_pairs(airborne):
        conflict = predict_collision(a, b)
        if conflict is None:
            continue
        key = f"COL:{min(a.id, b.id)}:{max(a.id, b.id)}"
        live.add(key)
        _raise(state, key, "COLLISION", conflict["severity"], sorted([a.id, b.id]), conflict)

    for d in airborne:
        inside = check_geofence(state, d)
        if inside:
            key = f"GEO:{d.id}"
            live.add(key)
            _raise(state, key, "GEOFENCE_BREACH", "CRITICAL", [d.id], {"zones": inside})
        else:
            ahead = predict_geofence_entry(state, d)
            if ahead is not None:
                key = f"GEOPRED:{d.id}"
                live.add(key)
                _raise(state, key, "GEOFENCE_PREDICTED", "WARNING", [d.id], {"zone_id": ahead[0], "eta_s": ahead[1]})

        ok, need, margin = battery_ok(state, d)
        if not ok:
            key = f"BAT:{d.id}"
            live.add(key)
            _raise(state, key, "BATTERY_RESERVE", "CRITICAL" if d.battery < RESERVE_PCT else "WARNING", [d.id],
                   {"battery_pct": round(d.battery, 1), "need_pct": need, "margin_pct": margin, "reserve_pct": RESERVE_PCT})

        alt = altitude_check(state, d)
        if alt is not None:
            key = f"ALT:{d.id}"
            live.add(key)
            _raise(state, key, "ALTITUDE_VIOLATION", "WARNING", [d.id],
                   {"zone_id": alt[0], "kind": alt[1], "delta_m": alt[2]})

        noise_check(state, d)  # ledger only; the community demo queries it, it is not an incident

        for part, value in d.health.items():
            if value < 0.5:
                key = f"HEALTH:{d.id}:{part}"
                live.add(key)
                _raise(state, key, "HEALTH_DEGRADED", "CRITICAL" if value < 0.35 else "WARNING", [d.id],
                       {"part": part, "value": round(value, 2)})

    w = state.weather
    if w.get("wind_gusts", w["wind_speed"]) > 12 or w["visibility_m"] < 2000:
        live.add("WX:CITY")
        _raise(state, "WX:CITY", "WEATHER_ADVISORY", "WARNING", [], dict(w))

    _age_out(state, live)
