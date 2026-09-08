import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

import bus
import city
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


def tick_message() -> dict:
    return {"t": "tick", "clock": round(state.sim_clock, 2), "d": simulator.telemetry_rows(state)}


async def tick_loop() -> None:
    n = 0
    while True:
        await asyncio.sleep(TICK_DT)
        simulator.tick(state, TICK_DT)
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
