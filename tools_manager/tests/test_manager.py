import json
import time
from pathlib import Path

import pytest

from contracts.models import AnalysisResult, ToolCard, ToolRecord, TraceEvent
from tools_manager import manager

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "contracts" / "fixtures"
CID = {v: k for k, v in json.loads((ROOT / "data" / "golden" / "index.json").read_text()).items()}


@pytest.fixture(autouse=True)
def mock_env(monkeypatch):
    monkeypatch.setenv("MOCK_TOOLS", "1")
    manager.clear_cache()


def test_fixtures_validate_against_models():
    for f in (FIX / "tool_records").rglob("*.json"):
        ToolRecord.model_validate_json(f.read_text())
    for f in (FIX / "analysis").glob("*.json"):
        AnalysisResult.model_validate_json(f.read_text())
    for line in (FIX / "trace" / "G3.jsonl").read_text().splitlines():
        TraceEvent.model_validate_json(line)
    cards = [ToolCard.model_validate(c) for c in json.loads((FIX / "tool_cards.json").read_text())]
    assert len(cards) == 8 and len(manager.list_cards()) == 8


def test_g3_all_required_tools_serve_fixtures():
    cid = CID["G3"]
    calls = [("get_context", {}), ("score_turns", {"detector": "A"}), ("score_turns", {"detector": "B"}),
             ("score_windows", {"detector": "B", "window_s": 2, "hop_s": 1}),
             ("rescore_region", {"detector": "A", "start": 0.0, "end": 3.0}),
             ("find_boundaries", {}), ("speaker_consistency", {"turn_a": 0, "turn_b": 1})]
    recs = {(n, a.get("detector")): manager.call_tool(n, {"clip_id": cid, **a}) for n, a in calls}
    assert all(r.status == "ok" for r in recs.values())
    a, b = recs[("score_turns", "A")].values, recs[("score_turns", "B")].values
    assert abs(a["turns"][0]["p_fake"] - b["turns"][0]["p_fake"]) > 0.3
    assert a["clip_p_fake"] < a["turns"][0]["p_fake"]
    assert recs[("rescore_region", "A")].values["p_fake"] > 0.8


def test_cache_is_fast_and_identical():
    args = {"clip_id": CID["G3"], "detector": "B"}
    first = manager.call_tool("score_turns", args)
    t0 = time.perf_counter()
    again = manager.call_tool("score_turns", args)
    assert time.perf_counter() - t0 < 0.01
    assert first.values == again.values


def test_bad_input_never_raises():
    assert manager.call_tool("score_turns", {"clip_id": CID["G3"], "detector": "Z"}).status == "invalid_input"
    assert manager.call_tool("score_turns", {"clip_id": CID["G3"]}).status == "invalid_input"
    assert manager.call_tool("nope", {"clip_id": CID["G3"]}).status == "invalid_input"
    assert manager.call_tool("get_context", {"clip_id": "f" * 64}).status == "failed"
    assert manager.call_tool("get_context", None).status in ("failed", "invalid_input")  # type: ignore[arg-type]
    assert manager.call_tool("localize", {"clip_id": CID["G3"], "start": 0, "end": 2}).status == "failed"


def test_unknown_ingested_clip_gets_benign_records(tmp_path, monkeypatch):
    from intake import store

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    data = (ROOT / "data" / "golden" / "G1.wav").read_bytes()
    # trim to 3 s so the clip_id is not a golden one
    import subprocess

    src = tmp_path / "g1.wav"
    src.write_bytes(data)
    out = tmp_path / "trim.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-t", "3", str(out)], check=True)
    meta = store.ingest(out.read_bytes(), "trim.wav")
    assert store.golden_name(meta.clip_id) is None
    ctx = manager.call_tool("get_context", {"clip_id": meta.clip_id})
    assert ctx.status == "ok" and ctx.values["turns"][0]["end"] == pytest.approx(3.0, abs=0.01)
    assert manager.call_tool("rescore_region", {"clip_id": meta.clip_id, "detector": "A", "start": 0, "end": 3}).values["p_fake"] < 0.2


def test_anthropic_tools_shape():
    tools = manager.anthropic_tools()
    assert {t["name"] for t in tools} >= {"get_context", "score_turns", "rescore_region", "find_boundaries"}
    for t in tools:
        assert t["input_schema"]["type"] == "object" and t["description"]
