import bus
from state import AppState


def append(state: AppState, actor: str, action: str, before: dict, after: dict, detail: str = "") -> dict:
    event = {
        "id": f"AUD-{len(state.audit) + 1:04d}",
        "t": round(state.sim_clock, 2),
        "actor": actor,
        "action": action,
        "before": before,
        "after": after,
        "detail": detail,
    }
    state.audit.append(event)
    bus.publish("audit.append", event)
    return event


def query(state: AppState, limit: int = 200) -> list[dict]:
    return state.audit[-limit:]
