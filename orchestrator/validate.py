"""Output validation (SPEC M4): pydantic parse, tool_score provenance, overlap and bounds."""
from __future__ import annotations

import json
import re

from contracts.models import AnalysisResult, ToolRecord


def parse_json(text: str) -> dict:
    """Pull the first JSON object out of an LLM reply (tolerates code fences and prose)."""
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON object in reply")
    obj, _ = json.JSONDecoder().raw_decode(text[start:])
    if not isinstance(obj, dict):
        raise TypeError("reply JSON is not an object")
    return obj


def _numbers(x: object) -> list[float]:
    if isinstance(x, bool):
        return []
    if isinstance(x, (int, float)):
        return [float(x)]
    if isinstance(x, dict):
        return [n for v in x.values() for n in _numbers(v)]
    if isinstance(x, list):
        return [n for v in x for n in _numbers(v)]
    return []


def check(result: AnalysisResult, records: list[ToolRecord], duration: float | None) -> str | None:
    """Return an error message, or None if the result is acceptable."""
    seen = [n for r in records if r.status == "ok" for n in _numbers(r.values)]
    last_end = 0.0
    for i, s in enumerate(sorted(result.segments, key=lambda s: s.start)):
        if s.end <= s.start:
            return f"segment {i} has end <= start"
        if s.start < last_end - 1e-6:
            return f"segment {i} overlaps the previous segment"
        last_end = s.end
        if s.start < -0.05 or (duration is not None and s.end > duration + 0.05):
            return f"segment {i} falls outside the clip (0 to {duration})"
        if s.tool_score is not None and not any(abs(s.tool_score - n) < 1e-6 for n in seen):
            return f"segment {i} tool_score {s.tool_score} does not appear in any tool record from this trace"
    return None
