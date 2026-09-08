import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import actions
import audit
import bus
import city
import emergency
import missions
import roles
import safety_engine
import scenarios
import simulator
import weather
from state import state

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("skyguard.main")

TICK_DT = 0.1
TICKS_PER_BROADCAST = 5


def hello(viewer: roles.Viewer | None = None) -> dict:
    v = viewer or roles.Viewer()
    drone_ids = roles.visible_drone_ids(state, v)
    mission_ids = roles.visible_mission_ids(state, v)
    drones = [d for d in state.drones.values() if d.id in drone_ids]
    route_ids = {d.route_id for d in drones if d.route_id} | {d.previous_route_id for d in drones if d.previous_route_id}
    body = city.serialize(state)
    body["hubs"] = [{**h.model_dump(exclude={"x", "y"}), "ll": list(city.to_ll(h.x, h.y))} for h in roles.visible_hubs(state, v)]
    return {
        "t": "hello",
        "rev": state.revision,
        "clock": state.sim_clock,
        "role": v.role,
        "capabilities": sorted(v.can),
        "weather": state.weather,
        "city": body,
        "drones": [simulator.drone_full(d) for d in drones],
        "routes": [simulator.route_full(r) for r in state.routes.values() if r.id in route_ids],
        "missions": [m.model_dump() for m in state.missions.values() if m.id in mission_ids],
        "incidents": [i.model_dump() for i in roles.visible_incidents(state, v)],
        "decisions": [d.model_dump() for d in state.decisions.values()],
        "audit": audit.query(state, 50),
        "scenarios": scenarios.NAMES,
        "ai_enabled": state.ai_enabled,
        "paused": state.paused,
        "emergency": state.emergency,
        "disaster_kinds": list(emergency.KINDS),
        "rescue_payloads": sorted(emergency.RESCUE_PAYLOADS),
        "live_ai": os.environ.get("USE_LIVE_AI", "false").lower() in {"1", "true", "yes"},
    }


ACTIVE_MISSION_STATES = {"ENROUTE", "ARRIVING", "DELIVERED", "RETURNING"}


def tick_message(viewer: roles.Viewer | None = None) -> dict:
    v = viewer or roles.Viewer()
    drone_ids = roles.visible_drone_ids(state, v)
    mission_ids = roles.visible_mission_ids(state, v)
    rows = [[m.id, m.state, m.eta_s] for m in state.missions.values()
            if m.state in ACTIVE_MISSION_STATES and m.id in mission_ids]
    return {"t": "tick", "clock": round(state.sim_clock, 2),
            "d": [r for r in simulator.telemetry_rows(state) if r[0] in drone_ids], "m": rows}


async def tick_loop() -> None:
    n = 0
    while True:
        await asyncio.sleep(TICK_DT)
        if not state.paused:
            simulator.tick(state, TICK_DT)
            missions.advance(state)
        if n % TICKS_PER_BROADCAST == 4:
            safety_engine.run_checks(state)
        n += 1
        if n % TICKS_PER_BROADCAST == 0:
            bus.broadcast_per(tick_message)


@asynccontextmanager
async def lifespan(_: FastAPI):
    state.reset()
    task = asyncio.create_task(tick_loop())
    wx = asyncio.create_task(weather.poll(state))
    yield
    task.cancel()
    wx.cancel()


