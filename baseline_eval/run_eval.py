"""python -m baseline_eval.run_eval -> results/results.json + results/table.md (mock provenance)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GOLDEN = ROOT / "data" / "golden"
RESULTS = ROOT / "results"
NAMES = ["G1", "G2", "G3", "G4", "G5", "G6"]


def per_segment_accuracy(pred_segments: list[dict], expected: list[dict]) -> float:
    """Fraction of expected segments whose max-overlap predicted segment has the same label."""
    hits = 0
    for ex in expected:
        best, label = 0.0, None
        for p in pred_segments:
            ov = min(ex["end"], p["end"]) - max(ex["start"], p["start"])
            if ov > best:
                best, label = ov, p["label"]
        hits += int(label == ex["label"])
    return hits / len(expected)


def _a_alone(clip_id: str, expected: list[dict]) -> float:
    from tools_manager import manager

    rec = manager.call_tool("score_turns", {"clip_id": clip_id, "detector": "A"})
    label = "synthetic" if rec.status == "ok" and rec.values["clip_p_fake"] >= 0.5 else "bona_fide"
    return per_segment_accuracy([{"start": 0.0, "end": 1e9, "label": label}], expected)


def run() -> dict:
    os.environ.setdefault("MOCK_TOOLS", "1")
    os.environ.setdefault("MOCK_LLM", "1")
    from orchestrator.run import analyze

    expected = json.loads((GOLDEN / "expected.json").read_text())
    index = {v: k for k, v in json.loads((GOLDEN / "index.json").read_text()).items()}
    rows: dict[str, dict] = {}
    for system in ("baseline", "fixed", "adaptive"):
        per_clip: dict[str, dict] = {}
        for name in NAMES:
            r = analyze(index[name], system)  # type: ignore[arg-type]
            exp = expected[name]
            comp_ok = r.composition == exp["composition"] or r.composition in exp.get("composition_allowed", [])
            per_clip[name] = {
                "accuracy": per_segment_accuracy([s.model_dump() for s in r.segments], exp["segments"]),
                "mixed_ok": r.mixed == exp["mixed"], "composition_ok": comp_ok, "abstain": r.abstain,
                "tool_calls": r.usage.get("tool_calls", 0), "usd": r.usage.get("usd", 0.0),
            }
        rows[system] = per_clip
    rows["A alone (clip level)"] = {n: {"accuracy": _a_alone(index[n], expected[n]["segments"]), "mixed_ok": None,
                                        "composition_ok": None, "abstain": None, "tool_calls": 1, "usd": 0.0} for n in NAMES}
    summary = {}
    for system, per_clip in rows.items():
        accs = [c["accuracy"] for c in per_clip.values()]
        summary[system] = {
            "mean_turn_accuracy": sum(accs) / len(accs),
            "abstain_rate": sum(1 for c in per_clip.values() if c["abstain"]) / len(per_clip),
            "mean_tool_calls": sum(c["tool_calls"] for c in per_clip.values()) / len(per_clip),
        }
    return {"provenance": "mock", "note": "Mock tools and mock LLM on placeholder golden clips; not a real measurement.",
            "clips": NAMES, "systems": rows, "summary": summary}


def table(res: dict) -> str:
    head = "| System | " + " | ".join(res["clips"]) + " | Mean | Abstain | Tool calls |\n"
    head += "| --- |" + " --- |" * (len(res["clips"]) + 3) + "\n"
    lines = [head.rstrip("\n")]
    for system, per_clip in res["systems"].items():
        cells = " | ".join(f"{per_clip[n]['accuracy']:.2f}" for n in res["clips"])
        s = res["summary"][system]
        lines.append(f"| {system} | {cells} | {s['mean_turn_accuracy']:.2f} | {s['abstain_rate']:.2f} | {s['mean_tool_calls']:.1f} |")
    return ("Per-turn accuracy on G1 to G6 (provenance: mock; placeholder clips, mock tools, mock LLM).\n\n"
            + "\n".join(lines) + "\n")


def main() -> int:
    res = run()
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "results.json").write_text(json.dumps(res, indent=2) + "\n")
    (RESULTS / "table.md").write_text(table(res))
    print((RESULTS / "table.md").read_text())
    return 0


if __name__ == "__main__":
    sys.exit(main())
