"""Build and adapt mock ToolRecords (used for fixtures and for the MOCK_TOOLS=1 manager)."""
from __future__ import annotations

from typing import Any

from contracts.models import ToolRecord
from tools_manager.cards import VERSION

VALIDITY = {"min_duration_s": 1.0, "sample_rate": 16000}


def _r(v: float) -> float:
    return round(float(v), 3)


def _level(levels: list[tuple[float, float, float]], s: float, e: float) -> float:
    """Overlap-weighted mean of piecewise-constant levels over [s, e]."""
    tot = acc = 0.0
    for a, b, p in levels:
        ov = max(0.0, min(e, b) - max(s, a))
        tot += ov
        acc += ov * p
    return acc / tot if tot else 0.05


def window_track(levels: list[tuple[float, float, float]], start: float, end: float, window_s: float, hop_s: float) -> list[dict]:
    out: list[dict] = []
    t = start
    while t + window_s <= end + 1e-9:
        out.append({"start": _r(t), "end": _r(t + window_s), "p_fake": _r(_level(levels, t, t + window_s))})
        t += hop_s
    return out


def _rec(tool: str, clip_id: str, params: dict, values: dict, flags: list[str] | None = None) -> ToolRecord:
    return ToolRecord(
        tool=tool, version=VERSION, clip_id=clip_id, params=params, status="ok", values=values,
        validity=dict(VALIDITY), flags=flags or [], runtime_ms=40, error=None,
    )


def benign_spec(duration: float) -> dict[str, Any]:
    """G1-style spec: one real speaker, nothing suspicious."""
    return {
        "duration": duration,
        "turns": [{"speaker": "S1", "start": 0.0, "end": duration, "A": 0.04, "B": 0.06}],
        "clip_A": 0.04, "clip_B": 0.06,
        "levels_A": [(0.0, duration, 0.04)], "levels_B": [(0.0, duration, 0.06)],
        "cps": [], "rescore": [], "mos": 3.6,
    }


def build_records(clip_id: str, spec: dict[str, Any]) -> dict[str, ToolRecord]:
    """Records keyed '<tool>__<detector or none>' for one clip spec."""
    d = spec["duration"]
    turns = [{"idx": i, "speaker": t["speaker"], "start": t["start"], "end": t["end"]} for i, t in enumerate(spec["turns"])]
    too_short = [(t["end"] - t["start"]) < 1.0 for t in turns]
    recs: dict[str, ToolRecord] = {}
    recs["get_context__none"] = _rec(
        "get_context", clip_id, {},
        {
            "duration_s": d,
            "speech_segments": [{"start": t["start"], "end": t["end"]} for t in turns],
            "turns": turns,
            "language": "en", "language_conf": 0.98,
            "per_turn": [
                {"idx": i, "bandwidth_hz": 3400, "clipping_frac": 0.0, "snr_db": spec.get("snr_db", 24.0), "too_short": too_short[i]}
                for i in range(len(turns))
            ],
            "mos": spec.get("mos", 3.4),
        },
        flags=["too_short"] if any(too_short) else [],
    )
    for det in ("A", "B"):
        recs[f"score_turns__{det}"] = _rec(
            "score_turns", clip_id, {"detector": det},
            {
                "detector": det,
                "turns": [
                    {"idx": i, "start": t["start"], "end": t["end"], "p_fake": _r(spec["turns"][i][det]), "too_short": too_short[i]}
                    for i, t in enumerate(turns)
                ],
                "clip_p_fake": _r(spec[f"clip_{det}"]),
            },
        )
        recs[f"score_windows__{det}"] = _rec(
            "score_windows", clip_id,
            {"detector": det, "start": 0.0, "end": d, "window_s": 2, "hop_s": 1},
            {
                "detector": det, "window_s": 2, "hop_s": 1, "start": 0.0, "end": d,
                "windows": window_track(spec[f"levels_{det}"], 0.0, d, 2, 1),
            },
        )
    for det, s, e, p in spec["rescore"]:
        recs[f"rescore_region__{det}"] = _rec(
            "rescore_region", clip_id, {"detector": det, "start": s, "end": e, "context_s": 30},
            {"detector": det, "start": s, "end": e, "context_s": 30, "p_fake": _r(p)},
        )
    recs["find_boundaries__none"] = _rec(
        "find_boundaries", clip_id, {"start": 0.0, "end": d, "signals": ["p_fake", "speaker", "channel"]},
        {
            "start": 0.0, "end": d, "signals": ["p_fake", "speaker", "channel"],
            "change_points": [{"t": t, "moved": m, "delta": _r(dl)} for t, m, dl in spec["cps"]],
        },
    )
    if len(turns) >= 2:
        a, b = (0, 1)
        same = turns[a]["speaker"] == turns[b]["speaker"]
        recs["speaker_consistency__none"] = _rec(
            "speaker_consistency", clip_id, {"turn_a": a, "turn_b": b},
            {"turn_a": a, "turn_b": b, "cosine": 0.87 if same else 0.12, "same_speaker": same},
        )
    return recs


