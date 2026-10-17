"""Verification by text (SPEC M6). Mock Twilio (MOCK_TWILIO=1, default) logs and records only.

Texts go only to numbers saved in contacts.yaml, never to a number spoken on the call or sent as
caller metadata. Case states: OPEN -> VERIFYING -> VERIFIED | CONTRADICTED | UNREACHABLE.
"""
import base64
import hashlib
import hmac
import os
import threading

import httpx

from cases import store
from cases.logutil import jlog
from policy_actions import contacts_loader

OUTBOX: list[dict] = []  # mock SMS record, newest last
_TIMERS: dict[str, threading.Timer] = {}


def _mock() -> bool:
    return os.environ.get("MOCK_TWILIO", "1") != "0"


def timeout_s() -> float:
    return float(os.environ.get("VERIFY_TIMEOUT_S", "120"))


def send_sms(to: str, body: str, case_id: str) -> dict:
    """Send (or mock-send) one SMS. Never raises."""
    rec = {"to": to, "body": body, "case_id": case_id, "mock": _mock()}
    sid, tok, frm = (os.environ.get(k) for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"))
    if not _mock() and sid and tok and frm:  # pragma: no cover - network
        try:
            r = httpx.post(f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
                           auth=(sid, tok), data={"To": to, "From": frm, "Body": body}, timeout=10)
            rec["status_code"] = r.status_code
        except Exception as exc:  # noqa: BLE001
            rec["error"] = str(exc)[:200]
    OUTBOX.append(rec)
    jlog("sms_sent", case_id=case_id, mock=rec["mock"], to_suffix=to[-4:])
    return rec


def validate_twilio_signature(url: str, params: dict, signature: str) -> bool:
    """X-Twilio-Signature = base64(HMAC-SHA1(auth_token, url + sorted key+value pairs))."""
    token = os.environ.get("TWILIO_AUTH_TOKEN", "")
    data = url + "".join(f"{k}{params[k]}" for k in sorted(params))
    mac = hmac.new(token.encode(), data.encode(), hashlib.sha1).digest()
    return hmac.compare_digest(base64.b64encode(mac).decode(), signature or "")


def send_verification(case_id: str, contact_id: str) -> dict:
    """Text the contact's saved number and move the case to VERIFYING. Never raises on bad contact."""
    row = store.get_case_row(case_id)
    contact = contacts_loader.contact(row["member_id"], contact_id)
    if not contact:
        store.append(case_id, "verification", {"contact_id": contact_id, "outcome": "contact_not_found"})
        return {"ok": False, "error": "contact_not_found"}
    member = contacts_loader.member(row["member_id"]) or {}
    body = (f"Hi {contact['name']}, someone is calling {member.get('name', 'a family member')} with your "
            "voice and asking for money. Reply YES if it's really you, NO if not.")
    rec = send_sms(contact["phone"], body, case_id)
    store.set_state(case_id, "VERIFYING")
    store.append(case_id, "verification", {"contact_id": contact_id, "outcome": "VERIFYING",
                                           "channel": "sms", "mock": rec["mock"], "body": body})
    t = timeout_s()
    if t > 0:
        timer = threading.Timer(t, timeout, args=[case_id])
        timer.daemon = True
        _TIMERS[case_id] = timer
        timer.start()
    return {"ok": True, "state": "VERIFYING"}


def notify_trusted(case_id: str, reason: str = "") -> dict:
    row = store.get_case_row(case_id)
    tc = contacts_loader.trusted(row["member_id"])
    if not tc:
        return {"ok": False, "error": "no_trusted_contact"}
    member = contacts_loader.member(row["member_id"]) or {}
    body = (f"CallGuard alert: a call to {member.get('name', 'your family member')} used a voice that "
            "looks synthetic. New-payee transfers are on hold. You may be asked to approve a transfer.")
    send_sms(tc["phone"], body, case_id)
    store.append(case_id, "notification", {"kind": "trusted_contact_alert", "contact_id": tc["id"]})
    return {"ok": True}


def _cancel_timer(case_id: str) -> None:
    t = _TIMERS.pop(case_id, None)
    if t:
        t.cancel()


def _resolve(case_id: str, state: str, contact_id: str | None, detail: dict) -> str:
    store.set_state(case_id, state)
    store.append(case_id, "verification", {"contact_id": contact_id, "outcome": state, **detail})
    _cancel_timer(case_id)
    if state == "VERIFIED":
        from policy_actions import bank

        bank.release_for_case(case_id)
    return state


def _verify_contact_id(case_id: str) -> str | None:
    for e in reversed(store.events(case_id)):
        if e.type == "verification" and e.payload.get("outcome") == "VERIFYING":
            return e.payload.get("contact_id")
    return None


def handle_reply(case_id: str, text: str) -> str:
    """YES -> VERIFIED, NO -> CONTRADICTED. Anything else leaves the state unchanged. Returns state."""
    state = store.get_state(case_id)
    word = (text or "").strip().split()[:1]
    word = word[0].strip(".,!").upper() if word else ""
    cid = _verify_contact_id(case_id)
    if state not in ("VERIFYING", "UNREACHABLE"):
        store.append(case_id, "verification", {"contact_id": cid, "outcome": "ignored_reply", "state": state})
        return state
    if word in ("YES", "Y"):
        return _resolve(case_id, "VERIFIED", cid, {"reply": "YES"})
    if word in ("NO", "N"):
        return _resolve(case_id, "CONTRADICTED", cid, {"reply": "NO"})
    store.append(case_id, "verification", {"contact_id": cid, "outcome": "unparsed_reply"})
    return state


def timeout(case_id: str) -> str:
    """No reply in time: VERIFYING -> UNREACHABLE. No-op in any other state."""
    try:
        state = store.get_state(case_id)
    except KeyError:
        return "UNKNOWN"
    if state != "VERIFYING":
        return state
    return _resolve(case_id, "UNREACHABLE", _verify_contact_id(case_id), {"after_s": timeout_s()})


def case_for_phone(phone: str) -> str | None:
    """VERIFYING case awaiting a reply from this saved number (inbound webhook routing)."""
    who = contacts_loader.all_contact_phones().get(phone)
    if not who:
        return None
    member_id, contact_id = who
    for c in store.member_cases(member_id):
        if c["state"] == "VERIFYING" and _verify_contact_id(c["id"]) == contact_id:
            return c["id"]
    return None
