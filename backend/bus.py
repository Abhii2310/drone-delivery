import asyncio
import json
import logging

from fastapi import WebSocket

log = logging.getLogger("skyguard.bus")
connections: dict[WebSocket, object] = {}


def broadcast(message: dict) -> None:
    if not connections:
        return
    asyncio.create_task(_fan_out(json.dumps(message)))


def broadcast_per(build) -> None:
    """One message per connection, built from that connection's viewer."""
    if not connections:
        return
    asyncio.create_task(_fan_out_per(build))


async def _fan_out_per(build) -> None:
    targets = list(connections.items())
    cache: dict[object, str] = {}
    payloads = []
    for _, viewer in targets:
        if viewer not in cache:
            cache[viewer] = json.dumps(build(viewer))
        payloads.append(cache[viewer])
    results = await asyncio.gather(*(ws.send_text(p) for (ws, _), p in zip(targets, payloads)), return_exceptions=True)
    for (ws, _), result in zip(targets, results):
        if isinstance(result, Exception):
            log.warning("dropping ws client: %s", result)
            connections.pop(ws, None)


def publish(kind: str, payload: dict) -> None:
    broadcast({"t": "ev", "kind": kind, "payload": payload})


async def _fan_out(message: str) -> None:
    targets = list(connections)
    results = await asyncio.gather(*(ws.send_text(message) for ws in targets), return_exceptions=True)
    for ws, result in zip(targets, results):
        if isinstance(result, Exception):
            log.warning("dropping ws client: %s", result)
            connections.pop(ws, None)
