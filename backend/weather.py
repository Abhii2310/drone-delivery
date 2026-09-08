import asyncio
import logging
from math import cos, radians

import httpx

import bus
from state import AppState

log = logging.getLogger("skyguard.weather")

URL = ("https://api.open-meteo.com/v1/forecast?latitude=12.97&longitude=77.59"
       "&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,visibility"
       "&wind_speed_unit=ms")
TIMEOUT_S = 3.0
POLL_S = 600
RETRY_S = 30  # a cold first connection can miss the 3s budget; do not wait 10 min to try again
FALLBACK = {"wind_speed": 8.0, "wind_direction": 240.0, "wind_gusts": 9.0,
            "visibility_m": 9000.0, "precipitation": 0.0, "source": "FALLBACK"}
DRAIN_WIND_K = 0.04


async def fetch_once(state: AppState) -> dict:
    if state.weather.get("override"):
        return state.weather
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as client:
            body = (await client.get(URL)).json()["current"]
        reading = {"wind_speed": float(body["wind_speed_10m"]),
                   "wind_direction": float(body["wind_direction_10m"]),
                   "wind_gusts": float(body.get("wind_gusts_10m") or body["wind_speed_10m"]),
                   "visibility_m": float(body.get("visibility") or 10000.0),
                   "precipitation": float(body.get("precipitation") or 0.0),
                   "source": "OPEN_METEO", "observed_at": body.get("time")}
    except Exception as exc:  # noqa: BLE001 - a weather fetch must never block the sim
        log.warning("open-meteo unavailable (%s); using fallback", type(exc).__name__)
        reading = dict(FALLBACK)
    state.weather = reading
    bus.publish("weather.updated", {"weather": reading, "clock": round(state.sim_clock, 2)})
    return reading


async def poll(state: AppState) -> None:
    while True:
        reading = await fetch_once(state)
        await asyncio.sleep(POLL_S if reading.get("source") == "OPEN_METEO" else RETRY_S)


def headwind(state: AppState, heading: float) -> float:
    """Positive when the wind opposes the drone, in m/s."""
    w = state.weather
    return w["wind_speed"] * cos(radians(heading - w["wind_direction"]))


def effective_speed(state: AppState, heading: float, speed: float) -> float:
    return max(2.0, speed - headwind(state, heading))


def drain_multiplier(state: AppState, heading: float) -> float:
    return 1 + DRAIN_WIND_K * max(0.0, headwind(state, heading))
