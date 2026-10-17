import pytest

from cases import store
from policy_actions import bank, engine, verifier
from policy_actions.tests.g3 import g1_result, g3_result


def _g3_case():
    cid = store.open_case(g3_result().clip_id, "grandma")
    engine.execute(engine.decide(g3_result(), cid))
    return cid


def test_no_reply_goes_unreachable():
    cid = _g3_case()
    assert verifier.timeout(cid) == "UNREACHABLE"
    assert store.get_state(cid) == "UNREACHABLE"
    assert verifier.timeout(cid) == "UNREACHABLE"  # idempotent
    assert store.events(cid)[-1].payload["outcome"] == "UNREACHABLE"


def test_timer_fires(monkeypatch):
    import time

    monkeypatch.setenv("VERIFY_TIMEOUT_S", "0.1")
    cid = _g3_case()
    time.sleep(0.4)
    assert store.get_state(cid) == "UNREACHABLE"


def test_no_reply_contradicts_and_transfer_held():
    cid = _g3_case()
    t = bank.create_transfer("grandma", "Acme Legal Trust", 9500, True)
    assert t["state"] == "HELD" and t["token"]
    assert t["reason"] == ("Paused for your safety. We could not confirm the caller was Jake. "
                           "We've asked your trusted contact to approve this transfer.")
    assert verifier.handle_reply(cid, "no") == "CONTRADICTED"
    assert bank.get_transfer(t["id"])["state"] == "HELD"
    assert store.verify_chain(cid)["ok"]
    types = [e.type for e in store.events(cid)]
    assert "transfer_held" in types


def test_yes_verifies_and_releases_held():
    cid = _g3_case()
    t = bank.create_transfer("grandma", "Acme", 9500, True)
    assert verifier.handle_reply(cid, " Yes! ") == "VERIFIED"
    assert bank.get_transfer(t["id"])["state"] == "RELEASED"
    assert bank.create_transfer("grandma", "Acme", 100, True)["state"] == "PENDING"
    assert store.events(cid)[-1].type in ("transfer_created", "transfer_released")


def test_unparsed_reply_keeps_state():
    cid = _g3_case()
    assert verifier.handle_reply(cid, "maybe?") == "VERIFYING"


def test_approve_and_decline():
    _g3_case()
    a = bank.create_transfer("grandma", "A", 9500, True)
    b = bank.create_transfer("grandma", "B", 9500, True)
    with pytest.raises(bank.BankError) as ei:
        bank.approve(a["id"], "wrong")
    assert ei.value.status == 403
    assert bank.approve(a["id"], a["token"])["state"] == "RELEASED"
    assert bank.decline(b["id"], b["token"])["state"] == "DECLINED"
    with pytest.raises(bank.BankError) as ei:
        bank.approve(a["id"], a["token"])
    assert ei.value.status == 409
    assert bank.get_by_token(b["token"])["id"] == b["id"]


def test_existing_payee_and_no_case_pass_through():
    assert bank.create_transfer("grandma", "Utility Co", 80, True)["state"] == "PENDING"  # no case yet
    _g3_case()
    assert bank.create_transfer("grandma", "Utility Co", 80, False)["state"] == "PENDING"


def test_g1_case_does_not_hold():
    cid = store.open_case(g1_result().clip_id, "grandma")
    assert engine.execute(engine.decide(g1_result(), cid)) == []
    assert bank.create_transfer("grandma", "Acme", 9500, True)["state"] == "PENDING"


def test_case_for_phone_routing():
    cid = _g3_case()
    assert verifier.case_for_phone("+15550100001") == cid
    assert verifier.case_for_phone("+19999999999") is None


def test_later_clean_case_supersedes_older_fraud_case():
    _g3_case()
    cid = store.open_case(g1_result().clip_id, "grandma")
    engine.execute(engine.decide(g1_result(), cid))
    assert bank.create_transfer("grandma", "Acme", 9500, True)["state"] == "PENDING"
