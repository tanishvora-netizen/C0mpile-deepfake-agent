"""Mock bank + circuit breaker (SPEC M6).

A new-payee transfer is HELD while the member's latest case is not VERIFIED, provided that case's
policy included ``hold_new_payee`` (a clean-call case such as G1 holds nothing). A trusted contact
releases or declines with the transfer token.
Transfers persist in ``$DATA_DIR/bank.db``; every state change appends a ``transfer_*`` case event.
"""
import os
import secrets
import sqlite3
import threading
import uuid
from datetime import UTC, datetime

from cases import store
from cases.logutil import jlog
from policy_actions import contacts_loader, verifier

_LOCK = threading.RLock()
HELD_COPY = ("Paused for your safety. We could not confirm the caller was {who}. "
             "We've asked your trusted contact to approve this transfer.")


class BankError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _connect() -> sqlite3.Connection:
    d = store.data_dir()
    d.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(d / "bank.db"), timeout=30)
    con.row_factory = sqlite3.Row
    con.execute(
        "CREATE TABLE IF NOT EXISTS transfers(id TEXT PRIMARY KEY, member_id TEXT, payee TEXT, amount REAL,"
        " new_payee INTEGER, state TEXT, token TEXT, reason TEXT, case_id TEXT, created_at TEXT)")
    return con


def _holding_case(member_id: str) -> dict | None:
    """The member's latest case, if its policy included hold_new_payee (a clean-call case holds nothing)."""
    cases = store.member_cases(member_id)
    if not cases:
        return None
    latest = cases[0]
    for e in store.events(latest["id"]):
        if e.type == "action" and e.payload.get("type") == "hold_new_payee":
            return latest
    return None


def _claimed_name(case: dict) -> str:
    for e in store.events(case["id"]):
        if e.type == "action" and e.payload.get("type") == "verify_contact" and e.payload.get("target"):
            c = contacts_loader.contact(case["member_id"], e.payload["target"])
            if c:
                return c["name"]
    return "who they claimed to be"


def _public(r: sqlite3.Row, with_token: bool = False) -> dict:
    d = {"id": r["id"], "state": r["state"], "amount": r["amount"], "payee": r["payee"],
         "reason": r["reason"], "member_id": r["member_id"], "case_id": r["case_id"],
         "new_payee": bool(r["new_payee"])}
    if with_token:
        d["token"] = r["token"]
    return d


def create_transfer(member_id: str, payee: str, amount: float, new_payee: bool) -> dict:
    """Returns {id, state, token, reason, ...}; state is HELD or PENDING."""
    case = _holding_case(member_id)
    held = bool(new_payee and case and case["state"] != "VERIFIED")
    tid = "tx_" + uuid.uuid4().hex[:10]
    token = secrets.token_urlsafe(16) if held else None
    reason = HELD_COPY.format(who=_claimed_name(case)) if held and case else ""
    state = "HELD" if held else "PENDING"
    with _LOCK:
        con = _connect()
        try:
            with con:
                con.execute("INSERT INTO transfers VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (tid, member_id, payee, float(amount), int(new_payee), state, token, reason,
                             case["id"] if case else None, datetime.now(UTC).isoformat()))
        finally:
            con.close()
    base = {"transfer_id": tid, "payee": payee, "amount": amount, "new_payee": new_payee}
    if case:
        store.append(case["id"], "transfer_held" if held else "transfer_created",
                     {**base, "state": state, "reason": reason})
    if held and case:
        tc = contacts_loader.trusted(member_id)
        if tc:
            link = f"{os.environ.get('WEB_BASE_URL', 'http://localhost:5173')}/approve/{token}"
            verifier.send_sms(tc["phone"], f"CallGuard: approve or decline a held ${amount:,.2f} transfer "
                              f"to {payee}: {link}", case["id"])
            store.append(case["id"], "notification", {"kind": "approval_link", "contact_id": tc["id"],
                                                      "transfer_id": tid})
    jlog("transfer_created", case_id=case["id"] if case else tid, transfer_id=tid, state=state)
    return {"id": tid, "state": state, "token": token, "reason": reason}


def get_transfer(transfer_id: str) -> dict | None:
    con = _connect()
    try:
        r = con.execute("SELECT * FROM transfers WHERE id=?", (transfer_id,)).fetchone()
    finally:
        con.close()
    return _public(r) if r else None


def get_by_token(token: str) -> dict | None:
    con = _connect()
    try:
        r = con.execute("SELECT * FROM transfers WHERE token=?", (token,)).fetchone() if token else None
    finally:
        con.close()
    return _public(r) if r else None


def _resolve(transfer_id: str, token: str, new_state: str, by: str) -> dict:
    with _LOCK:
        con = _connect()
        try:
            with con:
                r = con.execute("SELECT * FROM transfers WHERE id=?", (transfer_id,)).fetchone()
                if r is None:
                    raise BankError("unknown transfer", 404)
                if not r["token"] or not secrets.compare_digest(str(r["token"]), str(token or "")):
                    raise BankError("invalid token", 403)
                if r["state"] != "HELD":
                    raise BankError(f"transfer is {r['state']}, not HELD", 409)
                con.execute("UPDATE transfers SET state=? WHERE id=?", (new_state, transfer_id))
        finally:
            con.close()
    _record(r, new_state, by)
    return {**_public(r), "state": new_state}


def _record(r: sqlite3.Row, new_state: str, by: str) -> None:
    if r["case_id"]:
        store.append(r["case_id"], "transfer_" + new_state.lower(),
                     {"transfer_id": r["id"], "payee": r["payee"], "amount": r["amount"],
                      "state": new_state, "by": by})


def approve(transfer_id: str, token: str) -> dict:
    """HELD -> RELEASED. Raises BankError (404 unknown, 403 bad token, 409 not HELD)."""
    return _resolve(transfer_id, token, "RELEASED", "trusted_contact")


def decline(transfer_id: str, token: str) -> dict:
    """HELD -> DECLINED. Raises BankError like approve."""
    return _resolve(transfer_id, token, "DECLINED", "trusted_contact")


def release_for_case(case_id: str) -> list[str]:
    """Case became VERIFIED: release its HELD transfers."""
    released: list[str] = []
    with _LOCK:
        con = _connect()
        try:
            with con:
                rows = con.execute("SELECT * FROM transfers WHERE case_id=? AND state='HELD'",
                                   (case_id,)).fetchall()
                con.execute("UPDATE transfers SET state='RELEASED' WHERE case_id=? AND state='HELD'",
                            (case_id,))
        finally:
            con.close()
    for r in rows:
        _record(r, "RELEASED", "case_verified")
        released.append(r["id"])
    return released
