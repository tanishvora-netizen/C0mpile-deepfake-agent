"""JSON-lines logging to stdout. Always pass case_id or trace_id."""
import json
import sys
from datetime import UTC, datetime


def jlog(event: str, **fields) -> None:
    rec = {"ts": datetime.now(UTC).isoformat(), "event": event, **fields}
    try:
        sys.stdout.write(json.dumps(rec, default=str) + "\n")
        sys.stdout.flush()
    except Exception:  # noqa: BLE001  # logging must never break the caller
        return
