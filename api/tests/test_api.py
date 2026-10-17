import json
import time

import pytest
from fastapi.testclient import TestClient

from api.app import app

WAV = b"RIFF" + b"\x01" * 4000  # content is irrelevant: intake is stubbed


@pytest.fixture
def client(stubs):
    with TestClient(app) as c:
        yield c


def _events(body: str) -> list[dict]:
    return [json.loads(line[5:].strip()) for line in body.splitlines() if line.startswith("data:")]


def _upload_and_analyze(client, mode="adaptive") -> tuple[str, str]:
    r = client.post("/clips", files={"file": ("G3.wav", WAV, "audio/wav")})
    assert r.status_code == 200, r.text
    clip_id = r.json()["clip_id"]
    r = client.post("/analyze", json={"clip_id": clip_id, "mode": mode})
    assert r.status_code == 200
    return clip_id, r.json()["job_id"]


def _wait_result(client, job_id: str) -> dict:
    for _ in range(100):
        r = client.get(f"/analyze/{job_id}")
        if r.status_code == 200:
            return r.json()
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_stream_replays_in_order_and_ends_with_final(client):
    _, job_id = _upload_and_analyze(client)
    body = client.get(f"/analyze/{job_id}/stream").text
    evs = _events(body)
    assert [e["seq"] for e in evs] == [0, 1, 2, 3]
    assert evs[-1]["kind"] == "final"
    # a second, late subscriber replays everything from seq 0
    assert [e["seq"] for e in _events(client.get(f"/analyze/{job_id}/stream").text)] == [0, 1, 2, 3]
    res = _wait_result(client, job_id)
    assert res["system"] == "adaptive" and res["segments"][0]["label"] == "synthetic"


def test_final_synthesized_when_orchestrator_emits_none(client, stubs):
    from policy_actions.tests.g3 import g3_result

    stubs.analyze = lambda clip_id, mode, model=None, on_event=None: g3_result(clip_id)
    _, job_id = _upload_and_analyze(client)
    evs = _events(client.get(f"/analyze/{job_id}/stream").text)
    assert [e["kind"] for e in evs] == ["final"]


def test_job_error_streams_error_event(client, stubs):
    def boom(*a, **k):
        raise RuntimeError("tool exploded")

    stubs.analyze = boom
    _, job_id = _upload_and_analyze(client)
    evs = _events(client.get(f"/analyze/{job_id}/stream").text)
    assert evs[-1]["kind"] == "error"
    assert client.get(f"/analyze/{job_id}").status_code == 500


def test_bad_inputs(client):
    assert client.post("/clips", files={"file": ("x.wav", b"abc", "audio/wav")}).status_code == 422
    assert client.post("/analyze", json={"clip_id": "nope", "mode": "adaptive"}).status_code == 404
    assert client.post("/analyze", json={"clip_id": "nope", "mode": "weird"}).status_code == 422
    assert client.get("/analyze/job_x").status_code == 404
    assert client.get("/cases/case_x").status_code == 404
    assert client.get("/transfers/tx_x").status_code == 404
    assert client.get("/approve/nope").status_code == 404
    assert client.post("/cases/from-analysis", json={"job_id": "job_x", "member_id": "grandma"}).status_code == 404


def test_golden_list_and_cors(client):
    names = {g["name"] for g in client.get("/clips/golden").json()}
    assert "G3" in names  # data/golden/*.wav ingested on startup
    r = client.options("/clips/golden", headers={"Origin": "http://localhost:5173",
                                                 "Access-Control-Request-Method": "GET"})
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_eval_results_404_then_served(client, tmp_path, monkeypatch):
    import api.app as m

    monkeypatch.setattr(m, "ROOT", tmp_path)
    assert client.get("/eval/results").status_code == 404
    (tmp_path / "results").mkdir()
    (tmp_path / "results" / "results.json").write_text('{"provenance": "mock"}')
    assert client.get("/eval/results").json() == {"provenance": "mock"}


def test_g3_end_to_end(client):
    _, job_id = _upload_and_analyze(client)
    _wait_result(client, job_id)

    r = client.post("/cases/from-analysis", json={"job_id": job_id, "member_id": "grandma"})
    assert r.status_code == 200, r.text
    case = r.json()
    case_id = case["case_id"]
    assert [a["type"] for a in case["actions"]] == ["verify_contact", "hold_new_payee", "notify_trusted_contact"]
    assert case["state"] == "VERIFYING" and case["chain"]["ok"] is True
    assert [e["type"] for e in case["events"][:2]] == ["clip_ingested", "analysis_done"]

    t = client.post("/bank/transfers", json={"member_id": "grandma", "payee": "Acme Legal Trust",
                                             "amount": 9500, "new_payee": True}).json()
    assert t["state"] == "HELD" and t["token"] and "Jake" in t["reason"]
    page = client.get(f"/approve/{t['token']}").json()
    assert page["amount"] == 9500 and page["payee"] == "Acme Legal Trust"
    assert set(client.get(f"/transfers/{t['id']}").json()) == {"id", "state", "amount", "payee", "reason"}

    r = client.post("/dev/simulate-reply", json={"case_id": case_id, "reply": "NO"})
    assert r.json()["state"] == "CONTRADICTED"
    assert client.get(f"/cases/{case_id}").json()["state"] == "CONTRADICTED"
    assert client.get(f"/transfers/{t['id']}").json()["state"] == "HELD"

    pk = client.get(f"/cases/{case_id}/packet").json()
    assert pk["chain"]["ok"] is True and "DRAFT for BSA officer review" in pk["sar_draft"]

    assert client.post(f"/bank/transfers/{t['id']}/decline", json={"token": "bad"}).status_code == 403
    r = client.post(f"/bank/transfers/{t['id']}/decline", json={"token": t["token"]})
    assert r.json()["state"] == "DECLINED"
    assert client.post(f"/bank/transfers/{t['id']}/approve", json={"token": t["token"]}).status_code == 409


def test_g3_yes_releases_and_sms_webhook(client):
    _, job_id = _upload_and_analyze(client)
    _wait_result(client, job_id)
    case_id = client.post("/cases/from-analysis", json={"job_id": job_id, "member_id": "grandma"}).json()["case_id"]
    t = client.post("/bank/transfers", json={"member_id": "grandma", "payee": "P", "amount": 9500,
                                             "new_payee": True}).json()
    r = client.post("/twilio/sms", data={"From": "+15550100001", "Body": "YES"})
    assert r.status_code == 200 and "<Response" in r.text
    assert client.get(f"/cases/{case_id}").json()["state"] == "VERIFIED"
    assert client.get(f"/transfers/{t['id']}").json()["state"] == "RELEASED"


def test_clean_clip_no_actions_transfer_passes(client, stubs):
    from policy_actions.tests.g3 import g1_result

    stubs.analyze = lambda clip_id, mode, model=None, on_event=None: g1_result(clip_id)
    _, job_id = _upload_and_analyze(client)
    _wait_result(client, job_id)
    case = client.post("/cases/from-analysis", json={"job_id": job_id, "member_id": "grandma"}).json()
    assert case["actions"] == []
    t = client.post("/bank/transfers", json={"member_id": "grandma", "payee": "P", "amount": 9500,
                                             "new_payee": True}).json()
    assert t["state"] == "PENDING"


def test_simulate_reply_disabled_when_not_mock(client, monkeypatch):
    monkeypatch.setenv("MOCK_TWILIO", "0")
    assert client.post("/dev/simulate-reply", json={"case_id": "c", "reply": "NO"}).status_code == 404
