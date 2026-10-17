"""Real tools run in-process (MOCK_TOOLS=0 with TOOLS_BACKEND=local, the default when not mocking).

Same tool names and value shapes as the fixtures, but every number comes from the audio: turns from the
uploaded files or pauses, p_fake from the two local detectors in workers/detectors.py.
"""
from __future__ import annotations

import functools
import itertools
import time

import numpy as np

from contracts.models import ToolRecord
from workers import context, detectors

VALIDITY = {"min_duration_s": 1.0, "sample_rate": 16000}
SPEAKER_DELTA = 1.0
P_FAKE_JUMP = 0.3


@functools.lru_cache(maxsize=32)
def _audio(clip_id: str) -> np.ndarray:
    from intake import store

    return context.load_16k(store.get(clip_id).paths["16k"])


@functools.lru_cache(maxsize=32)
def _turns(clip_id: str) -> tuple[dict, ...]:
    from intake import store

    return tuple(context.turns(_audio(clip_id), store.sources(clip_id)))


@functools.lru_cache(maxsize=512)
def _score(clip_id: str, detector: str, start: float, end: float) -> float:
    x = _audio(clip_id)
    return detectors.p_fake(x[int(start * context.SR): int(end * context.SR)], detector)


def _clip_score(clip_id: str, detector: str) -> float:
    """Whole-call score: speech only, as one average (what a single-score system would report)."""
    x = _audio(clip_id)
    return _score(clip_id, detector, 0.0, round(len(x) / context.SR, 3))


def get_context(clip_id: str, params: dict) -> dict:
    x = _audio(clip_id)
    ts = [dict(t) for t in _turns(clip_id)]
    return {
        "duration_s": round(len(x) / context.SR, 3),
        "speech_segments": [{"start": a, "end": b} for a, b in context.speech_segments(x)],
        "turns": ts,
        "language": "unknown",
        "language_conf": 0.0,
        "per_turn": [{"idx": t["idx"], **context.channel_stats(x, t["start"], t["end"])} for t in ts],
    }


def score_turns(clip_id: str, params: dict) -> dict:
    det = params["detector"]
    rows = [{"idx": t["idx"], "start": t["start"], "end": t["end"],
             "p_fake": _score(clip_id, det, t["start"], t["end"]),
             "too_short": (t["end"] - t["start"]) < context.MIN_TURN_S} for t in _turns(clip_id)]
    return {"detector": det, "turns": rows, "clip_p_fake": _clip_score(clip_id, det)}


def score_windows(clip_id: str, params: dict) -> dict:
    det, w, hop = params["detector"], float(params["window_s"]), float(params.get("hop_s") or params["window_s"] / 2)
    s, e = float(params["start"]), float(params["end"])
    wins, t = [], s
    while t + w <= e + 1e-6 or not wins:
        hi = min(t + w, e)
        wins.append({"start": round(t, 2), "end": round(hi, 2), "p_fake": _score(clip_id, det, round(t, 2), round(hi, 2))})
        t += hop
        if hi >= e:
            break
    return {"detector": det, "window_s": w, "hop_s": hop, "start": s, "end": e, "windows": wins}


def rescore_region(clip_id: str, params: dict) -> dict:
    s, e = float(params["start"]), float(params["end"])
    return {"detector": params["detector"], "start": s, "end": e, "context_s": params.get("context_s", 30),
            "p_fake": _score(clip_id, params["detector"], s, e)}


def find_boundaries(clip_id: str, params: dict) -> dict:
    """Change points at the joins between turns: a new voice, and whether the AI score moved with it."""
    s, e = float(params["start"]), float(params["end"])
    ts = [t for t in _turns(clip_id) if t["end"] > s and t["start"] < e]
    cps = []
    for left, right in itertools.pairwise(ts):
        t = round((left["end"] + right["start"]) / 2, 2)
        if left["speaker"] != right["speaker"]:
            cps.append({"t": t, "moved": "speaker", "delta": SPEAKER_DELTA})
        both = [min(_score(clip_id, d, x["start"], x["end"]) for d in detectors.MODELS) for x in (left, right)]
        if abs(both[0] - both[1]) > P_FAKE_JUMP:
            cps.append({"t": t, "moved": "p_fake", "delta": round(abs(both[0] - both[1]), 3)})
    return {"start": s, "end": e, "signals": params.get("signals", []), "change_points": cps}


TOOLS = {
    "get_context": get_context,
    "score_turns": score_turns,
    "score_windows": score_windows,
    "rescore_region": rescore_region,
    "find_boundaries": find_boundaries,
}


def call(name: str, clip_id: str, params: dict, version: str) -> ToolRecord:
    t0 = time.perf_counter()
    fn = TOOLS.get(name)
    if fn is None:
        return ToolRecord(tool=name, version=version, clip_id=clip_id, params=params, status="failed",
                          values={}, validity=VALIDITY, runtime_ms=0, error=f"{name} is not available in local mode")
    values = fn(clip_id, params)
    flags = []
    if name == "score_turns" and any(r["too_short"] for r in values["turns"]):
        flags.append("too_short")
    return ToolRecord(tool=name, version=version, clip_id=clip_id, params=params, status="ok", values=values,
                      validity=VALIDITY, flags=flags, runtime_ms=int((time.perf_counter() - t0) * 1000))
