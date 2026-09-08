from dataclasses import dataclass

from state import AppState

ROLES = ("GOVERNMENT", "OPERATOR", "HUB_ENGINEER", "CUSTOMER")

# what each role is allowed to do, enforced server-side
CAPABILITIES = {
    "GOVERNMENT": {"emergency", "approve", "zones", "scenarios", "fleet", "incidents"},
    "OPERATOR": {"approve", "fleet", "incidents"},
    "HUB_ENGINEER": {"fleet", "incidents"},
    "CUSTOMER": set(),
}


@dataclass(frozen=True)
class Viewer:
    role: str = "GOVERNMENT"
    operator_id: str | None = None
    hub_id: str | None = None
    mission_id: str | None = None

    @property
    def can(self) -> set[str]:
        return CAPABILITIES.get(self.role, set())


def parse(role: str | None, operator_id: str | None, hub_id: str | None, mission_id: str | None) -> Viewer:
    normalised = (role or "GOVERNMENT").upper()
    return Viewer(normalised if normalised in ROLES else "GOVERNMENT", operator_id, hub_id, mission_id)


def visible_mission_ids(state: AppState, viewer: Viewer) -> set[str]:
    if viewer.role == "GOVERNMENT":
        return set(state.missions)
    if viewer.role == "OPERATOR":
        return {m.id for m in state.missions.values()
                if m.drone_id and state.drones[m.drone_id].operator_id == viewer.operator_id}
    if viewer.role == "HUB_ENGINEER":
        return {m.id for m in state.missions.values() if m.origin_hub_id == viewer.hub_id}
    latest = viewer.mission_id or (next(reversed(state.missions), None) if state.missions else None)
    return {latest} if latest in state.missions else set()


def visible_drone_ids(state: AppState, viewer: Viewer) -> set[str]:
    if viewer.role == "GOVERNMENT":
        return set(state.drones)
    if viewer.role == "OPERATOR":
        return {d.id for d in state.drones.values() if d.operator_id == viewer.operator_id}
    if viewer.role == "HUB_ENGINEER":
        return {d.id for d in state.drones.values() if d.home_hub_id == viewer.hub_id}
    missions = visible_mission_ids(state, viewer)
    return {m.drone_id for m in state.missions.values() if m.id in missions and m.drone_id}


def visible_incidents(state: AppState, viewer: Viewer) -> list:
    if viewer.role == "GOVERNMENT":
        return list(state.incidents.values())
    if viewer.role == "CUSTOMER":
        return []
    drones = visible_drone_ids(state, viewer)
    incidents = [i for i in state.incidents.values() if drones.intersection(i.drone_ids)]
    if viewer.role == "HUB_ENGINEER":
        # the engineer's brief is airframe health and landing, not traffic deconfliction
        incidents = [i for i in incidents if i.kind in {"HEALTH_DEGRADED", "BATTERY_RESERVE"}]
    return incidents


def visible_hubs(state: AppState, viewer: Viewer) -> list:
    if viewer.role == "HUB_ENGINEER":
        return [h for h in state.hubs.values() if h.id == viewer.hub_id]
    if viewer.role == "CUSTOMER":
        return [h for h in state.hubs.values()
                if h.id in {state.missions[m].origin_hub_id for m in visible_mission_ids(state, viewer)}]
    return list(state.hubs.values())