# ---- adapters: turn a base (fixture) record into the record for the actual call params ----

def adapt(base: ToolRecord, clip_id: str, args: dict, context: ToolRecord | None, turn_scores: dict[str, ToolRecord]) -> ToolRecord:
    """Return a record for `args`, derived from the fixture record `base` where params differ."""
    params = {k: v for k, v in args.items() if k != "clip_id"}
    rec = base.model_copy(deep=True)
    rec.clip_id = clip_id
    rec.params = params
    vals = rec.values
    if base.tool == "score_windows":
        s, e = float(params.get("start", 0.0)), float(params.get("end", vals.get("end", 1e9)))
        vals["windows"] = [w for w in vals["windows"] if w["start"] >= s - 1e-9 and w["end"] <= e + 1e-9]
        vals["start"], vals["end"] = s, e
    elif base.tool == "find_boundaries":
        s, e = float(params.get("start", 0.0)), float(params.get("end", vals.get("end", 1e9)))
        sigs = params.get("signals") or ["p_fake", "speaker", "channel"]
        vals["change_points"] = [c for c in vals["change_points"] if s <= c["t"] <= e and c["moved"] in sigs]
        vals["start"], vals["end"], vals["signals"] = s, e, list(sigs)
    elif base.tool == "rescore_region":
        vals.update({"start": params["start"], "end": params["end"], "context_s": params.get("context_s", 30)})
    return rec


def derive_rescore(clip_id: str, args: dict, turn_scores: dict[str, ToolRecord]) -> ToolRecord:
    """rescore_region for a range with no fixture: the overlapping turn's score from that detector."""
    det, s, e = args["detector"], float(args["start"]), float(args["end"])
    p = 0.05
    ts = turn_scores.get(det)
    if ts is not None:
        best = 0.0
        for t in ts.values["turns"]:
            ov = max(0.0, min(e, t["end"]) - max(s, t["start"]))
            if ov > best:
                best, p = ov, t["p_fake"]
    params = {k: v for k, v in args.items() if k != "clip_id"}
    return _rec("rescore_region", clip_id, params,
                {"detector": det, "start": s, "end": e, "context_s": args.get("context_s", 30), "p_fake": _r(p)})


def derive_speaker(clip_id: str, args: dict, context: ToolRecord | None) -> ToolRecord:
    a, b = int(args["turn_a"]), int(args["turn_b"])
    same = True
    if context is not None:
        turns = {t["idx"]: t["speaker"] for t in context.values["turns"]}
        same = turns.get(a) == turns.get(b)
    params = {k: v for k, v in args.items() if k != "clip_id"}
    return _rec("speaker_consistency", clip_id, params,
                {"turn_a": a, "turn_b": b, "cosine": 0.87 if same else 0.12, "same_speaker": same})
