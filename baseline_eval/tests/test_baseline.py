import json
from pathlib import Path

import pytest

from baseline_eval import run_eval
from baseline_eval.baseline import run_baseline

ROOT = Path(__file__).resolve().parents[2]
CID = {v: k for k, v in json.loads((ROOT / "data" / "golden" / "index.json").read_text()).items()}


@pytest.fixture(autouse=True)
def mock_env(monkeypatch):
    monkeypatch.setenv("MOCK_TOOLS", "1")
    monkeypatch.setenv("MOCK_LLM", "1")


def test_baseline_g3_labels_by_turn():
    r = run_baseline(CID["G3"])
    assert r.system == "baseline" and r.model is None
    assert [s.label for s in r.segments] == ["synthetic", "bona_fide"]
    assert r.mixed and r.composition == "speaker_handoff"


def test_baseline_g5_splits_turn_on_p_fake_change_points():
    r = run_baseline(CID["G5"])
    assert [(s.start, s.end, s.label) for s in r.segments] == [(0.0, 2.5, "bona_fide"), (2.5, 5.5, "synthetic"), (5.5, 8.0, "bona_fide")]
    assert r.composition == "splice"


def test_baseline_unknown_clip_abstains_not_raises():
    r = run_baseline("0" * 64)
    assert r.abstain and r.segments == []


def test_eval_table_rows_and_ordering(tmp_path, monkeypatch):
    res = run_eval.run()
    assert res["provenance"] == "mock"
    assert set(res["systems"]) == {"baseline", "fixed", "adaptive", "A alone (clip level)"}
    s = res["summary"]
    assert s["adaptive"]["mean_turn_accuracy"] >= s["baseline"]["mean_turn_accuracy"] > s["A alone (clip level)"]["mean_turn_accuracy"]
    assert "| adaptive |" in run_eval.table(res)
