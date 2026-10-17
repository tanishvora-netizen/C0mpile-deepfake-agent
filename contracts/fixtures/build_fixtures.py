"""Write contracts/fixtures from the golden clip specs.

uv run python -m contracts.fixtures.build_fixtures

Writes tool records, tool cards and transcripts, then regenerates analysis/G1..G6 and trace/G3 by running the real
mock orchestrator (adaptive mode, MOCK_TOOLS=1 MOCK_LLM=1) over those records. Everything is validated against
contracts.models. Run it again whenever the mock orchestrator or the specs change.
"""
from __future__ import annotations

import json
from pathlib import Path

from contracts.models import AnalysisResult, ToolCard, ToolRecord, TraceEvent
from tools_manager.cards import CARDS
from tools_manager.mock_records import build_records

ROOT = Path(__file__).resolve().parents[2]
FIX = ROOT / "contracts" / "fixtures"
GOLDEN = ROOT / "data" / "golden"


def _t(speaker: str, s: float, e: float, a: float, b: float) -> dict:
    return {"speaker": speaker, "start": s, "end": e, "A": a, "B": b}


SPECS: dict[str, dict] = {
    "G1": {
        "duration": 6.0, "turns": [_t("S1", 0.0, 6.0, 0.04, 0.06)], "clip_A": 0.04, "clip_B": 0.06,
        "levels_A": [(0.0, 6.0, 0.04)], "levels_B": [(0.0, 6.0, 0.06)], "cps": [], "rescore": [],
    },
    "G2": {
        "duration": 6.0, "turns": [_t("S1", 0.0, 6.0, 0.93, 0.95)], "clip_A": 0.93, "clip_B": 0.95,
        "levels_A": [(0.0, 6.0, 0.93)], "levels_B": [(0.0, 6.0, 0.95)], "cps": [], "rescore": [],
    },
    # G3 demo: detectors disagree on turn 0 (A 0.42 vs B 0.93); A's whole-clip score (0.19) is below its turn-0 score.
    "G3": {
        "duration": 7.0,
        "turns": [_t("S1", 0.0, 3.0, 0.42, 0.93), _t("S2", 3.0, 7.0, 0.06, 0.09)],
        "clip_A": 0.19, "clip_B": 0.51,
        "levels_A": [(0.0, 3.0, 0.42), (3.0, 7.0, 0.06)], "levels_B": [(0.0, 3.0, 0.93), (3.0, 7.0, 0.09)],
        "cps": [(3.0, "p_fake", 0.84), (3.0, "speaker", 0.90)],
        "rescore": [("A", 0.0, 3.0, 0.87), ("B", 0.0, 3.0, 0.95)],
    },
    "G4": {
        "duration": 7.0, "turns": [_t("S1", 0.0, 3.5, 0.05, 0.08), _t("S2", 3.5, 7.0, 0.07, 0.05)],
        "clip_A": 0.06, "clip_B": 0.06,
        "levels_A": [(0.0, 3.5, 0.05), (3.5, 7.0, 0.07)], "levels_B": [(0.0, 3.5, 0.08), (3.5, 7.0, 0.05)],
        "cps": [(3.5, "speaker", 0.88)], "rescore": [],
    },
    # G5: diarization sees one speaker; the 3 s insert only shows in the window track and change points.
    "G5": {
        "duration": 8.0, "turns": [_t("S1", 0.0, 8.0, 0.26, 0.39)], "clip_A": 0.26, "clip_B": 0.39,
        "levels_A": [(0.0, 2.5, 0.05), (2.5, 5.5, 0.60), (5.5, 8.0, 0.05)],
        "levels_B": [(0.0, 2.5, 0.08), (2.5, 5.5, 0.92), (5.5, 8.0, 0.06)],
        "cps": [(2.5, "p_fake", 0.84), (5.5, "p_fake", 0.86)], "rescore": [],
    },
    # G6: G3 plus a music bed; B is less sure on turn 0 (disagreement 0.32 -> adaptive rescoring).
    "G6": {
        "duration": 7.0,
        "turns": [_t("S1", 0.0, 3.0, 0.30, 0.62), _t("S2", 3.0, 7.0, 0.10, 0.22)],
        "clip_A": 0.17, "clip_B": 0.35, "snr_db": 10.0, "mos": 2.6,
        "levels_A": [(0.0, 3.0, 0.30), (3.0, 7.0, 0.10)], "levels_B": [(0.0, 3.0, 0.62), (3.0, 7.0, 0.22)],
        "cps": [(3.0, "p_fake", 0.40), (3.0, "speaker", 0.85), (3.0, "channel", 0.30)],
        "rescore": [("A", 0.0, 3.0, 0.81), ("B", 0.0, 3.0, 0.88)],
    },
}

TRANSCRIPT_G3 = [
    {"start": 0, "end": 3, "text": "Grandma, it's Jake, I'm in trouble"},
    {"start": 3, "end": 7, "text": "This is Attorney Mark Reyes. Jake is being held and I need a $9,500 wire today to post bail."},
]


def _dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n")


def clip_ids() -> dict[str, str]:
    idx = json.loads((GOLDEN / "index.json").read_text())
    return {name: cid for cid, name in idx.items()}


def main() -> None:
    cids = clip_ids()
    for card in CARDS:
        ToolCard.model_validate(card.model_dump())
    _dump(FIX / "tool_cards.json", [c.model_dump() for c in CARDS])
    _dump(FIX / "transcripts" / "G3.json", TRANSCRIPT_G3)
    for name, spec in SPECS.items():
        recs = build_records(cids[name], spec)
        for key, rec in recs.items():
            ToolRecord.model_validate(rec.model_dump())
            _dump(FIX / "tool_records" / name / f"{key}.json", rec.model_dump())
    print(f"tool records written under {FIX}")
    regenerate_from_orchestrator(cids)


def regenerate_from_orchestrator(cids: dict[str, str]) -> None:
    """Overwrite analysis/G*.json and trace/G3.jsonl with real mock-adaptive runs (MOCK_TOOLS=1 MOCK_LLM=1)."""
    import os

    os.environ["MOCK_TOOLS"] = "1"
    os.environ["MOCK_LLM"] = "1"
    from orchestrator.run import analyze

    for name, cid in cids.items():
        events: list[TraceEvent] = []
        result = analyze(cid, "adaptive", on_event=events.append, trace_id=f"fixture-{name.lower()}")
        result.usage["seconds"] = 0.4  # keep fixtures byte-stable
        events[-1].payload["usage"]["seconds"] = 0.4
        AnalysisResult.model_validate(result.model_dump())
        _dump(FIX / "analysis" / f"{name}.json", result.model_dump())
        if name == "G3":
            (FIX / "trace").mkdir(exist_ok=True)
            (FIX / "trace" / "G3.jsonl").write_text("".join(e.model_dump_json() + "\n" for e in events))
    print("analysis + trace regenerated from the mock orchestrator")


if __name__ == "__main__":
    main()
