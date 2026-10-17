"""Canonical JSON and the case hash chain (SPEC M0 CaseEvent, M7)."""
import hashlib
import json

GENESIS = "0" * 64


def canonical_json(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def event_hash(prev_hash: str, case_id: str, seq: int, ts: str, type: str, payload: dict) -> str:
    body = canonical_json({"case_id": case_id, "seq": seq, "ts": ts, "type": type, "payload": payload})
    return hashlib.sha256((prev_hash + body).encode("utf-8")).hexdigest()
