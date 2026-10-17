from cases import store
from policy_actions import claim, engine
from policy_actions.tests.g3 import g1_result, g3_result


def test_match_text_name_and_relationship():
    contacts = {"jake": {"name": "Jake", "aliases": ["jacob"], "relation": "grandson"}}
    assert claim.match_text("Grandma, it's Jake, I'm in trouble", contacts) == ("jake", "name")
    assert claim.match_text("grandma its jakee please", contacts)[0] == "jake"  # fuzzy
    assert claim.match_text("It's your grandson, help", contacts) == ("jake", "relationship")
    assert claim.match_text("hello, this is the bank", contacts) is None


def test_g3_actions():
    cid = store.open_case(g3_result().clip_id, "grandma")
    actions = engine.decide(g3_result(), cid)
    assert [a.type for a in actions] == ["verify_contact", "hold_new_payee", "notify_trusted_contact"]
    assert actions[0].target == "jake"
    assert actions[2].target == "maria"
    assert all(a.case_id == cid for a in actions)
    assert not any("+1555" in (a.target or "") for a in actions)


def test_all_bona_fide_no_actions():
    cid = store.open_case(g1_result().clip_id, "grandma")
    assert engine.decide(g1_result(), cid) == []


def test_synthetic_unknown_identity_holds_only():
    cid = store.open_case("x", "grandma")
    actions = engine.decide(g3_result(), cid, transcribe_fn=lambda *_: "this is the IRS calling")
    assert [a.type for a in actions] == ["hold_new_payee", "notify_trusted_contact"]


def test_abstain_holds():
    r = g1_result()
    r.abstain = "budget_exceeded"
    r.segments = []
    cid = store.open_case("x", "grandma")
    assert [a.type for a in engine.decide(r, cid)] == ["hold_new_payee"]


def test_execute_records_events_and_sends_verification():
    from policy_actions import verifier

    cid = store.open_case(g3_result().clip_id, "grandma")
    engine.execute(engine.decide(g3_result(), cid))
    types = [e.type for e in store.events(cid)]
    assert types.count("action") == 3
    assert "verification" in types and "notification" in types
    assert store.get_state(cid) == "VERIFYING"
    sent = [m for m in verifier.OUTBOX if m["case_id"] == cid]
    assert sent[0]["to"] == "+15550100001" and "Reply YES" in sent[0]["body"]
    assert sent[1]["to"] == "+15550100002"
    assert store.verify_chain(cid)["ok"]
