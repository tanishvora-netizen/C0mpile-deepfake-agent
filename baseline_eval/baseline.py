"""No-LLM localizing baseline (SPEC M5): average A and B per turn, threshold, split on p_fake change points."""
from __future__ import annotations

import itertools
import uuid
from collections.abc import Callable

from contracts.models import AnalysisResult, Evidence, Segment, ToolRecord
from orchestrator import evidence as ev
from tools_manager import manager

TAU = 0.5
OnCall = Callable[[str, dict, ToolRecord], None]


def run_baseline(clip_id: str, on_call: OnCall | None = None) -> AnalysisResult:
    """Never raises. Returns AnalysisResult(system='baseline')."""
    trace_id = uuid.uuid4().hex[:16]
    records: list[ToolRecord] = []

    def call(name: str, args: dict) -> ToolRecord:
        a = {"clip_id": clip_id, **args}
        rec = manager.call_tool(name, a)
        records.append(rec)
        if on_call:
            on_call(name, a, rec)
        return rec

    def result(segs: list[Segment], abstain: str | None, summary: str) -> AnalysisResult:
        mixed, comp = ev.composition_of(segs)
        return AnalysisResult(clip_id=clip_id, system="baseline", model=None, segments=segs, mixed=mixed, composition=comp,  # type: ignore[arg-type]
                              abstain=abstain, summary=summary, trace_id=trace_id,
                              usage={"input_tokens": 0, "output_tokens": 0, "tool_calls": len(records), "seconds": 0.0, "usd": 0.0})

    try:
        ctx = call("get_context", {})
        if ctx.status != "ok":
            return result([], "tool_failed:get_context", "Baseline abstained: get_context failed.")
        call("score_turns", {"detector": "A"})
        call("score_turns", {"detector": "B"})
        pa, pb = ev.turn_scores(records, "A"), ev.turn_scores(records, "B")
        if pa is None or pb is None:
            return result([], "tool_failed:score_turns", "Baseline abstained: score_turns failed.")
        d = ctx.values["duration_s"]
        for t in ctx.values["turns"]:
            call("score_windows", {"detector": "B", "start": t["start"], "end": t["end"], "window_s": 2, "hop_s": 1})
        call("find_boundaries", {"start": 0.0, "end": d, "signals": ["p_fake", "speaker", "channel"]})
        wins, cps = ev.windows(records, "B"), ev.change_points(records)
        segs: list[Segment] = []
        for t in ctx.values["turns"]:
            i, s, e = t["idx"], t["start"], t["end"]
            cuts = ev.split_points(cps, s, e)
            if cuts and wins:
                edges = [s, *cuts, e]
                for a, b in itertools.pairwise(edges):
                    m, rep = ev.window_mean(wins, a, b), ev.rep_window(wins, a, b)
                    if m is None or rep is None:
                        m, rep = (pa[i] + pb[i]) / 2, pb[i]
                    segs.append(Segment(start=a, end=b, speaker=t["speaker"], label="synthetic" if m > TAU else "bona_fide",
                                        tool_score=rep, evidence=[Evidence(tool="score_windows", field="windows.p_fake (B, range mean)", value=round(m, 3))]))
                continue
            m = (pa[i] + pb[i]) / 2
            segs.append(Segment(start=s, end=e, speaker=t["speaker"], label="synthetic" if m > TAU else "bona_fide", tool_score=pb[i],
                                evidence=[Evidence(tool="score_turns", field=f"turns[{i}].p_fake (B)", value=pb[i]),
                                          Evidence(tool="score_turns", field=f"turns[{i}].p_fake (A)", value=pa[i])]))
        shown = "; ".join(f"{x.speaker} {x.start:.1f}-{x.end:.1f} s {x.label}" for x in segs)
        return result(segs, None, f"Baseline labelled each turn by the mean of score_turns A and B at tau={TAU}. Segments: {shown}.")
    except Exception as exc:  # noqa: BLE001 - never raise
        return result([], "internal_error", f"Baseline failed: {type(exc).__name__}: {exc}")
