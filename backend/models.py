from typing import Literal

from pydantic import BaseModel, ConfigDict
from shapely.geometry import Polygon

DroneStatus = Literal["IDLE", "CHARGING", "MAINTENANCE", "ENROUTE", "HOLDING", "DIVERTING", "LANDING", "LANDED", "LOST"]
Priority = Literal["CRITICAL", "HIGH", "NORMAL", "LOW"]
MissionType = Literal["DELIVERY", "RESCUE"]
ZoneKind = Literal["SCHOOL", "HOSPITAL", "RESIDENTIAL_QUIET", "NO_FLY", "TEMP_RESTRICTED", "EMERGENCY"]
HubKind = Literal["COMMERCIAL", "MEDICAL", "EMERGENCY"]
LandingType = Literal["HOSPITAL", "SKYPORT", "OPEN_GROUND", "INDUSTRIAL", "BUILDING"]
Permission = Literal["APPROVED", "CONDITIONAL", "DENIED"]
Severity = Literal["INFO", "WARNING", "CRITICAL"]
IncidentState = Literal["DETECTED", "INVESTIGATING", "AWAITING_APPROVAL", "EXECUTED", "REJECTED", "RESOLVED"]
DecisionSource = Literal["LIVE_AI", "MOCK_AI"]
ActionKind = Literal["REROUTE", "HOLD", "ALTITUDE_CHANGE", "DIVERT_LAND", "ABORT", "REPLACE_DRONE", "PAUSE_PRIORITY_BAND"]


class Drone(BaseModel):
    id: str
    operator_id: str
    x: float
    y: float
    alt: float
    speed: float
    heading: float
    battery: float
    noise_db: float
    payload_kg: float
    package_id: str | None = None
    mission_id: str | None = None
    priority: Priority = "NORMAL"
    status: DroneStatus = "IDLE"
    route_id: str | None = None
    route_progress_m: float = 0.0
    target_alt: float = 0.0
    previous_route_id: str | None = None
    health: dict[str, float] = {}
    home_hub_id: str


class Route(BaseModel):
    id: str
    waypoints: list[tuple[float, float, float]]
    corridor_ids: list[str] = []
    total_length_m: float
    created_by: str


class Mission(BaseModel):
    id: str
    type: MissionType
    priority: Priority
    payload_kind: str
    origin_hub_id: str
    dest_id: str
    drone_id: str | None = None
    state: str
    created_at: float
    eta_s: float | None = None


class Zone(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    id: str
    name: str
    kind: ZoneKind
    polygon: Polygon
    alt_min: float
    alt_max: float
    allowed_operators: list[str] = []
    allowed_priorities: list[Priority] = []
    active_hours: tuple[str, str] | None = None
    noise_limit_db: float | None = None
    is_closed: bool = False


class Hub(BaseModel):
    id: str
    kind: HubKind
    x: float
    y: float
    engineer_id: str
    landing_capacity: int
    drone_ids: list[str] = []


class LandingZone(BaseModel):
    id: str
    name: str
    x: float
    y: float
    type: LandingType
    capacity: int
    occupied: int
    permission: Permission
    safety_score: float


class Action(BaseModel):
    kind: ActionKind
    drone_id: str | None = None
    params: dict = {}


class Incident(BaseModel):
    id: str
    kind: str
    severity: Severity
    drone_ids: list[str]
    facts: dict = {}
    state: IncidentState = "DETECTED"
    decision_id: str | None = None
    created_at: float


class Decision(BaseModel):
    id: str
    incident_id: str
    summary: str
    recommended_action: Action
    alternatives: list[Action]
    reasoning: list[str]
    risk_before: float
    risk_after: float
    battery_delta_pct: float
    sla_delta_s: float
    community_delta_pct: float
    confidence: float
    requires_human_approval: bool = True
    source: DecisionSource


# Not in BUILD-PLAN §3, but step 1 requires corridors and destinations as fixture entities.
class Corridor(BaseModel):
    id: str
    name: str
    polyline: list[tuple[float, float]]
    alt_min: float
    alt_max: float


class Destination(BaseModel):
    id: str
    name: str
    kind: Literal["HOSPITAL", "DARK_STORE"]
    x: float
    y: float
