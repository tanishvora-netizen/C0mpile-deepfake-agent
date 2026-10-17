"""LLM adapters: Anthropic (real) and Mock (deterministic, follows the prompt rules)."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Protocol

from contracts.models import ToolRecord
from orchestrator import evidence as ev


@dataclass
class ToolUse:
    id: str
    name: str
    input: dict


@dataclass
class LLMResponse:
    text: str = ""
    tool_calls: list[ToolUse] = field(default_factory=list)
    usage: dict = field(default_factory=lambda: {"input_tokens": 0, "output_tokens": 0})


class LLMClient(Protocol):
    name: str
    is_mock: bool

    def complete(self, system: str, messages: list[dict], tools: list[dict], model: str) -> LLMResponse: ...


def harvest(messages: list[dict]) -> list[ToolRecord]:
    """ToolRecords from tool_result blocks (JSON strings) in an Anthropic-style message list."""
    out: list[ToolRecord] = []
    for m in messages:
        if m["role"] != "user" or not isinstance(m["content"], list):
            continue
        for b in m["content"]:
            if isinstance(b, dict) and b.get("type") == "tool_result":
                try:
                    out.append(ToolRecord.model_validate_json(b["content"]))
                except (ValueError, TypeError):
                    continue
    return out


class MockLLM:
    """Deterministic stand-in. Adaptive: find_boundaries once, then rescore_region for every turn where A and B
    differ by more than DISAGREE (or score_windows where p_fake moved inside a turn), then the final JSON.
    Fixed (no tools): the final JSON straight away."""

    name = "mock"
    is_mock = True

    def complete(self, system: str, messages: list[dict], tools: list[dict], model: str) -> LLMResponse:
        records = harvest(messages)
        calls: list[ToolUse] = []
        if tools:
            calls = self._next_calls(records)
        text = "" if calls else json.dumps(ev.aggregate(records, fixed=not tools))
        n_in = sum(len(json.dumps(m["content"])) for m in messages) // 4
        return LLMResponse(text=text, tool_calls=calls, usage={"input_tokens": n_in, "output_tokens": max(len(text) // 4, 20 * len(calls))})

    @staticmethod
    def _next_calls(records: list[ToolRecord]) -> list[ToolUse]:
        ctx = ev.context(records)
        pa, pb = ev.turn_scores(records, "A"), ev.turn_scores(records, "B")
        if ctx is None or pa is None or pb is None:
            return []
        cid = records[0].clip_id
        n = len([r for r in records if r.tool in ("find_boundaries", "rescore_region")])
        if not any(r.tool == "find_boundaries" for r in records):
            args = {"clip_id": cid, "start": 0.0, "end": ctx["duration_s"], "signals": ["p_fake", "speaker", "channel"]}
            return [ToolUse(id=f"toolu_mock_{n}", name="find_boundaries", input=args)]
        if any(r.tool in ("rescore_region", "score_windows") for r in records):
            return []  # one follow-up round is enough; leftover disagreement becomes "uncertain"
        calls: list[ToolUse] = []
        per_turn = {p["idx"]: p for p in ctx.get("per_turn", [])}
        cps = ev.change_points(records)
        for t in ctx["turns"]:
            i = t["idx"]
            if per_turn.get(i, {}).get("too_short"):
                continue
            if abs(pa[i] - pb[i]) > ev.DISAGREE:  # prompt rule: A and B disagree -> rescore_region
                args = {"clip_id": cid, "detector": "A", "start": t["start"], "end": t["end"], "context_s": 30}
                calls.append(ToolUse(id=f"toolu_mock_{n + len(calls)}", name="rescore_region", input=args))
            elif ev.split_points(cps, t["start"], t["end"]):  # prompt rule: p_fake moved inside a turn -> score_windows
                args = {"clip_id": cid, "detector": "B", "start": t["start"], "end": t["end"], "window_s": 2, "hop_s": 1}
                calls.append(ToolUse(id=f"toolu_mock_{n + len(calls)}", name="score_windows", input=args))
        return calls


class AnthropicLLM:
    name = "anthropic"
    is_mock = False

    def __init__(self) -> None:
        import anthropic

        self._client = anthropic.Anthropic()

    def complete(self, system: str, messages: list[dict], tools: list[dict], model: str) -> LLMResponse:
        kwargs: dict[str, Any] = {"model": model, "max_tokens": 4096, "system": system, "messages": messages}
        if tools:
            kwargs["tools"] = tools
        resp = self._client.messages.create(**kwargs)
        text, calls = "", []
        for b in resp.content:
            if b.type == "text":
                text += b.text
            elif b.type == "tool_use":
                calls.append(ToolUse(id=b.id, name=b.name, input=dict(b.input)))
        return LLMResponse(text=text, tool_calls=calls,
                           usage={"input_tokens": resp.usage.input_tokens, "output_tokens": resp.usage.output_tokens})


def make_client() -> LLMClient:
    """Real Anthropic only when MOCK_LLM=0 and ANTHROPIC_API_KEY is set; otherwise the mock."""
    if os.environ.get("MOCK_LLM", "1") == "0" and os.environ.get("ANTHROPIC_API_KEY"):
        try:
            return AnthropicLLM()
        except Exception:  # noqa: BLE001 - fall back to the mock rather than crash
            return MockLLM()
    return MockLLM()
