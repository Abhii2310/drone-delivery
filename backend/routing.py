import heapq

from shapely.geometry import LineString, Point

from geo import dist, polyline_length
from models import Drone, Route, Zone
from state import AppState

SNAP_M = 500.0
EXTRA_LINKS = 3
LINK_RADIUS_M = 1500.0
DRAIN_BASE = 0.040
DRAIN_PER_KG = 0.0085
BLOCKING = {"NO_FLY", "TEMP_RESTRICTED", "SCHOOL", "EMERGENCY"}

Node = tuple[float, float]
Edge = tuple[Node, float, str, float]  # neighbour, cost_m, corridor_id, altitude_m


def zone_active(state: AppState, zone: Zone) -> bool:
    if zone.kind == "NO_FLY":
        return True
    if zone.kind == "TEMP_RESTRICTED":
        return zone.is_closed
    if zone.kind == "SCHOOL":
        return any(p.get("zone_kind") == "SCHOOL" for p in state.policies)
    if zone.kind == "EMERGENCY":
        return state.emergency is not None
    return True  # HOSPITAL ceiling and RESIDENTIAL_QUIET noise always apply


def _key(p: tuple[float, float]) -> Node:
    return (round(p[0], 1), round(p[1], 1))


def build_graph(state: AppState) -> tuple[dict[Node, list[Edge]], dict[Node, float]]:
    graph: dict[Node, list[Edge]] = {}
    alt_of: dict[Node, float] = {}
    for corridor in state.corridors.values():
        band = (corridor.alt_min + corridor.alt_max) / 2
        for a, b in zip(corridor.polyline, corridor.polyline[1:]):
            ka, kb = _key(a), _key(b)
            cost = dist(a, b)
            graph.setdefault(ka, []).append((kb, cost, corridor.id, band))
            graph.setdefault(kb, []).append((ka, cost, corridor.id, band))
            alt_of.setdefault(ka, band)
            alt_of.setdefault(kb, band)
    return graph, alt_of


def _attach(graph: dict[Node, list[Edge]], alt_of: dict[Node, float], point: tuple[float, float]) -> Node:
    key = _key(point)
    if key in graph:
        return key
    ordered = sorted(graph, key=lambda n: dist(point, n))
    if dist(point, ordered[0]) > SNAP_M:
        raise ValueError(f"point {point} is {dist(point, ordered[0]):.0f} m from the corridor network")
    # attach to several nearby nodes, otherwise a drone mid-corridor is stranded when that
    # corridor is excluded and no alternative can be found
    for node in ordered[:1 + EXTRA_LINKS]:
        gap = dist(point, node)
        if gap > LINK_RADIUS_M:
            break
        band = alt_of[node]
        graph.setdefault(key, []).append((node, gap, "", band))
        graph[node].append((key, gap, "", band))
        alt_of.setdefault(key, band)
    return key


def edge_allowed(state: AppState, a: Node, b: Node, alt: float, alt_min: float, alt_max: float,
                 priority: str = "NORMAL") -> bool:
    if alt < alt_min or alt > alt_max:
        return False
    seg = LineString([a, b])
    for zone in state.zones.values():
        if not zone_active(state, zone) or not seg.intersects(zone.polygon):
            continue
        if zone.allowed_priorities and priority in zone.allowed_priorities:
            continue  # sanctioned traffic, e.g. CRITICAL rescue into an emergency zone
        if zone.kind in BLOCKING and zone.alt_min <= alt <= zone.alt_max:
            return False
        if zone.kind == "HOSPITAL" and alt > zone.alt_max:
            return False
    return True


