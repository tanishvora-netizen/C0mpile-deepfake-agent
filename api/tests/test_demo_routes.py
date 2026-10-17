import time

from fastapi.testclient import TestClient

from api import app as api_app
from api.app import app


def test_golden_audio_transcript_and_tamper(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    api_app.GOLDEN.clear()  # other tests leave stub clip ids behind
    with TestClient(app) as c:
        golden = {g["name"]: g for g in c.get("/clips/golden").json()}
        g3 = golden["G3"]
        assert g3["title"] == "Grandparent scam"
        audio = c.get(f"/clips/{g3['clip_id']}/audio")
        assert audio.status_code == 200 and audio.headers["content-type"] == "audio/wav"
        lines = c.get(f"/clips/{g3['clip_id']}/transcript").json()
        assert "Jake" in lines[0]["text"] and lines[1]["start"] == 3

        job = c.post("/analyze", json={"clip_id": g3["clip_id"], "mode": "adaptive"}).json()["job_id"]
        for _ in range(100):
            if c.get(f"/analyze/{job}").status_code == 200:
                break
            time.sleep(0.05)
        case = c.post("/cases/from-analysis", json={"job_id": job, "member_id": "grandma"}).json()
        assert c.get(f"/cases/{case['case_id']}").json()["chain"]["ok"] is True
        seq = c.post("/dev/tamper", json={"case_id": case["case_id"]}).json()["seq"]
        chain = c.get(f"/cases/{case['case_id']}").json()["chain"]
        assert chain == {"ok": False, "bad_seq": seq}
