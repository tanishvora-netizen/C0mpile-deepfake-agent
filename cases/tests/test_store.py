import sqlite3

from cases import store, writer
from contracts.hashing import GENESIS, event_hash
from policy_actions.tests.g3 import g3_result


def _case_with_events():
    cid = store.open_case("clipX", "grandma")
    store.append(cid, "clip_ingested", {"clip_id": "clipX", "duration_s": 7.0})
    store.append(cid, "analysis_done", g3_result().model_dump())
    store.append(cid, "action", {"type": "hold_new_payee", "target": None, "reason": "r"})
    return cid


def test_chain_links_and_genesis():
    cid = _case_with_events()
    evs = store.events(cid)
    assert [e.seq for e in evs] == [0, 1, 2]
    assert evs[0].prev_hash == GENESIS
    assert evs[1].prev_hash == evs[0].hash
    assert evs[2].hash == event_hash(evs[1].hash, cid, 2, evs[2].ts, "action", evs[2].payload)
    assert store.verify_chain(cid) == {"ok": True, "bad_seq": None}
    assert store.get_state(cid) == "OPEN"
    assert (store.data_dir() / "cases" / f"{cid}.jsonl").read_text().count("\n") == 3


def test_edit_detected_at_seq():
    cid = _case_with_events()
    con = sqlite3.connect(str(store.data_dir() / "cases.db"))
    con.execute("UPDATE events SET payload_json=? WHERE case_id=? AND seq=1", ('{"tampered": true}', cid))
    con.commit()
    con.close()
    assert store.verify_chain(cid) == {"ok": False, "bad_seq": 1}


def test_rehashed_edit_breaks_next_link():
    cid = _case_with_events()
    e = store.events(cid)[1]
    forged = event_hash(e.prev_hash, cid, 1, e.ts, e.type, {"tampered": True})
    con = sqlite3.connect(str(store.data_dir() / "cases.db"))
    con.execute("UPDATE events SET payload_json=?, hash=? WHERE case_id=? AND seq=1",
                ('{"tampered": true}', forged, cid))
    con.commit()
    con.close()
    assert store.verify_chain(cid) == {"ok": False, "bad_seq": 2}


def test_state_roundtrip_and_validation():
    cid = store.open_case("c", "m")
    store.set_state(cid, "VERIFYING")
    assert store.get_case(cid)[0] == "VERIFYING"
    try:
        store.set_state(cid, "BOGUS")
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError")


def _numbers(obj, acc):
    if isinstance(obj, bool):
        return
    if isinstance(obj, (int, float)):
        acc.add(float(obj))
    elif isinstance(obj, dict):
        for v in obj.values():
            _numbers(v, acc)
    elif isinstance(obj, list):
        for v in obj:
            _numbers(v, acc)


def test_packet_is_draft_and_evidence_numbers_are_in_events():
    cid = _case_with_events()
    pk = writer.write_packet(cid)
    assert "DRAFT for BSA officer review" in pk["sar_draft"]
    assert "FIN-2024-Alert004" in pk["sar_draft"]
    assert pk["chain"] == {"ok": True, "bad_seq": None}
    assert pk["generated_by"] == "template"
    assert pk["evidence"] and pk["timeline"] and pk["summary"]
    seen: set[float] = set()
    for e in store.events(cid):
        _numbers(e.payload, seen)
    for row in pk["evidence"]:
        for k in ("start", "end", "value"):
            if isinstance(row[k], (int, float)) and not isinstance(row[k], bool):
                assert float(row[k]) in seen
    assert (store.data_dir() / "cases" / f"{cid}.packet.md").exists()
