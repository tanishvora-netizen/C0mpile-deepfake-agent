"""Inline G3 / G1 AnalysisResult builders so tests do not depend on Agent A's fixtures."""
from contracts.models import AnalysisResult, Evidence, Segment

G3_CLIP = "g3" + "0" * 62
G1_CLIP = "g1" + "0" * 62


def g3_result(clip_id: str = G3_CLIP) -> AnalysisResult:
    return AnalysisResult(
        clip_id=clip_id, system="adaptive", model="claude-sonnet-5-5", mixed=True, composition="speaker_handoff",
        segments=[
            Segment(start=0.0, end=3.0, speaker="S1", label="synthetic", tool_score=0.93, evidence=[
                Evidence(tool="score_turns", field="p_fake_A", value=0.93),
                Evidence(tool="rescore_region", field="p_fake_B", value=0.88)]),
            Segment(start=3.0, end=7.0, speaker="S2", label="bona_fide", tool_score=0.07, evidence=[
                Evidence(tool="score_turns", field="p_fake_A", value=0.07)]),
        ],
        summary="Turn 0 synthetic per score_turns and rescore_region; turn 1 bona fide.",
        trace_id="trace-g3", usage={"tokens": 1234, "tool_calls": 5, "seconds": 1.2, "usd": 0.01},
    )


def g1_result(clip_id: str = G1_CLIP) -> AnalysisResult:
    return AnalysisResult(
        clip_id=clip_id, system="adaptive", model=None, mixed=False, composition="none",
        segments=[Segment(start=0.0, end=6.0, speaker="S1", label="bona_fide", tool_score=0.05, evidence=[
            Evidence(tool="score_turns", field="p_fake_A", value=0.05)])],
        summary="All bona fide per score_turns.", trace_id="trace-g1",
        usage={"tokens": 100, "tool_calls": 2, "seconds": 0.5, "usd": 0.0},
    )
