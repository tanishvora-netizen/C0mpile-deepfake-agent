"""Load contacts.yaml (members, saved contacts, trusted contact)."""
from pathlib import Path

import yaml

_PATH = Path(__file__).with_name("contacts.yaml")


def load() -> dict:
    return yaml.safe_load(_PATH.read_text())["members"]


def member(member_id: str) -> dict | None:
    return load().get(member_id)


def contact(member_id: str, contact_id: str) -> dict | None:
    m = member(member_id)
    if not m:
        return None
    c = m.get("contacts", {}).get(contact_id)
    return {"id": contact_id, **c} if c else None


def trusted(member_id: str) -> dict | None:
    m = member(member_id)
    return m.get("trusted_contact") if m else None


def all_contact_phones() -> dict[str, tuple[str, str]]:
    """phone -> (member_id, contact_id) for inbound reply matching."""
    out: dict[str, tuple[str, str]] = {}
    for mid, m in load().items():
        for cid, c in m.get("contacts", {}).items():
            out[c["phone"]] = (mid, cid)
    return out
