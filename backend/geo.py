from math import atan2, cos, degrees, hypot, radians, sqrt

ORIGIN = (12.9716, 77.5946)
ORIGIN_LAT, ORIGIN_LNG = ORIGIN
M_PER_DEG_LAT = 110900.0
M_PER_DEG_LNG = 110900.0 * cos(radians(ORIGIN_LAT))

Point = tuple[float, float]
Polyline = list[Point]


def to_xy(lat: float, lng: float) -> Point:
    return ((lng - ORIGIN_LNG) * M_PER_DEG_LNG, (lat - ORIGIN_LAT) * M_PER_DEG_LAT)


def to_ll(x: float, y: float) -> tuple[float, float]:
    return (ORIGIN_LAT + y / M_PER_DEG_LAT, ORIGIN_LNG + x / M_PER_DEG_LNG)


def dist(a: Point, b: Point) -> float:
    return hypot(b[0] - a[0], b[1] - a[1])


def bearing(a: Point, b: Point) -> float:
    # compass bearing: 0 = north (+y), 90 = east (+x)
    return degrees(atan2(b[0] - a[0], b[1] - a[1])) % 360.0


def polyline_length(polyline: Polyline) -> float:
    return sum(dist(polyline[i], polyline[i + 1]) for i in range(len(polyline) - 1))


def point_along(polyline: Polyline, dist_m: float) -> Point:
    if dist_m <= 0:
        return polyline[0]
    remaining = dist_m
    for i in range(len(polyline) - 1):
        a, b = polyline[i], polyline[i + 1]
        seg = dist(a, b)
        if remaining <= seg:
            t = remaining / seg if seg > 0 else 0.0
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        remaining -= seg
    return polyline[-1]


def nearest_point_on_polyline(pt: Point, polyline: Polyline) -> tuple[Point, float, float]:
    best: tuple[Point, float, float] | None = None
    cum = 0.0
    for i in range(len(polyline) - 1):
        a, b = polyline[i], polyline[i + 1]
        dx, dy = b[0] - a[0], b[1] - a[1]
        seg_sq = dx * dx + dy * dy
        t = 0.0 if seg_sq == 0 else max(0.0, min(1.0, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / seg_sq))
        p = (a[0] + dx * t, a[1] + dy * t)
        perp = dist(pt, p)
        if best is None or perp < best[2]:
            best = (p, cum + sqrt(seg_sq) * t, perp)
        cum += sqrt(seg_sq)
    if best is None:
        raise ValueError("polyline needs at least two points")
    return best
