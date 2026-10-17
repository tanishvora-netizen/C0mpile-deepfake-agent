"""Deterministic evidence helpers shared by the mock LLM and the no-LLM baseline."""
from __future__ import annotations

import itertools

from contracts.models import Evidence, Segment, ToolRecord

DISAGREE = 0.3          # prompt rule: rescore_region when A and B differ on a turn by more than this
SPLIT_DELTA = 0.4       # a p_fake change point at least this large splits a turn
EDGE_MARGIN = 0.25      # change points this close to a turn edge are the edge itself


def ok(records: list[ToolRecord], tool: str, detector: str | None = None) -> list[ToolRecord]:
    return [r for r in records if r.tool == tool and r.status == "ok" and (detector is None or r.params.get("detector") == detector)]


def context(records: list[ToolRecord]) -> dict | None:
    r = ok(records, "get_context")
    return r[0].values if r else None


def turn_scores(records: list[ToolRecord], det: str) -> dict[int, float] | None:
    r = ok(records, "score_turns", det)
    return {t["idx"]: float(t["p_fake"]) for t in r[0].values["turns"]} if r else None


def change_points(records: list[ToolRecord]) -> list[dict]:
    out: list[dict] = []
    for r in ok(records, "find_boundaries"):
        out.extend(r.values.get("change_points", []))
    return out


def windows(records: list[ToolRecord], det: str = "B") -> list[dict]:
    seen: dict[tuple[float, float], dict] = {}
    for r in ok(records, "score_windows", det):
        for w in r.values.get("windows", []):
            seen[(w["start"], w["end"])] = w
    return sorted(seen.values(), key=lambda w: (w["start"], w["end"]))


def _mids(wins: list[dict], s: float, e: float) -> list[dict]:
    return [w for w in wins if s <= (w["start"] + w["end"]) / 2 < e]


def window_mean(wins: list[dict], s: float, e: float) -> float | None:
    inside = _mids(wins, s, e)
    return sum(w["p_fake"] for w in inside) / len(inside) if inside else None


def rep_window(wins: list[dict], s: float, e: float) -> float | None:
    """A real window value to cite as tool_score: the window whose midpoint is nearest the range centre."""
    inside = _mids(wins, s, e)
    if not inside:
        return None
    c = (s + e) / 2
    return min(inside, key=lambda w: abs((w["start"] + w["end"]) / 2 - c))["p_fake"]


def split_points(cps: list[dict], s: float, e: float) -> list[float]:
    return sorted({c["t"] for c in cps if c["moved"] == "p_fake" and c["delta"] >= SPLIT_DELTA
                   and s + EDGE_MARGIN < c["t"] < e - EDGE_MARGIN})


def label_of(p: float, lo: float, hi: float) -> str:
    return "synthetic" if p >= hi else ("bona_fide" if p <= lo else "uncertain")


def composition_of(segs: list[Segment]) -> tuple[bool, str]:
    definite = [s for s in segs if s.label != "uncertain"]
    labels = {s.label for s in definite}
    if labels != {"synthetic", "bona_fide"}:
        return False, "none"
    found = "splice"
    for a, b in itertools.pairwise(definite):
        if a.label != b.label:
            if a.speaker != b.speaker:
                return True, "speaker_handoff"
            found = "splice"
    return True, found


def _disagree_note(i: int, dets: dict[str, float], label: str, extra: str) -> str:
    names = " and ".join(dets)
    vals = " vs ".join(f"{v:.2f}" for v in dets.values())
    why = f"score_turns detectors {names} disagreed on turn {i} ({vals})" + (f"; {extra}" if extra else "")
    if label == "synthetic":
        return f"{why}, and all now agree it is synthetic"
    return f"{why}; a voice is only flagged when every detector agrees, so it counts as {label}"


