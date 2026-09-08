import asyncio
import logging

from shapely.geometry import LineString, Point

from geo import bearing

import bus
import routing
from models import Action, Decision, Incident
from state import AppState

log = logging.getLogger("skyguard.supervisor")

MOCK_LATENCY_S = 0.9
R_WARN_M = 40.0
HOLD_SECONDS = 20.0
RANK = {"CRITICAL": 0, "HIGH": 1, "NORMAL": 2, "LOW": 3}

HARD_RULES = [
    "NO_FLY may never be entered",
    "battery reserve floor is 20%",
    "CRITICAL missions outrank NORMAL",
]


def _line(state: AppState, drone) -> LineString | Point:
    route = state.routes.get(drone.route_id or "")
    if route is None:
        return Point(drone.x, drone.y)
    return LineString([(x, y) for x, y, _ in route.waypoints])


def _risk_after(state: AppState, drone, new_route, other) -> int:
    """Re-run the analytic CPA with the drone turned onto the new route's first leg."""
    if other is None:
        return 0
    import safety_engine

    wp = new_route.waypoints
    if len(wp) < 2:
        return 0
    heading = bearing((wp[0][0], wp[0][1]), (wp[1][0], wp[1][1]))
    probe = drone.model_copy(update={"x": wp[0][0], "y": wp[0][1], "heading": heading,
                                     "alt": wp[0][2], "target_alt": wp[0][2]})
    conflict = safety_engine.predict_collision(probe, other)
    return int(conflict["risk_pct"]) if conflict else 0


def _hold_risk(state: AppState, yielder, other) -> int:
    """Honest number: re-run the analytic CPA with the yielding drone stopped."""
    if other is None:
        return 0
    import safety_engine

    stopped = yielder.model_copy(update={"speed": 0.0})
    conflict = safety_engine.predict_collision(stopped, other)
    return int(conflict["risk_pct"]) if conflict else 0


def _participants(state: AppState, incident: Incident):
    drones = [state.drones[i] for i in incident.drone_ids if i in state.drones]
    drones.sort(key=lambda d: (-RANK[d.priority], d.id))  # lowest priority yields
    return (drones[0], drones[1]) if len(drones) > 1 else (drones[0], None)


def _drone_facts(state: AppState, d) -> dict:
    mission = state.missions.get(d.mission_id or "")
    return {"id": d.id, "priority": d.priority, "battery_pct": round(d.battery, 1),
            "payload_kg": d.payload_kg, "mission": d.mission_id,
            "eta_s": round(mission.eta_s, 1) if mission and mission.eta_s else None,
            "altitude_m": round(d.alt, 1), "operator": d.operator_id}


def build_fact_packet(state: AppState, incident: Incident) -> dict:
    yielder, other = _participants(state, incident)
    current = state.routes.get(yielder.route_id or "")
    current_eval = routing.evaluate_route(state, yielder, current) if current else {}
    banned = frozenset(current.corridor_ids) if current else frozenset()

    alternatives: list[dict] = []
    for route in routing.find_alternative_routes(state, yielder, exclude_corridor_ids=banned):
        state.routes[route.id] = route
        ev = routing.evaluate_route(state, yielder, route)
        risk_after = _risk_after(state, yielder, route, other)
        sla = round(ev["eta_s"] - float(current_eval.get("eta_s", ev["eta_s"])), 1)
        battery = round(ev["battery_cost_pct"] - float(current_eval.get("battery_cost_pct", ev["battery_cost_pct"])), 2)
        quiet_before = float(current_eval.get("quiet_zone_seconds", 0.0))
        community = round(ev["quiet_zone_seconds"] - quiet_before, 1)
        violates = [f"enters {z}" for z in ev["zones_crossed"] if state.zones[z].kind == "NO_FLY"]
        alternatives.append({
            "action": {"kind": "REROUTE", "drone_id": yielder.id,
                       "params": {"route_id": route.id, "corridor_ids": route.corridor_ids,
                                  "risk_pct_after": risk_after, "sla_delta_s": sla,
                                  "battery_delta_pct": battery, "community_delta_pct": community,
                                  "length_m": ev["length_m"]}},
            "risk_pct_after": risk_after, "sla_delta_s": sla, "battery_delta_pct": battery,
            "community_delta_pct": community, "violates": violates,
            "corridor_ids": route.corridor_ids, "length_m": ev["length_m"],
        })

    hold_risk = _hold_risk(state, yielder, other)
    alternatives.append({
        "action": {"kind": "HOLD", "drone_id": yielder.id,
                   "params": {"seconds": HOLD_SECONDS, "risk_pct_after": hold_risk,
                              "sla_delta_s": HOLD_SECONDS, "battery_delta_pct": round(0.04 * HOLD_SECONDS, 2),
                              "community_delta_pct": 0.0}},
        "risk_pct_after": hold_risk, "sla_delta_s": HOLD_SECONDS,
        "battery_delta_pct": round(0.04 * HOLD_SECONDS, 2), "community_delta_pct": 0.0,
        "violates": [], "corridor_ids": [], "length_m": 0.0,
    })

    landing = []
    if yielder.battery < 35:
        landing = [{"id": lz.id, "name": lz.name, "permission": lz.permission,
                    "free": lz.capacity - lz.occupied, "safety_score": lz.safety_score}
                   for lz in state.landing_zones.values()]

    return {
        "incident": {"id": incident.id, "kind": incident.kind, "severity": incident.severity,
                     "risk_pct": incident.facts.get("risk_pct"), "t_cpa_s": incident.facts.get("t_cpa_s"),
                     "min_sep_m": incident.facts.get("min_sep_m"),
                     "vertical_sep_m": incident.facts.get("vertical_sep_m")},
        "drones": [_drone_facts(state, d) for d in (yielder, other) if d is not None],
        "yielding_drone": yielder.id,
        "alternatives": alternatives[:4],
        "landing_options": landing,
        "active_policies": list(state.policies),
        "hard_rules": HARD_RULES,
    }