def plan_route(
    state: AppState,
    from_xy: tuple[float, float],
    to_xy: tuple[float, float],
    route_id: str,
    created_by: str = "routing",
    alt_min: float = 40.0,
    alt_max: float = 150.0,
    exclude_corridor_ids: frozenset[str] = frozenset(),
    priority: str = "NORMAL",
) -> Route | None:
    graph, alt_of = build_graph(state)
    start, goal = _attach(graph, alt_of, from_xy), _attach(graph, alt_of, to_xy)

    best: dict[Node, float] = {start: 0.0}
    came: dict[Node, tuple[Node, str, float]] = {}
    queue: list[tuple[float, Node]] = [(0.0, start)]
    seen: set[Node] = set()
    while queue:
        cost, node = heapq.heappop(queue)
        if node in seen:
            continue
        seen.add(node)
        if node == goal:
            break
        for nxt, step, corridor_id, alt in graph.get(node, []):
            if corridor_id and corridor_id in exclude_corridor_ids:
                continue
            if not edge_allowed(state, node, nxt, alt, alt_min, alt_max, priority):
                continue
            total = cost + step
            if total < best.get(nxt, float("inf")):
                best[nxt] = total
                came[nxt] = (node, corridor_id, alt)
                heapq.heappush(queue, (total, nxt))

    if goal not in best:
        return None
    legs: list[tuple[Node, Node, str, float]] = []
    node = goal
    while node != start:
        prev, corridor_id, alt = came[node]
        legs.append((prev, node, corridor_id, alt))
        node = prev
    legs.reverse()
    corridor_ids: list[str] = []
    for _, _, corridor_id, _ in legs:
        if corridor_id and corridor_id not in corridor_ids:
            corridor_ids.append(corridor_id)
    # a waypoint carries the altitude of the leg LEAVING it, which is what the hard-rule
    # gate and the renderer both assume
    waypoints = [(a[0], a[1], alt) for a, _, _, alt in legs]
    waypoints.append((legs[-1][1][0], legs[-1][1][1], legs[-1][3]))
    line = [(x, y) for x, y, _ in waypoints]
    return Route(id=route_id, waypoints=waypoints, corridor_ids=corridor_ids,
                 total_length_m=polyline_length(line), created_by=created_by)


def find_alternative_routes(state: AppState, drone: Drone, exclude_corridor_ids: frozenset[str] = frozenset()) -> list[Route]:
    if drone.route_id is None:
        return []
    current = state.routes[drone.route_id]
    start, end = (drone.x, drone.y), (current.waypoints[-1][0], current.waypoints[-1][1])
    routes: list[Route] = []
    banned = set(exclude_corridor_ids)
    for n in range(3):
        route = plan_route(state, start, end, f"{drone.route_id}-alt{n}", created_by="routing",
                           exclude_corridor_ids=frozenset(banned))
        if route is None:
            break
        if any(abs(route.total_length_m - r.total_length_m) < 1.0 and route.corridor_ids == r.corridor_ids for r in routes):
            break
        routes.append(route)
        if not route.corridor_ids:
            break
        banned.add(route.corridor_ids[0])
    return routes


def evaluate_route(state: AppState, drone: Drone, route: Route) -> dict:
    speed = drone.speed if drone.speed > 0 else 15.0
    line = LineString([(x, y) for x, y, _ in route.waypoints])
    eta_s, rate = route.total_length_m / speed, DRAIN_BASE + DRAIN_PER_KG * drone.payload_kg
    zones_crossed, quiet_m = [], 0.0
    for zone in state.zones.values():
        if not line.intersects(zone.polygon):
            continue
        zones_crossed.append(zone.id)
        if zone.kind == "RESIDENTIAL_QUIET":
            quiet_m += line.intersection(zone.polygon).length
    others = [d for d in state.drones.values() if d.id != drone.id and d.status == "ENROUTE"]
    min_sep = min((line.distance(Point(d.x, d.y)) for d in others), default=float("inf"))
    return {
        "length_m": round(route.total_length_m, 1),
        "eta_s": round(eta_s, 1),
        "battery_cost_pct": round(rate * eta_s, 2),
        "zones_crossed": sorted(zones_crossed),
        "quiet_zone_seconds": round(quiet_m / speed, 1),
        "min_sep_to_other_drones": round(min_sep, 1) if min_sep != float("inf") else None,
    }
