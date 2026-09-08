import asyncio
import json
import logging

from fastapi import WebSocket

log = logging.getLogger("skyguard.bus")
connections: set[WebSocket] = set()


def publish(kind: str, payload: dict) -> None:
    if not connections:
        return
    message = json.dumps({"kind": kind, "payload": payload})
    asyncio.create_task(_fan_out(message))


async def _fan_out(message: str) -> None:
    results = await asyncio.gather(*(ws.send_text(message) for ws in list(connections)), return_exceptions=True)
    for ws, result in zip(list(connections), results):
        if isinstance(result, Exception):
            log.warning("dropping ws client: %s", result)
            connections.discard(ws)
