import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import bus
import city
import missions
import simulator
from state import state

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("skyguard.main")

TICK_DT = 0.1
TICKS_PER_BROADCAST = 5


def hello() -> dict:
    return {
        "t": "hello",
        "rev": state.revision,
        "clock": state.sim_clock,
        "city": city.serialize(state),
        "drones": [simulator.drone_full(d) for d in state.drones.values()],
        "routes": [simulator.route_full(r) for r in state.routes.values()],
        "missions": [m.model_dump() for m in state.missions.values()],
        "incidents": [i.model_dump() for i in state.incidents.values()],
    }


ACTIVE_MISSION_STATES = {"ENROUTE", "ARRIVING", "DELIVERED", "RETURNING"}


def tick_message() -> dict:
    rows = [[m.id, m.state, m.eta_s] for m in state.missions.values() if m.state in ACTIVE_MISSION_STATES]
    return {"t": "tick", "clock": round(state.sim_clock, 2), "d": simulator.telemetry_rows(state), "m": rows}


async def tick_loop() -> None:
    n = 0
    while True:
        await asyncio.sleep(TICK_DT)
        simulator.tick(state, TICK_DT)
        missions.advance(state)
        n += 1
        if n % TICKS_PER_BROADCAST == 0:
            bus.broadcast(tick_message())


@asynccontextmanager
async def lifespan(_: FastAPI):
    state.reset()
    task = asyncio.create_task(tick_loop())
    yield
    task.cancel()


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
def get_city() -> dict:
    return city.serialize(state)


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


@app.post("/api/reset")
async def reset() -> dict:
    state.reset()
    msg = hello()
    bus.broadcast(msg)
    return msg


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    bus.connections.add(ws)
    await ws.send_json(hello())
    try:
        while True:
            await ws.receive_text()  # server-to-client only; inbound frames are ignored
    except WebSocketDisconnect:
        pass
    finally:
        bus.connections.discard(ws)