app = FastAPI(title="SKYGUARD", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/api/city")
def get_city(role: str | None = None, operator_id: str | None = None, hub_id: str | None = None,
             mission_id: str | None = None) -> dict:
    v = roles.parse(role, operator_id, hub_id, mission_id)
    body = city.serialize(state)
    body["hubs"] = [{**h.model_dump(exclude={"x", "y"}), "ll": list(city.to_ll(h.x, h.y))} for h in roles.visible_hubs(state, v)]
    return body


@app.get("/api/state")
def get_state(role: str | None = None, operator_id: str | None = None, hub_id: str | None = None,
              mission_id: str | None = None) -> dict:
    """Role-filtered snapshot; the network tab shows exactly what each role may see."""
    return hello(roles.parse(role, operator_id, hub_id, mission_id))


@app.get("/api/weather")
def get_weather() -> dict:
    return state.weather


class MissionRequest(BaseModel):
    type: str = "DELIVERY"
    payload_kind: str
    priority: str = "NORMAL"
    origin_hub_id: str
    dest_id: str


@app.post("/api/missions")
async def post_mission(req: MissionRequest) -> dict:
    mission, error = missions.create_mission(state, req.type, req.payload_kind, req.priority, req.origin_hub_id, req.dest_id)
    if error is not None or mission is None:
        raise HTTPException(status_code=400, detail=error or "mission could not be created")
    return mission.model_dump()


class EmergencyRequest(BaseModel):
    kind: str = "FLOOD"
    zone_id: str = "ZONE-B"


class RescueRequest(BaseModel):
    zone_id: str = "ZONE-B"
    payloads: list[str] = ["MEDICINE", "WATER", "FOOD", "EQUIPMENT"]


def _require(role: str | None, capability: str) -> None:
    viewer = roles.parse(role, None, None, None)
    if capability not in viewer.can:
        raise HTTPException(status_code=403, detail=f"{viewer.role} may not {capability}")


@app.post("/api/emergency/activate")
async def activate_emergency(req: EmergencyRequest, role: str | None = None) -> dict:
    _require(role, "emergency")
    result, error = emergency.activate(state, req.kind, req.zone_id)
    if error is not None or result is None:
        raise HTTPException(status_code=400, detail=error or "could not activate")
    return result


@app.post("/api/emergency/deactivate")
async def deactivate_emergency(role: str | None = None) -> dict:
    _require(role, "emergency")
    result, error = emergency.deactivate(state)
    if error is not None:
        raise HTTPException(status_code=400, detail=error)
    return result


@app.post("/api/missions/{mission_id}/dispatch-replacement")
async def dispatch_replacement(mission_id: str) -> dict:
    result, error = emergency.dispatch_replacement(state, mission_id)
    if error is not None or result is None:
        raise HTTPException(status_code=400, detail=error or "could not dispatch a replacement")
    return result


@app.post("/api/missions/rescue")
async def post_rescue(req: RescueRequest) -> dict:
    result, error = emergency.create_rescue(state, req.zone_id, req.payloads)
    if error is not None or result is None:
        raise HTTPException(status_code=400, detail=error or "could not dispatch rescue")
    return result


class PauseRequest(BaseModel):
    paused: bool


@app.post("/api/pause")
async def set_pause(req: PauseRequest) -> dict:
    state.paused = req.paused
    bus.publish("sim.paused", {"paused": state.paused, "clock": round(state.sim_clock, 2)})
    return {"paused": state.paused}


class AiToggle(BaseModel):
    enabled: bool


@app.post("/api/ai")
async def set_ai(req: AiToggle) -> dict:
    state.ai_enabled = req.enabled
    bus.publish("ai.changed", {"enabled": state.ai_enabled, "clock": round(state.sim_clock, 2)})
    return {"ai_enabled": state.ai_enabled}


class ApprovalRequest(BaseModel):
    actor: str = "operator"
    alternative_index: int | None = None  # defaults to the recommended action


@app.get("/api/audit")
def get_audit(limit: int = 200) -> dict:
    return {"events": audit.query(state, limit)}


@app.post("/api/decisions/{decision_id}/approve")
async def approve_decision(decision_id: str, req: ApprovalRequest, role: str | None = None) -> dict:
    _require(role, "approve")
    decision = state.decisions.get(decision_id)
    if decision is None:
        raise HTTPException(status_code=404, detail=f"unknown decision {decision_id}")
    incident = state.incidents.get(decision.incident_id)
    if incident is None or incident.state != "AWAITING_APPROVAL":
        raise HTTPException(status_code=409, detail="decision is no longer awaiting approval")

    chosen = decision.recommended_action
    if req.alternative_index is not None:
        if not 0 <= req.alternative_index < len(decision.alternatives):
            raise HTTPException(status_code=400, detail=f"no alternative at index {req.alternative_index}")
        chosen = decision.alternatives[req.alternative_index]
    bus.publish("decision.approved", {"decision_id": decision_id, "incident_id": incident.id,
                                      "actor": req.actor, "action": chosen.model_dump(),
                                      "clock": round(state.sim_clock, 2)})
    result = actions.apply_action(state, chosen, req.actor, incident.id)
    if not result["ok"]:
        bus.publish("decision.rejected", {"decision_id": decision_id, "incident_id": incident.id,
                                          "actor": "safety", "reason": result["reason"],
                                          "clock": round(state.sim_clock, 2)})
        raise HTTPException(status_code=400, detail=result["reason"])
    # collision incidents stay EXECUTING until the safety engine verifies the separation
    if incident.state != "EXECUTING":
        incident.state = "EXECUTED"
    bus.publish("incident.updated", {"incident": incident.model_dump(), "clock": round(state.sim_clock, 2)})
    return result


@app.post("/api/decisions/{decision_id}/reject")
async def reject_decision(decision_id: str, req: ApprovalRequest) -> dict:
    decision = state.decisions.get(decision_id)
    if decision is None:
        raise HTTPException(status_code=404, detail=f"unknown decision {decision_id}")
    incident = state.incidents.get(decision.incident_id)
    if incident is not None:
        incident.state = "REJECTED"
        bus.publish("incident.updated", {"incident": incident.model_dump(), "clock": round(state.sim_clock, 2)})
    audit.append(state, req.actor, "DECISION_REJECTED", {"decision_id": decision_id}, {}, decision.summary)
    bus.publish("decision.rejected", {"decision_id": decision_id, "incident_id": decision.incident_id,
                                      "actor": req.actor, "reason": "rejected by operator",
                                      "clock": round(state.sim_clock, 2)})
    return {"ok": True, "detail": "decision rejected"}


@app.post("/api/scenario/{name}")
async def post_scenario(name: str, role: str | None = None) -> dict:
    _require(role, "scenarios")
    detail, error = scenarios.run(state, name)
    if error is not None:
        raise HTTPException(status_code=400, detail=error)
    return {"name": name, "detail": detail}


@app.post("/api/reset")
async def reset() -> dict:
    # nothing may await here: the tick loop keeps running and reset must be byte-identical
    state.reset()
    bus.broadcast_per(hello)
    return hello()


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket, role: str | None = None, operator_id: str | None = None,
                      hub_id: str | None = None, mission_id: str | None = None) -> None:
    await ws.accept()
    viewer = roles.parse(role, operator_id, hub_id, mission_id)
    bus.connections[ws] = viewer
    await ws.send_json(hello(viewer))
    try:
        while True:
            await ws.receive_text()  # server-to-client only; inbound frames are ignored
    except WebSocketDisconnect:
        pass
    finally:
        bus.connections.pop(ws, None)
