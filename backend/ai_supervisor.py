import asyncio
import json
import logging
import os

from shapely.geometry import LineString, Point

from geo import bearing

import bus
import routing
from models import Action, Decision, Incident
from state import AppState

log = logging.getLogger("skyguard.supervisor")

MOCK_LATENCY_S = 0.9
LIVE_TIMEOUT_S = 8.0
MODEL = os.environ.get("SKYGUARD_MODEL", "claude-sonnet-4-6")
VERTICAL_OFFSETS = (25.0, 30.0, 35.0, 40.0)
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


def _alt_bounds(state: AppState, drone, route) -> tuple[float, float]:
    """Operating envelope tightened by every zone the drone is currently inside."""
    low, high = 40.0, 150.0
    for zone in state.zones.values():
        if zone.polygon.contains(Point(drone.x, drone.y)):
            low, high = max(low, zone.alt_min), min(high, zone.alt_max)
    return low, high


def _altitude_options(state: AppState, yielder, other, route) -> list[dict]:
    """A 25-40 m vertical offset that clears the conflict without breaching the band."""
    if other is None:
        return []
    import safety_engine

    low, high = _alt_bounds(state, yielder, route)
    for offset in VERTICAL_OFFSETS:
        for target in (yielder.alt - offset, yielder.alt + offset):
            if target < low or target > high:
                continue
            probe = yielder.model_copy(update={"alt": target, "target_alt": target})
            if safety_engine.predict_collision(probe, other) is not None:
                continue
            climb_s = round(offset / safety_engine.CLIMB_RATE, 1)
            direction = "descend" if target < yielder.alt else "climb"
            return [{
                "action": {"kind": "ALTITUDE_CHANGE", "drone_id": yielder.id,
                           "params": {"target_alt": target, "offset_m": offset, "direction": direction,
                                      "risk_pct_after": 0, "sla_delta_s": 0.0,
                                      "battery_delta_pct": round(0.25 * climb_s, 2),
                                      "community_delta_pct": 0.0}},
                "risk_pct_after": 0, "sla_delta_s": 0.0,
                "battery_delta_pct": round(0.25 * climb_s, 2), "community_delta_pct": 0.0,
                "violates": [], "corridor_ids": [], "length_m": 0.0,
            }]
    return []


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


def _divert_packet(state: AppState, incident: Incident) -> dict:
    import emergency

    drone = state.drones[incident.drone_ids[0]]
    selection = emergency.select_landing_zone(state, drone)
    alternatives = []
    for pad in selection["ranked"][:3]:
        alternatives.append({
            "action": {"kind": "DIVERT_LAND", "drone_id": drone.id,
                       "params": {"landing_zone_id": pad["id"], "landing_zone_name": pad["name"],
                                  "score": pad["score"], "distance_m": pad["distance_m"],
                                  "safety_score": pad["safety_score"], "risk_pct_after": 0,
                                  "sla_delta_s": round(pad["distance_m"] / max(drone.speed, 1.0), 1),
                                  "battery_delta_pct": round(0.055 * pad["distance_m"] / max(drone.speed, 1.0), 2),
                                  "community_delta_pct": 0.0}},
            "risk_pct_after": 0, "sla_delta_s": round(pad["distance_m"] / max(drone.speed, 1.0), 1),
            "battery_delta_pct": round(0.055 * pad["distance_m"] / max(drone.speed, 1.0), 2),
            "community_delta_pct": 0.0, "violates": [], "corridor_ids": [], "length_m": pad["distance_m"],
            "landing_zone": pad,
        })
    return {
        "incident": {"id": incident.id, "kind": incident.kind, "severity": incident.severity,
                     "risk_pct": 90, "t_cpa_s": None, "min_sep_m": None, "vertical_sep_m": None,
                     "part": incident.facts.get("part"), "value": incident.facts.get("value")},
        "drones": [_drone_facts(state, drone)],
        "yielding_drone": drone.id,
        "alternatives": alternatives,
        "landing_options": selection,
        "active_policies": list(state.policies),
        "hard_rules": HARD_RULES,
    }


def build_fact_packet(state: AppState, incident: Incident) -> dict:
    if incident.kind == "HEALTH_DEGRADED":
        return _divert_packet(state, incident)
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
        "alternatives": (_altitude_options(state, yielder, other, current) + alternatives[:2] + alternatives[-1:])[:4],
        "landing_options": landing,
        "active_policies": list(state.policies),
        "hard_rules": HARD_RULES,
    }


