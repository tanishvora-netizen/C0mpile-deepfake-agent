"""M3 tools manager, in-process: validate, cache, normalize. Never raises (SPEC M3).

MOCK_TOOLS=1 (default) serves ToolRecords from contracts/fixtures by golden clip name;
an unknown but ingested clip gets G1-style benign records.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from pathlib import Path

from contracts.hashing import canonical_json
from contracts.models import ToolCard, ToolRecord
from intake import store
from tools_manager.cards import CARD_BY_NAME, CARDS
from tools_manager.mock_records import (
    VALIDITY,
    adapt,
    benign_spec,
    build_records,
    derive_rescore,
    derive_speaker,
)

log = logging.getLogger("tools_manager")
FIXTURES = Path(__file__).resolve().parent.parent / "contracts" / "fixtures" / "tool_records"
INSTALLED = {"get_context", "score_turns", "score_windows", "rescore_region", "find_boundaries", "speaker_consistency"}

_cache: dict[str, ToolRecord] = {}
_fixture_cache: dict[str, dict[str, ToolRecord]] = {}
_lock = threading.Lock()


def mock_tools() -> bool:
    return os.environ.get("MOCK_TOOLS", "1") != "0"


def list_cards() -> list[ToolCard]:
    return list(CARDS)


def anthropic_tools() -> list[dict]:
    """Anthropic tool-use definitions for the tools installed in this build."""
    out = []
    for c in CARDS:
        if c.name not in INSTALLED:
            continue
        desc = c.description + " Known weaknesses: " + "; ".join(c.known_weaknesses) + "."
        out.append({"name": c.name, "description": desc, "input_schema": c.args_schema})
    return out


def clear_cache() -> None:
    with _lock:
        _cache.clear()


# ---- validation --------------------------------------------------------------------------------

_TYPES = {"string": str, "boolean": bool, "array": list, "object": dict}


def _check(value: object, schema: dict, path: str) -> str | None:
    t = schema.get("type")
    if t in ("number", "integer"):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return f"{path}: expected {t}"
        if t == "integer" and float(value) != int(value):
            return f"{path}: expected integer"
        if "minimum" in schema and value < schema["minimum"]:
            return f"{path}: must be >= {schema['minimum']}"
        if "maximum" in schema and value > schema["maximum"]:
            return f"{path}: must be <= {schema['maximum']}"
    elif t in _TYPES and not isinstance(value, _TYPES[t]):
        return f"{path}: expected {t}"
    if "enum" in schema and value not in schema["enum"]:
        return f"{path}: must be one of {schema['enum']}"
    if t == "array" and "items" in schema:
        for i, item in enumerate(value):  # type: ignore[arg-type]
            err = _check(item, schema["items"], f"{path}[{i}]")
            if err:
                return err
    return None


def validate_args(card: ToolCard, args: dict) -> str | None:
    schema = card.args_schema
    for key in schema.get("required", []):
        if key not in args:
            return f"missing required argument '{key}'"
    for key, val in args.items():
        prop = schema["properties"].get(key)
        if prop is None:
            return f"unknown argument '{key}'"
        err = _check(val, prop, key)
        if err:
            return err
    return None


# ---- records -----------------------------------------------------------------------------------

def _record(name: str, clip_id: str, params: dict, status: str, error: str, version: str = "0.1.0", ms: int = 0) -> ToolRecord:
    return ToolRecord(
        tool=name, version=version, clip_id=clip_id, params=params, status=status,  # type: ignore[arg-type]
        values={}, validity=dict(VALIDITY), flags=[], runtime_ms=ms, error=error,
    )


def _base_records(clip_id: str) -> dict[str, ToolRecord] | None:
    """Fixture records for a clip: golden fixtures, else benign records from the stored duration."""
    with _lock:
        if clip_id in _fixture_cache:
            return _fixture_cache[clip_id]
    name = store.golden_name(clip_id)
    recs: dict[str, ToolRecord] = {}
    if name and (FIXTURES / name).is_dir():
        for f in sorted((FIXTURES / name).glob("*.json")):
            recs[f.stem] = ToolRecord.model_validate_json(f.read_text())
    else:
        try:
            meta = store.get(clip_id)
        except KeyError:
            return None
        recs = build_records(clip_id, benign_spec(meta.duration_s))
    with _lock:
        _fixture_cache[clip_id] = recs
    return recs


def _close(a: float, b: float) -> bool:
    return abs(float(a) - float(b)) < 0.01


def _mock_call(name: str, clip_id: str, args: dict) -> ToolRecord:
    if name not in INSTALLED:
        return _record(name, clip_id, _params(args), "failed", f"tool '{name}' is not installed in this build")
    base = _base_records(clip_id)
    if base is None:
        return _record(name, clip_id, _params(args), "failed", "unknown clip_id")
    ctx = base.get("get_context__none")
    scores = {d: base[f"score_turns__{d}"] for d in ("A", "B") if f"score_turns__{d}" in base}
    key = f"{name}__{args.get('detector', 'none')}"
    rec = base.get(key)
    if name == "rescore_region":
        if rec is not None and _close(rec.params["start"], args["start"]) and _close(rec.params["end"], args["end"]):
            out = adapt(rec, clip_id, args, ctx, scores)
        else:
            out = derive_rescore(clip_id, args, scores)
    elif name == "speaker_consistency":
        if rec is not None and (rec.params["turn_a"], rec.params["turn_b"]) == (args["turn_a"], args["turn_b"]):
            out = adapt(rec, clip_id, args, ctx, scores)
        else:
            out = derive_speaker(clip_id, args, ctx)
    elif rec is None:
        return _record(name, clip_id, _params(args), "failed", f"no fixture for {key}")
    else:
        out = adapt(rec, clip_id, args, ctx, scores)
    if name in ("score_windows", "rescore_region"):
        span = float(args.get("end", 1e9)) - float(args.get("start", 0.0))
        if span < VALIDITY["min_duration_s"] and "too_short" not in out.flags:
            out.flags.append("too_short")
    return out


def _remote_call(name: str, clip_id: str, args: dict) -> ToolRecord:
    import httpx

    url = os.environ.get("TOOLS_URL", "http://localhost:8100").rstrip("/") + f"/tools/{name}"
    body = {"clip_id": clip_id, "params": _params(args), "trace_id": args.get("trace_id", "")}
    last: Exception | None = None
    for _ in range(2):  # retry once on a connection error
        try:
            resp = httpx.post(url, json=body, timeout=60.0)
            resp.raise_for_status()
            return ToolRecord.model_validate(resp.json())
        except httpx.ConnectError as exc:
            last = exc
        except Exception as exc:  # noqa: BLE001 - every worker failure becomes a failed record
            return _record(name, clip_id, _params(args), "failed", f"worker error: {exc}")
    return _record(name, clip_id, _params(args), "failed", f"worker unreachable: {last}")


def _params(args: dict) -> dict:
    return {k: v for k, v in args.items() if k not in ("clip_id", "trace_id")}


def call_tool(name: str, args: dict) -> ToolRecord:
    """Run one tool. Never raises; failures come back as status='failed' or 'invalid_input'."""
    t0 = time.perf_counter()
    clip_id = str(args.get("clip_id", "")) if isinstance(args, dict) else ""
    try:
        card = CARD_BY_NAME.get(name)
        if card is None:
            return _record(name, clip_id, {}, "invalid_input", f"unknown tool '{name}'")
        args = {k: v for k, v in args.items() if k != "trace_id"}
        err = validate_args(card, args)
        if err:
            return _record(name, clip_id, _params(args), "invalid_input", err, card.version)
        ck = hashlib.sha256(canonical_json([clip_id, name, card.version, _params(args), mock_tools()]).encode()).hexdigest()
        with _lock:
            hit = _cache.get(ck)
        if hit is not None:
            return hit.model_copy(deep=True)
        rec = _mock_call(name, clip_id, args) if mock_tools() else _remote_call(name, clip_id, args)
        if rec.status == "ok":
            with _lock:
                _cache[ck] = rec
            return rec.model_copy(deep=True)
        return rec
    except Exception as exc:  # noqa: BLE001 - boundary: never raise
        log.error(json.dumps({"event": "tool_error", "tool": name, "clip_id": clip_id, "error": str(exc)}))
        return _record(name, clip_id, {}, "failed", f"{type(exc).__name__}: {exc}", ms=int((time.perf_counter() - t0) * 1000))
