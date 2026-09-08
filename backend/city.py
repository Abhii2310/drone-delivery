import logging

from shapely.geometry import LineString, Point, Polygon

from geo import dist, polyline_length, to_ll, to_xy
from models import Corridor, Destination, Hub, LandingZone, Zone
from state import AppState

log = logging.getLogger("skyguard.city")

__all__ = ["load", "serialize", "to_ll", "EMERGENCY_POLYGONS", "C3_C7_CONFLICT", "BBOX_M"]

LL = tuple[float, float]

# All literals are (lat, lng). Extent ~4 km x 4 km around ORIGIN (12.9716, 77.5946).
ZONES: list[tuple[str, str, str, list[LL], float, float, dict]] = [
    ("Z-NOFLY-A1", "HAL approach NO-FLY A1", "NO_FLY",
     [(12.9780, 77.6040), (12.9896, 77.6040), (12.9896, 77.6131), (12.9700, 77.6131), (12.9700, 77.6090)],
     0, 400, {}),
    ("Z-HOSP-2", "Hospital 2 low ceiling", "HOSPITAL",
     [(12.9727, 77.5975), (12.9727, 77.6005), (12.9753, 77.6005), (12.9753, 77.5975)],
     0, 90, {}),
    ("Z-SCHOOL-1", "Richmond Town school", "SCHOOL",
     [(12.9630, 77.5928), (12.9630, 77.5952), (12.9652, 77.5952), (12.9652, 77.5928)],
     0, 120, {"active_hours": ("15:00", "16:00")}),
    ("Z-QUIET-W", "Malleshwaram quiet zone", "RESIDENTIAL_QUIET",
     [(12.9740, 77.5820), (12.9740, 77.5900), (12.9820, 77.5900), (12.9820, 77.5820)],
     0, 150, {"noise_limit_db": 55}),
    ("Z-TEMP-B", "Zone B temporary restriction", "TEMP_RESTRICTED",
     [(12.9640, 77.6000), (12.9640, 77.6040), (12.9680, 77.6040), (12.9680, 77.6000)],
     0, 150, {}),
]

HUBS: list[tuple[str, str, LL, str, int]] = [
    ("HUB-COM", "COMMERCIAL", (12.9700, 77.5800), "ENG-COM-1", 4),
    ("HUB-MED", "MEDICAL", (12.9700, 77.5960), "ENG-MED-1", 4),
    ("HUB-EMG", "EMERGENCY", (12.9870, 77.5950), "ENG-EMG-1", 6),
]

DESTINATIONS: list[tuple[str, str, str, LL]] = [
    ("HOSP-1", "Hospital 1", "HOSPITAL", (12.9610, 77.6050)),
    ("HOSP-2", "Hospital 2", "HOSPITAL", (12.9740, 77.5990)),
    ("DS-1", "Dark store north", "DARK_STORE", (12.9850, 77.5790)),
    ("DS-2", "Dark store south", "DARK_STORE", (12.9620, 77.5860)),
]

CORRIDORS: list[tuple[str, str, list[LL], float, float]] = [
    ("C1", "HUB-COM to DS-2", [(12.9700, 77.5800), (12.9620, 77.5860)], 80, 100),
    ("C2", "HUB-COM to DS-1 via quiet zone", [(12.9700, 77.5800), (12.9780, 77.5840), (12.9850, 77.5790)], 100, 120),
    ("C3", "HUB-MED to HUB-EMG via Hospital 2", [(12.9700, 77.5960), (12.9745, 77.6005), (12.9870, 77.5950)], 70, 90),
    ("C4", "HUB-MED to HOSP-1", [(12.9700, 77.5960), (12.9650, 77.5990), (12.9610, 77.6050)], 100, 120),
    ("C5", "HUB-MED to DS-1 via quiet zone", [(12.9700, 77.5960), (12.9770, 77.5820), (12.9850, 77.5790)], 120, 140),
    ("C6", "HUB-COM to HUB-MED spine", [(12.9700, 77.5800), (12.9700, 77.5960)], 120, 140),
    ("C7", "HUB-EMG to HOSP-1 via Hospital 2", [(12.9870, 77.5950), (12.9610, 77.6050)], 70, 90),
    ("C8", "DS-2 to HOSP-1 via school", [(12.9620, 77.5860), (12.9640, 77.5940), (12.9610, 77.6050)], 90, 110),
]

