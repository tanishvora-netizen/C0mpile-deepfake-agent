"""Case store (SPEC M7): SQLite, insert-only event log with a sha256 hash chain.

DB lives at ``$DATA_DIR/cases.db`` (default ``./var``). Events are mirrored to
``$DATA_DIR/cases/<case_id>.jsonl``. ``DATA_DIR`` is read on every call so tests can redirect it.
"""
import json
import os
import sqlite3
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path

from cases.logutil import jlog
from contracts.hashing import GENESIS, event_hash
from contracts.models import CASE_STATES, CaseEvent

_LOCK = threading.RLock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS cases(
  id TEXT PRIMARY KEY, member_id TEXT NOT NULL, clip_id TEXT NOT NULL,
  state TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(
  case_id TEXT NOT NULL, seq INTEGER NOT NULL, ts TEXT NOT NULL, type TEXT NOT NULL,
  payload_json TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL,
  PRIMARY KEY(case_id, seq));
"""


def data_dir() -> Path:
    return Path(os.environ.get("DATA_DIR", "./var"))


def _connect() -> sqlite3.Connection:
    d = data_dir()
    d.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(d / "cases.db"), timeout=30)
    con.row_factory = sqlite3.Row
    con.executescript(_SCHEMA)
    return con


def _now() -> str:
    return datetime.now(UTC).isoformat()


def open_case(clip_id: str, member_id: str) -> str:
    case_id = "case_" + uuid.uuid4().hex[:12]
    with _LOCK:
        con = _connect()
        try:
            with con:
                con.execute(
                    "INSERT INTO cases(id, member_id, clip_id, state, created_at) VALUES (?,?,?,?,?)",
                    (case_id, member_id, clip_id, "OPEN", _now()),
                )
        finally:
            con.close()
    jlog("case_opened", case_id=case_id, member_id=member_id, clip_id=clip_id)
    return case_id


def _row_to_event(r: sqlite3.Row) -> CaseEvent:
    return CaseEvent(
        case_id=r["case_id"], seq=r["seq"], ts=r["ts"], type=r["type"],
        payload=json.loads(r["payload_json"]), prev_hash=r["prev_hash"], hash=r["hash"],
    )


def append(case_id: str, type: str, payload: dict) -> CaseEvent:
    """Append one hash-chained event. Raises KeyError for an unknown case."""
    with _LOCK:
        con = _connect()
        try:
            with con:
                if con.execute("SELECT 1 FROM cases WHERE id=?", (case_id,)).fetchone() is None:
                    raise KeyError(case_id)
                last = con.execute(
                    "SELECT seq, hash FROM events WHERE case_id=? ORDER BY seq DESC LIMIT 1", (case_id,)
                ).fetchone()
                seq = 0 if last is None else last["seq"] + 1
                prev = GENESIS if last is None else last["hash"]
                ts = _now()
                payload = json.loads(json.dumps(payload, default=str))  # JSON-normalise
                h = event_hash(prev, case_id, seq, ts, type, payload)
                con.execute(
                    "INSERT INTO events(case_id, seq, ts, type, payload_json, prev_hash, hash)"
                    " VALUES (?,?,?,?,?,?,?)",
                    (case_id, seq, ts, type, json.dumps(payload, sort_keys=True), prev, h),
                )
        finally:
            con.close()
        ev = CaseEvent(case_id=case_id, seq=seq, ts=ts, type=type, payload=payload, prev_hash=prev, hash=h)
        try:
            mirror = data_dir() / "cases"
            mirror.mkdir(parents=True, exist_ok=True)
            with open(mirror / f"{case_id}.jsonl", "a", encoding="utf-8") as f:
                f.write(ev.model_dump_json() + "\n")
        except OSError:
            pass
    jlog("case_event", case_id=case_id, seq=seq, type=type)
    return ev


def events(case_id: str) -> list[CaseEvent]:
    con = _connect()
    try:
        rows = con.execute("SELECT * FROM events WHERE case_id=? ORDER BY seq", (case_id,)).fetchall()
    finally:
        con.close()
    return [_row_to_event(r) for r in rows]


def get_case_row(case_id: str) -> dict:
    """{id, member_id, clip_id, state, created_at}; raises KeyError."""
    con = _connect()
    try:
        r = con.execute(
            "SELECT id, member_id, clip_id, state, created_at FROM cases WHERE id=?", (case_id,)
        ).fetchone()
    finally:
        con.close()
    if r is None:
        raise KeyError(case_id)
    return dict(r)


def get_state(case_id: str) -> str:
    return get_case_row(case_id)["state"]


def set_state(case_id: str, state: str) -> None:
    """Update the mutable case state. Callers append the matching event (see policy_actions)."""
    if state not in CASE_STATES:
        raise ValueError(f"bad case state {state!r}")
    with _LOCK:
        con = _connect()
        try:
            with con:
                cur = con.execute("UPDATE cases SET state=? WHERE id=?", (state, case_id))
                if cur.rowcount == 0:
                    raise KeyError(case_id)
        finally:
            con.close()


def get_case(case_id: str) -> tuple[str, list[CaseEvent]]:
    return get_state(case_id), events(case_id)


def member_cases(member_id: str) -> list[dict]:
    """Cases of a member, newest first."""
    con = _connect()
    try:
        rows = con.execute(
            "SELECT id, member_id, clip_id, state, created_at FROM cases WHERE member_id=?"
            " ORDER BY created_at DESC, rowid DESC", (member_id,),
        ).fetchall()
    finally:
        con.close()
    return [dict(r) for r in rows]


def all_cases(state: str | None = None) -> list[dict]:
    con = _connect()
    try:
        if state:
            rows = con.execute("SELECT * FROM cases WHERE state=?", (state,)).fetchall()
        else:
            rows = con.execute("SELECT * FROM cases").fetchall()
    finally:
        con.close()
    return [dict(r) for r in rows]


def verify_chain(case_id: str) -> dict:
    """Recompute the chain. Returns {"ok": bool, "bad_seq": int | None} (first bad seq)."""
    prev = GENESIS
    for i, ev in enumerate(events(case_id)):
        if ev.seq != i or ev.prev_hash != prev:
            return {"ok": False, "bad_seq": ev.seq if ev.seq != i else i}
        if event_hash(ev.prev_hash, ev.case_id, ev.seq, ev.ts, ev.type, ev.payload) != ev.hash:
            return {"ok": False, "bad_seq": ev.seq}
        prev = ev.hash
    return {"ok": True, "bad_seq": None}
