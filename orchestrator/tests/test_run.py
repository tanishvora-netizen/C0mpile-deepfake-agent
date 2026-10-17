import json
from pathlib import Path

import pytest

from contracts.models import AnalysisResult, Evidence, Segment, ToolRecord, TraceEvent
from orchestrator import run as run_mod
from orchestrator.run import Caps, analyze
from orchestrator.validate import check
from tools_manager import manager

ROOT = Path(__file__).resolve().parents[2]
CID = {v: k for k, v in json.loads((ROOT / "data" / "golden" / "index.json").read_text()).items()}


@pytest.fixture(autouse=True)
def mock_env(monkeypatch):
    monkeypatch.setenv("MOCK_TOOLS", "1")
    monkeypatch.setenv("MOCK_LLM", "1")
    manager.clear_cache()


def _run(name, mode, **kw):
    events: list[TraceEvent] = []
    return analyze(CID[name], mode, on_event=events.append, **kw), events


def _labels(r: AnalysisResult) -> list[str]:
    return [s.label for s in r.segments]


def test_adaptive_g3_calls_rescore_and_labels_handoff():
    r, ev = _run("G3", "adaptive")
    calls = [e.payload["tool"] for e in ev if e.kind == "tool_call"]
    assert calls == ["get_context", "score_turns", "score_turns", "find_boundaries", "rescore_region"]
    assert _labels(r) == ["synthetic", "bona_fide"] and r.mixed and r.composition == "speaker_handoff"
    assert [e.seq for e in ev] == list(range(len(ev))) and ev[-1].kind == "final"
    assert ev[-1].payload["clip_id"] == CID["G3"] and r.abstain is None and r.system == "adaptive"
    fixture = AnalysisResult.model_validate_json((ROOT / "contracts/fixtures/analysis/G3.json").read_text())
    assert _labels(fixture) == _labels(r)


def test_adaptive_g1_never_rescores():
    r, ev = _run("G1", "adaptive")
    assert "rescore_region" not in [e.payload.get("tool") for e in ev]
    assert _labels(r) == ["bona_fide"] and not r.mixed and r.composition == "none"


@pytest.mark.parametrize("name", ["G1", "G2", "G3", "G4", "G5", "G6"])
def test_fixed_and_adaptive_return_valid_results(name):
    for mode in ("fixed", "adaptive"):
        r, _ = _run(name, mode)
        AnalysisResult.model_validate(r.model_dump())
        assert r.abstain is None or mode == "fixed"


def test_fixed_g3_and_g4():
    assert _labels(_run("G3", "fixed")[0]) == ["synthetic", "bona_fide"]
    r4 = _run("G4", "fixed")[0]
    assert "synthetic" not in _labels(r4) and not r4.mixed


def test_tool_call_cap_gives_budget_exceeded():
    for mode in ("fixed", "adaptive"):
        r, ev = _run("G3", mode, caps=Caps(max_tool_calls=2))
        assert r.abstain == "budget_exceeded" and ev[-1].kind == "final"


def test_failed_score_turns_abstains_naming_tool(monkeypatch):
    real = manager.call_tool

    def flaky(name, args):
        if name == "score_turns" and args.get("detector") == "B":
            return ToolRecord(tool=name, version="0", clip_id=args["clip_id"], params={}, status="failed", values={}, validity={},
                              runtime_ms=0, error="worker down")
        return real(name, args)

    monkeypatch.setattr(manager, "call_tool", flaky)
    r, _ = _run("G3", "adaptive")
    assert r.abstain == "tool_failed:score_turns"


def test_baseline_mode_delegates():
    r, ev = _run("G3", "baseline")
    assert r.system == "baseline" and _labels(r) == ["synthetic", "bona_fide"]
    assert ev[-1].kind == "final" and ev[0].kind == "tool_call"


def test_validator_rejects_invented_score_and_overlap():
    rec = manager.call_tool("score_turns", {"clip_id": CID["G3"], "detector": "B"})
    seg = {"speaker": "S1", "label": "synthetic", "evidence": [Evidence(tool="score_turns", field="x", value=1.0)]}
    base = {"clip_id": "c", "system": "adaptive", "model": None, "mixed": False, "composition": "none",
            "summary": "s", "trace_id": "t", "usage": {}}
    good = AnalysisResult(segments=[Segment(start=0, end=3, tool_score=0.93, **seg)], **base)
    assert check(good, [rec], 7.0) is None
    bad = AnalysisResult(segments=[Segment(start=0, end=3, tool_score=0.77, **seg)], **base)
    assert "does not appear" in (check(bad, [rec], 7.0) or "")
    over = AnalysisResult(segments=[Segment(start=0, end=3, tool_score=0.93, **seg), Segment(start=2, end=4, tool_score=0.93, **seg)], **base)
    assert "overlaps" in (check(over, [rec], 7.0) or "")


def test_unknown_clip_does_not_raise():
    r = analyze("f" * 64, "adaptive")
    assert r.abstain is not None and run_mod.Caps().max_tool_calls == 12