# Ordered by distance from the C3/C7 conflict point; asserted at load.
LANDING_ZONES: list[tuple[str, str, LL, str, int, int, str, float]] = [
    ("LZ-1", "Hospital 2 helipad", (12.9752, 77.6008), "HOSPITAL", 1, 0, "CONDITIONAL", 0.85),
    ("LZ-2", "Indiranagar skyport", (12.9715, 77.6020), "SKYPORT", 2, 2, "APPROVED", 0.88),
    ("LZ-3", "Ulsoor open ground", (12.9770, 77.5950), "OPEN_GROUND", 4, 1, "APPROVED", 0.91),
    ("LZ-4", "Hospital 1 helipad", (12.9605, 77.6055), "HOSPITAL", 1, 0, "APPROVED", 0.80),
    ("LZ-5", "Industrial yard west", (12.9660, 77.5820), "INDUSTRIAL", 6, 2, "APPROVED", 0.72),
    ("LZ-6", "Rooftop pad north", (12.9840, 77.5880), "BUILDING", 1, 0, "DENIED", 0.60),
]

FLOOD_ZONE_B_LL: list[LL] = [
    (12.9570, 77.6020), (12.9570, 77.6100), (12.9755, 77.6100), (12.9755, 77.5980), (12.9730, 77.5980), (12.9730, 77.6020),
]

FLOOD_ZONE_B: Polygon = Polygon([to_xy(*p) for p in FLOOD_ZONE_B_LL])
EMERGENCY_POLYGONS: dict[str, Polygon] = {"ZONE-B": FLOOD_ZONE_B}
C3_C7_CONFLICT: tuple[float, float] = (0.0, 0.0)
BBOX_M: tuple[float, float] = (0.0, 0.0)


def _xy_list(pts: list[LL]) -> list[tuple[float, float]]:
    return [to_xy(lat, lng) for lat, lng in pts]


def load(state: AppState) -> None:
    global C3_C7_CONFLICT, BBOX_M
    for zid, name, kind, ring, alt_min, alt_max, extra in ZONES:
        state.zones[zid] = Zone(id=zid, name=name, kind=kind, polygon=Polygon(_xy_list(ring)),
                                alt_min=alt_min, alt_max=alt_max, **extra)
    for hid, kind, ll, eng, cap in HUBS:
        x, y = to_xy(*ll)
        state.hubs[hid] = Hub(id=hid, kind=kind, x=x, y=y, engineer_id=eng, landing_capacity=cap)
    for did, name, kind, ll in DESTINATIONS:
        x, y = to_xy(*ll)
        state.destinations[did] = Destination(id=did, name=name, kind=kind, x=x, y=y)
    for cid, name, pts, alt_min, alt_max in CORRIDORS:
        state.corridors[cid] = Corridor(id=cid, name=name, polyline=_xy_list(pts), alt_min=alt_min, alt_max=alt_max)
    for lid, name, ll, typ, cap, occ, perm, score in LANDING_ZONES:
        x, y = to_xy(*ll)
        state.landing_zones[lid] = LandingZone(id=lid, name=name, x=x, y=y, type=typ, capacity=cap,
                                               occupied=occ, permission=perm, safety_score=score)
    C3_C7_CONFLICT = _assert_geometry(state)
    BBOX_M = _bbox(state)


def _crossing(state: AppState, a: str, b: str) -> tuple[float, float]:
    pa, pb = state.corridors[a].polyline, state.corridors[b].polyline
    hit = LineString(pa).intersection(LineString(pb))
    pts = list(hit.geoms) if hasattr(hit, "geoms") else [hit]
    ends = [pa[0], pa[-1], pb[0], pb[-1]]
    interior = [p for p in pts if p.geom_type == "Point" and all(dist((p.x, p.y), e) > 1.0 for e in ends)]
    if len(interior) != 1:
        raise RuntimeError(f"{a} and {b} must cross at exactly one interior point, got {len(interior)}")
    return (interior[0].x, interior[0].y)