def aggregate(records: list[ToolRecord], fixed: bool) -> dict:
    """What a careful aggregator would answer from these records (the Mock LLM's brain)."""
    ctx = context(records)
    pa, pb, pc = turn_scores(records, "A"), turn_scores(records, "B"), turn_scores(records, "C")
    if ctx is None or pa is None or pb is None:
        return {"segments": [], "mixed": False, "composition": "none", "abstain": "tool_failed:score_turns",
                "summary": "Abstained because a required tool failed."}
    wins, cps = windows(records, "B"), change_points(records)
    lo, hi = (0.4, 0.6) if fixed else (0.5, 0.5)
    segs: list[Segment] = []
    notes: list[str] = []
    per_turn = {p["idx"]: p for p in ctx.get("per_turn", [])}
    for t in ctx["turns"]:
        i, s, e = t["idx"], t["start"], t["end"]
        a, b = pa[i], pb[i]
        short = bool(per_turn.get(i, {}).get("too_short"))
        ev_ab = [Evidence(tool="score_turns", field=f"turns[{i}].p_fake (B)", value=b),
                 Evidence(tool="score_turns", field=f"turns[{i}].p_fake (A)", value=a)]
        if pc is not None:
            ev_ab.append(Evidence(tool="score_turns", field=f"turns[{i}].p_fake (C)", value=pc[i]))
        cuts = split_points(cps, s, e)
        if cuts and wins and not short:
            edges = [s, *cuts, e]
            det_wins = {d: w for d in ("A", "B", "C") if (w := windows(records, d))}
            for lo_e, hi_e in itertools.pairwise(edges):
                means = {d: m for d, w in det_wins.items() if (m := window_mean(w, lo_e, hi_e)) is not None}
                if not means:
                    segs.append(Segment(start=lo_e, end=hi_e, speaker=t["speaker"], label="uncertain", tool_score=None, evidence=ev_ab))
                    continue
                low = min(means, key=means.get)  # a stretch is AI only when every detector agrees
                rep = rep_window(det_wins[low], lo_e, hi_e)
                segs.append(Segment(
                    start=lo_e, end=hi_e, speaker=t["speaker"], label=label_of(means[low], lo, hi), tool_score=rep,  # type: ignore[arg-type]
                    evidence=[*[Evidence(tool="score_windows", field=f"windows.p_fake range mean ({d})", value=round(m, 3))
                                for d, m in sorted(means.items())],
                              Evidence(tool="find_boundaries", field="change_points.moved", value="p_fake")],
                ))
            notes.append(f"find_boundaries moved p_fake at {', '.join(f'{c:.1f}' for c in cuts)} s inside turn {i}, so it was split")
            continue
        resc = [r for r in ok(records, "rescore_region") if r.values["start"] <= s + 0.01 and r.values["end"] >= e - 0.01]
        ev: list[Evidence] = []
        if short:
            label, score = "uncertain", b
        elif not fixed and (resc or pc is not None or abs(a - b) > DISAGREE):
            dets = {"A": a, "B": b, **({"C": pc[i]} if pc is not None else {})}
            extra = ""
            if resc:
                pr, det = float(resc[-1].values["p_fake"]), resc[-1].values["detector"]
                dets[det] = pr  # the closer look replaces that detector's turn score
                ev.append(Evidence(tool="rescore_region", field=f"p_fake ({det}, {s:.1f}-{e:.1f} s, 30 s context)", value=pr))
                extra = f"rescore_region gave {pr:.2f}"
            score = min(dets.values())  # a voice is flagged only when every detector agrees
            label = label_of(score, lo, hi)
            if max(dets.values()) - score > DISAGREE:
                notes.append(_disagree_note(i, dets, label, extra))
        else:
            wm = window_mean(wins, s, e) if fixed else None
            vals = [a, b] + ([wm] if wm is not None else [])
            label, score = label_of(sum(vals) / len(vals), lo, hi), b
            if abs(a - b) > DISAGREE:
                notes.append(f"score_turns detectors A and B disagreed on turn {i} ({a:.2f} vs {b:.2f}); weighed with score_windows")
        segs.append(Segment(start=s, end=e, speaker=t["speaker"], label=label, tool_score=score, evidence=[*ev, *ev_ab]))  # type: ignore[arg-type]
    mixed, comp = composition_of(segs)
    shown = "; ".join(f"{x.speaker} {x.start:.1f}-{x.end:.1f} s {x.label}" for x in segs)
    notes = [n for n in notes if n]
    if not notes:
        notes.append("score_turns detectors A and B agree on every turn")
    cp_desc = ""
    if mixed:
        kinds = sorted({c["moved"] for c in cps if c["moved"] in ("p_fake", "speaker")})
        cp_desc = f" find_boundaries shows {' and '.join(kinds) or 'a change'} moving at the join, a {comp.replace('_', ' ')}."
    first = "; ".join(notes)
    head = first if "_" in first.split()[0] else first[0].upper() + first[1:]
    summary = f"{head}. Segments: {shown}.{cp_desc}"
    return {"segments": [s.model_dump() for s in segs], "mixed": mixed, "composition": comp, "abstain": None, "summary": summary}