def _action_line(kind: str, who: str, where: str, params: dict, inc: dict, best: dict) -> str:
    drop = f"drops predicted risk from {inc['risk_pct']}% to {best['risk_pct_after']}%"
    if kind == "DIVERT_LAND":
        return (f"{params['landing_zone_name']} scores {params['score']:.2f}: {params['distance_m']} m away, "
                f"safety {params['safety_score']}, and it is the highest-scoring pad that clears every hard filter.")
    if kind == "REROUTE":
        return f"Rerouting {who} via {where} {drop}."
    if kind == "ALTITUDE_CHANGE":
        return (f"A {params['offset_m']:.0f} m {params['direction']} to {params['target_alt']:.0f} m "
                f"separates the pair vertically and {drop}, staying inside the permitted altitude band.")
    return f"Holding {who} for {best['sla_delta_s']:.0f} s {drop}."


def _summary(kind: str, who: str, where: str, params: dict, best: dict) -> str:
    if kind == "DIVERT_LAND":
        return f"Divert {who} to {params['landing_zone_name']}"
    if kind == "REROUTE":
        return f"Reroute {who} via {where}"
    if kind == "ALTITUDE_CHANGE":
        return f"{params['direction'].title()} {who} {params['offset_m']:.0f} m to {params['target_alt']:.0f} m"
    return f"Hold {who} for {best['sla_delta_s']:.0f} s"


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
    params = best["action"]["params"]
    if kind == "DIVERT_LAND":
        opts = facts["landing_options"]
        reasoning = [
            f"{who} reports {inc.get('part')} at {float(inc.get('value') or 0):.0%}; the airframe cannot complete its mission.",
            f"Battery {opts['battery_pct']}% gives {opts['max_reachable_m']} m of reachable range above the 20% reserve floor.",
            f"{len(opts['rejected'])} candidate(s) failed the hard filters: "
            + "; ".join(f"{r['id']} {r['reason']}" for r in opts["rejected"]) + ".",
            _action_line(kind, who, where, params, inc, best),
        ]
    else:
        reasoning = [
        f"{inc['kind'].title()} predicted between {who} and {other}: {inc['min_sep_m']} m at closest approach in {inc['t_cpa_s']} s, {inc['vertical_sep_m']} m vertical.",
        f"{who} carries the lower priority of the pair, so it yields under the rule that CRITICAL missions outrank NORMAL.",
        _action_line(kind, who, where, params, inc, best),
        f"Cost of the change: {best['sla_delta_s']:+.0f} s on schedule, {best['battery_delta_pct']:+.2f}% battery, {best['community_delta_pct']:+.1f} s over the quiet zone.",
        _rejection_line(ranked, best),
        ]
    summary = _summary(kind, who, where, params, best) + f" — risk {inc['risk_pct']}% to {best['risk_pct_after']}%"

    return Decision(
        id=f"DEC-{inc['id']}", incident_id=inc["id"], severity=inc["severity"], summary=summary,
        recommended_action=Action(**best["action"]),
        alternatives=[Action(**a["action"]) for a in facts["alternatives"]],
        reasoning=reasoning, risk_before=float(inc["risk_pct"] or 0), risk_after=float(best["risk_pct_after"]),
        battery_delta_pct=best["battery_delta_pct"], sla_delta_s=best["sla_delta_s"],
        community_delta_pct=best["community_delta_pct"], confidence=confidence,
        requires_human_approval=inc["severity"] in {"CRITICAL", "HIGH"}, source="MOCK_AI",
    )


SYSTEM_PROMPT = """You are the SKYGUARD airspace supervisor for an autonomous drone fleet over Bengaluru.

A deterministic safety engine has already detected the conflict, computed all geometry, and
pre-evaluated every legal option. Your job is judgement, not arithmetic.

Rules you must follow:
- Choose exactly one option from the `alternatives` array by its index. You may not invent an
  action, alter its parameters, or suggest anything outside that array.
- Never compute or re-derive geometry, separation, risk or battery figures. Quote the numbers
  you are given.
- Weigh residual risk first, then schedule cost, then battery, then community noise impact.
- Hard rules, which override every other consideration:
  NO_FLY may never be entered
  battery reserve floor is 20%
  CRITICAL missions outrank NORMAL

Explain the trade-off in 3 to 5 short sentences an air traffic operator would accept, citing
the real figures from the fact packet."""

DECISION_TOOL = {
    "name": "submit_decision",
    "description": "Record the chosen resolution for this airspace conflict.",
    "input_schema": {
        "type": "object",
        "properties": {
            "chosen_alternative_index": {"type": "integer", "description": "Zero-based index into the alternatives array."},
            "summary": {"type": "string", "description": "One line an operator reads first."},
            "reasoning": {"type": "array", "items": {"type": "string"}, "description": "3 to 5 sentences citing the given figures."},
            "confidence": {"type": "number", "description": "0 to 1."},
        },
        "required": ["chosen_alternative_index", "summary", "reasoning", "confidence"],
        "additionalProperties": False,
    },
    "strict": True,
}