def _rejection_line(ranked: list[dict], best: dict) -> str:
    others = len(ranked) - 1
    if others <= 0:
        return "No other legal alternative was available."
    if all(a["risk_pct_after"] == best["risk_pct_after"] for a in ranked):
        return f"Rejected {others} alternative(s) that also clear the conflict but cost more time or battery."
    return f"Rejected {others} alternative(s) with higher residual risk."


def mock_supervisor(facts: dict) -> Decision:
    legal = [a for a in facts["alternatives"] if not a["violates"]]
    ranked = sorted(legal or facts["alternatives"], key=lambda a: (a["risk_pct_after"], a["sla_delta_s"]))
    best = ranked[0]
    margin = (ranked[1]["risk_pct_after"] - best["risk_pct_after"]) if len(ranked) > 1 else 30
    confidence = round(min(0.98, max(0.55, 0.6 + margin / 100)), 2)

    inc = facts["incident"]
    who = facts["yielding_drone"]
    other = next((d["id"] for d in facts["drones"] if d["id"] != who), "the other aircraft")
    kind = best["action"]["kind"]
    where = "+".join(best["corridor_ids"]) or "a direct leg"
    reasoning = [
        f"{inc['kind'].title()} predicted between {who} and {other}: {inc['min_sep_m']} m at closest approach in {inc['t_cpa_s']} s, {inc['vertical_sep_m']} m vertical.",
        f"{who} carries the lower priority of the pair, so it yields under the rule that CRITICAL missions outrank NORMAL.",
        (f"Rerouting {who} via {where} drops predicted risk from {inc['risk_pct']}% to {best['risk_pct_after']}%."
         if kind == "REROUTE"
         else f"Holding {who} for {best['sla_delta_s']:.0f} s drops predicted risk from {inc['risk_pct']}% to {best['risk_pct_after']}%."),
        f"Cost of the change: {best['sla_delta_s']:+.0f} s on schedule, {best['battery_delta_pct']:+.2f}% battery, {best['community_delta_pct']:+.1f} s over the quiet zone.",
        _rejection_line(ranked, best),
    ]
    summary = (f"Reroute {who} via {where}" if kind == "REROUTE" else f"Hold {who} for {best['sla_delta_s']:.0f} s") + \
              f" — risk {inc['risk_pct']}% to {best['risk_pct_after']}%"

    return Decision(
        id=f"DEC-{inc['id']}", incident_id=inc["id"], severity=inc["severity"], summary=summary,
        recommended_action=Action(**best["action"]),
        alternatives=[Action(**a["action"]) for a in facts["alternatives"]],
        reasoning=reasoning, risk_before=float(inc["risk_pct"] or 0), risk_after=float(best["risk_pct_after"]),
        battery_delta_pct=best["battery_delta_pct"], sla_delta_s=best["sla_delta_s"],
        community_delta_pct=best["community_delta_pct"], confidence=confidence,
        requires_human_approval=inc["severity"] in {"CRITICAL", "HIGH"}, source="MOCK_AI",
    )


async def investigate(state: AppState, incident_id: str) -> None:
    incident = state.incidents.get(incident_id)
    if incident is None or incident.state != "DETECTED":
        return
    incident.state = "INVESTIGATING"
    bus.publish("incident.updated", {"incident": incident.model_dump(), "clock": round(state.sim_clock, 2)})

    facts = build_fact_packet(state, incident)
    bus.publish("decision.alternatives", {"incident_id": incident.id, "facts": facts,
                                          "count": len(facts["alternatives"]), "clock": round(state.sim_clock, 2)})
    await asyncio.sleep(MOCK_LATENCY_S)

    if state.incidents.get(incident_id) is not incident or incident.state != "INVESTIGATING":
        return
    decision = mock_supervisor(facts)
    state.decisions[decision.id] = decision
    incident.decision_id = decision.id
    incident.state = "AWAITING_APPROVAL"
    log.info("%s -> %s (confidence %.2f)", incident.id, decision.summary, decision.confidence)
    bus.publish("decision.ready", {"decision": decision.model_dump(), "facts": facts,
                                   "incident": incident.model_dump(), "clock": round(state.sim_clock, 2)})


def dispatch(state: AppState, incident: Incident) -> None:
    """Fire-and-forget. The tick loop must never await the supervisor."""
    if incident.kind != "COLLISION" or incident.severity == "INFO":
        return
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return
    asyncio.create_task(investigate(state, incident.id))