def _assert_geometry(state: AppState) -> tuple[float, float]:
    c37 = _crossing(state, "C3", "C7")
    hosp2 = state.destinations["HOSP-2"]
    d_hosp = dist(c37, (hosp2.x, hosp2.y))
    if d_hosp > 300:
        raise RuntimeError(f"C3/C7 crossing is {d_hosp:.0f} m from Hospital 2, must be within 300 m")
    c25 = _crossing(state, "C2", "C5")
    if not state.zones["Z-QUIET-W"].polygon.contains(Point(c25)):
        raise RuntimeError("C2/C5 crossing must lie inside RESIDENTIAL_QUIET")
    ranked = sorted(state.landing_zones.values(), key=lambda lz: dist(c37, (lz.x, lz.y)))
    first, second, third = ranked[0], ranked[1], ranked[2]
    if first.permission != "CONDITIONAL":
        raise RuntimeError(f"nearest landing zone {first.id} must be CONDITIONAL")
    if second.occupied != second.capacity:
        raise RuntimeError(f"second landing zone {second.id} must be at capacity")
    if not (third.permission == "APPROVED" and third.occupied < third.capacity and third.safety_score == 0.91):
        raise RuntimeError(f"third landing zone {third.id} must be APPROVED with headroom and safety 0.91")
    flooded = [d.id for d in state.destinations.values() if d.kind == "HOSPITAL" and FLOOD_ZONE_B.contains(Point(d.x, d.y))]
    if len(flooded) != 2:
        raise RuntimeError(f"flood polygon must cover both hospitals, covers {flooded}")
    cut = [c.id for c in state.corridors.values() if LineString(c.polyline).intersects(FLOOD_ZONE_B)]
    lat, lng = to_ll(*c37)
    log.info("C3/C7 conflict at x=%.1f y=%.1f (lat %.5f lng %.5f), %.0f m from Hospital 2", c37[0], c37[1], lat, lng, d_hosp)
    log.info("C2/C5 conflict at x=%.1f y=%.1f inside %s", c25[0], c25[1], "Z-QUIET-W")
    log.info("landing rank from conflict: %s", [(lz.id, round(dist(c37, (lz.x, lz.y)))) for lz in ranked])
    log.info("flood Zone B covers %s, cuts corridors %s", flooded, cut)
    return c37


def _bbox(state: AppState) -> tuple[float, float]:
    xs: list[float] = []
    ys: list[float] = []
    for z in state.zones.values():
        bx = z.polygon.bounds
        xs += [bx[0], bx[2]]
        ys += [bx[1], bx[3]]
    for c in state.corridors.values():
        xs += [p[0] for p in c.polyline]
        ys += [p[1] for p in c.polyline]
    for pt in list(state.hubs.values()) + list(state.landing_zones.values()) + list(state.destinations.values()):
        xs.append(pt.x)
        ys.append(pt.y)
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    if w > 4500 or h > 4500:
        raise RuntimeError(f"city bbox {w:.0f} x {h:.0f} m exceeds 4.5 km")
    log.info("city bbox %.0f m E-W x %.0f m N-S", w, h)
    return (w, h)


def _ll(x: float, y: float) -> list[float]:
    lat, lng = to_ll(x, y)
    return [round(lat, 6), round(lng, 6)]


def serialize(state: AppState) -> dict:
    return {
        "origin": list(to_ll(0, 0)),
        "bbox_m": {"width": round(BBOX_M[0]), "height": round(BBOX_M[1])},
        "zones": [{**z.model_dump(exclude={"polygon"}), "polygon": [_ll(x, y) for x, y in z.polygon.exterior.coords[:-1]]}
                  for z in state.zones.values()],
        "corridors": [{**c.model_dump(exclude={"polyline"}), "polyline": [_ll(x, y) for x, y in c.polyline],
                       "length_m": round(polyline_length(c.polyline))} for c in state.corridors.values()],
        "hubs": [{**h.model_dump(exclude={"x", "y"}), "ll": _ll(h.x, h.y)} for h in state.hubs.values()],
        "destinations": [{**d.model_dump(exclude={"x", "y"}), "ll": _ll(d.x, d.y)} for d in state.destinations.values()],
        "landing_zones": [{**lz.model_dump(exclude={"x", "y"}), "ll": _ll(lz.x, lz.y)} for lz in state.landing_zones.values()],
        "emergency_polygons": {"ZONE-B": [_ll(x, y) for x, y in FLOOD_ZONE_B.exterior.coords[:-1]]},
        "conflict_points": {"C3xC7": _ll(*C3_C7_CONFLICT)},
    }