async def live_supervisor(facts: dict) -> Decision:
    """One structured call. Raises on any failure so the caller can fall back to the mock."""
    import anthropic

    client = anthropic.AsyncAnthropic(max_retries=0, timeout=LIVE_TIMEOUT_S)
    response = await asyncio.wait_for(
        client.messages.create(
            model=MODEL,
            max_tokens=1000,
            # temperature was removed from the Messages API in this SDK generation; the
            # closed tool schema plus server-side index validation carry determinism instead
            system=SYSTEM_PROMPT,
            tools=[DECISION_TOOL],
            tool_choice={"type": "tool", "name": "submit_decision"},
            messages=[{"role": "user", "content": json.dumps(facts, separators=(",", ":"))}],
        ),
        timeout=LIVE_TIMEOUT_S,
    )
    block = next(b for b in response.content if b.type == "tool_use" and b.name == "submit_decision")
    out = block.input

    alternatives = facts["alternatives"]
    index = out.get("chosen_alternative_index")
    if not isinstance(index, int) or not 0 <= index < len(alternatives):
        log.warning("live supervisor returned index %r outside 0..%d; using lowest risk",
                    index, len(alternatives) - 1)
        index = min(range(len(alternatives)), key=lambda i: (alternatives[i]["risk_pct_after"], alternatives[i]["sla_delta_s"]))
    best = alternatives[index]
    if best["violates"]:
        log.warning("live supervisor chose an option violating %s; using lowest risk", best["violates"])
        legal = [a for a in alternatives if not a["violates"]]
        best = min(legal or alternatives, key=lambda a: (a["risk_pct_after"], a["sla_delta_s"]))

    inc = facts["incident"]
    reasoning = [str(r) for r in out.get("reasoning", [])][:6] or ["No reasoning returned."]
    return Decision(
        id=f"DEC-{inc['id']}", incident_id=inc["id"], severity=inc["severity"],
        summary=str(out.get("summary") or "Resolution selected"),
        recommended_action=Action(**best["action"]),
        alternatives=[Action(**a["action"]) for a in alternatives],
        reasoning=reasoning, risk_before=float(inc["risk_pct"] or 0), risk_after=float(best["risk_pct_after"]),
        battery_delta_pct=best["battery_delta_pct"], sla_delta_s=best["sla_delta_s"],
        community_delta_pct=best["community_delta_pct"],
        confidence=round(min(0.99, max(0.0, float(out.get("confidence", 0.7)))), 2),
        requires_human_approval=inc["severity"] in {"CRITICAL", "HIGH"}, source="LIVE_AI",
    )


async def decide(facts: dict) -> Decision:
    """Live Claude when configured, mock otherwise. Any failure falls back silently."""
    if os.environ.get("USE_LIVE_AI", "false").lower() not in {"1", "true", "yes"}:
        await asyncio.sleep(MOCK_LATENCY_S)
        return mock_supervisor(facts)
    try:
        return await live_supervisor(facts)
    except Exception as exc:  # noqa: BLE001 - the demo must never stall on the network
        log.warning("live supervisor unavailable (%s: %s); falling back to MOCK_AI",
                    type(exc).__name__, str(exc)[:160])
        return mock_supervisor(facts)


async def investigate(state: AppState, incident_id: str) -> None:
    incident = state.incidents.get(incident_id)
    if incident is None or incident.state != "DETECTED":
        return
    incident.state = "INVESTIGATING"
    bus.publish("incident.updated", {"incident": incident.model_dump(), "clock": round(state.sim_clock, 2)})

    facts = build_fact_packet(state, incident)
    bus.publish("decision.alternatives", {"incident_id": incident.id, "facts": facts,
                                          "count": len(facts["alternatives"]), "clock": round(state.sim_clock, 2)})
    decision = await decide(facts)

    if state.incidents.get(incident_id) is not incident or incident.state != "INVESTIGATING":
        return
    state.decisions[decision.id] = decision
    incident.decision_id = decision.id
    incident.state = "AWAITING_APPROVAL"
    log.info("%s -> %s (confidence %.2f)", incident.id, decision.summary, decision.confidence)
    bus.publish("decision.ready", {"decision": decision.model_dump(), "facts": facts,
                                   "incident": incident.model_dump(), "clock": round(state.sim_clock, 2)})


def dispatch(state: AppState, incident: Incident) -> None:
    """Fire-and-forget. The tick loop must never await the supervisor."""
    if not state.ai_enabled or incident.kind not in {"COLLISION", "HEALTH_DEGRADED"} or incident.severity == "INFO":
        return
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return
    asyncio.create_task(investigate(state, incident.id))
