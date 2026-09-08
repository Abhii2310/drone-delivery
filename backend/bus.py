import asyncio
import json
import logging

from fastapi import WebSocket

log = logging.getLogger("skyguard.bus")
connections: set[WebSocket] = set()


def broadcast(message: dict) -> None:
    if not connections:
        return
    asyncio.create_task(_fan_out(json.dumps(message)))


def publish(kind: str, payload: dict) -> None:
    broadcast({"t": "ev", "kind": kind, "payload": payload})


async def _fan_out(message: str) -> None:
    targets = list(connections)
    results = await asyncio.gather(*(ws.send_text(message) for ws in targets), return_exceptions=True)
    for ws, result in zip(targets, results):
        if isinstance(result, Exception):
            log.warning("dropping ws client: %s", result)
            connections.discard(ws)
