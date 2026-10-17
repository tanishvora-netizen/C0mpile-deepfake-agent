"""M4 orchestrator: baseline, fixed and adaptive modes. Never raises; failures become abstains."""
from __future__ import annotations

import json
import logging
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from contracts.models import AnalysisResult, Segment, ToolRecord, TraceEvent
from orchestrator import evidence as ev
from orchestrator.llm_client import LLMClient, make_client
from orchestrator.validate import check, parse_json
from tools_manager import manager

log = logging.getLogger("orchestrator")
Mode = Literal["baseline", "fixed", "adaptive"]
DEFAULT_MODEL = {"fixed": "claude-haiku-5-5", "adaptive": "claude-sonnet-5-5"}
# USD per million tokens (input, output); rough estimates for the cap check only
PRICE = {"claude-haiku-5-5": (1.0, 5.0), "claude-sonnet-5-5": (3.0, 15.0)}
PROMPT = (Path(__file__).parent / "prompt.md").read_text()


@dataclass
class Caps:
    max_steps: int = 12
    max_tool_calls: int = 12
    max_seconds: float = 90.0
    max_usd: float = 0.25


class _Abort(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def system_prompt(fixed: bool) -> str:
    cards = [{"name": c["name"], "description": c["description"], "args": c["input_schema"]["properties"]}
             for c in manager.anthropic_tools()]
    note = ("All tool results are already provided; you cannot call tools. Aggregate them."
            if fixed else "Use the tools you need within the budget, then answer.")
    return (PROMPT.replace("{disagree}", str(ev.DISAGREE)).replace("{mode_note}", note)
            .replace("{tool_cards}", json.dumps(cards)))


class _Run:
    def __init__(self, clip_id: str, mode: Mode, model: str, on_event: Callable[[TraceEvent], None] | None, caps: Caps,
                 client: LLMClient) -> None:
        self.clip_id, self.mode, self.model, self.caps, self.client = clip_id, mode, model, caps, client
        self.trace_id = uuid.uuid4().hex[:16]
        self.on_event = on_event
        self.seq = 0
        self.records: list[ToolRecord] = []
        self.n_calls = 0
        self.tokens = {"input_tokens": 0, "output_tokens": 0}
        self.t0 = time.perf_counter()

    # -- events / usage
    def emit(self, kind: str, payload: dict) -> None:
        e = TraceEvent(trace_id=self.trace_id, seq=self.seq, kind=kind, payload=payload)  # type: ignore[arg-type]
        self.seq += 1
        log.info(json.dumps({"trace_id": self.trace_id, "seq": e.seq, "kind": kind}))
        if self.on_event:
            try:
                self.on_event(e)
            except Exception:
                log.exception("on_event failed")

    def usd(self) -> float:
        if self.client.is_mock:
            return 0.0
        pi, po = PRICE.get(self.model, (3.0, 15.0))
        return (self.tokens["input_tokens"] * pi + self.tokens["output_tokens"] * po) / 1e6

    def usage(self) -> dict:
        return {**self.tokens, "tool_calls": self.n_calls, "seconds": round(time.perf_counter() - self.t0, 3),
                "usd": round(self.usd(), 5), "mock_llm": self.client.is_mock}

    # -- tools
    def exec(self, calls: list[tuple[str, dict, str]]) -> list[ToolRecord]:
        """Run tool calls (parallel if several). Emits tool_call events, then tool_result events in order."""
        if self.n_calls + len(calls) > self.caps.max_tool_calls:
            raise _Abort("budget_exceeded")
        full = [(n, {**a, "clip_id": self.clip_id}, cid) for n, a, cid in calls]
        for n, a, cid in full:
            self.emit("tool_call", {"tool": n, "args": a, "call_id": cid})
        if len(full) > 1:
            with ThreadPoolExecutor(max_workers=len(full)) as pool:
                recs = list(pool.map(lambda c: manager.call_tool(c[0], c[1]), full))
        else:
            recs = [manager.call_tool(full[0][0], full[0][1])]
        self.n_calls += len(full)
        for (n, _, cid), r in zip(full, recs, strict=True):
            self.emit("tool_result", {"tool": n, "call_id": cid, "status": r.status, "record": r.model_dump(), "cached": False})
        self.records.extend(recs)
        return recs

    def cid(self) -> str:
        return f"c{self.n_calls + 1}"

    # -- results
    def duration(self) -> float | None:
        ctx = ev.context(self.records)
        if ctx is None:
            return None
        return float(ctx.get("duration_s") or max((t["end"] for t in ctx["turns"]), default=0.0))

    def result(self, body: dict, abstain: str | None = None) -> AnalysisResult:
        body = {**body}
        if abstain:
            body["abstain"] = abstain
        return AnalysisResult(clip_id=self.clip_id, system=self.mode, model=self.model, trace_id=self.trace_id,  # type: ignore[arg-type]
                              usage=self.usage(), **body)

    def abstain(self, reason: str) -> AnalysisResult:
        ctx = ev.context(self.records)
        segs = [Segment(start=t["start"], end=t["end"], speaker=t["speaker"], label="uncertain", tool_score=None, evidence=[])
                for t in (ctx["turns"] if ctx else [])]
        body = {"segments": segs, "mixed": False, "composition": "none",
                "summary": f"Abstained ({reason}); no label is given because the evidence is incomplete."}
        return self.result(body, abstain=reason)

    def finish(self, text: str) -> AnalysisResult | str:
        """Parse and validate an LLM reply: the AnalysisResult, or an error string for a retry."""
        try:
            body = parse_json(text)
            body.pop("clip_id", None)
            body = {k: v for k, v in body.items() if k in ("segments", "mixed", "composition", "abstain", "summary")}
            res = self.result(body)
            err = check(res, self.records, self.duration())
        except Exception as exc:  # noqa: BLE001 - pydantic/JSON errors go back to the model
            return str(exc)[:500]
        return err or res


def _blocks(calls: list[tuple[str, dict, str]], recs: list[ToolRecord] | None = None) -> list[dict]:
    if recs is None:
        return [{"type": "tool_use", "id": cid, "name": n, "input": a} for n, a, cid in calls]
    return [{"type": "tool_result", "tool_use_id": cid, "content": r.model_dump_json()} for (_, _, cid), r in zip(calls, recs, strict=True)]


def _step_exec(run: _Run, messages: list[dict], calls: list[tuple[str, dict, str]], text: str = "") -> list[ToolRecord]:
    recs = run.exec(calls)
    messages.append({"role": "assistant", "content": ([{"type": "text", "text": text}] if text else []) + _blocks(calls)})
    messages.append({"role": "user", "content": _blocks(calls, recs)})
    return recs


def _prelude(run: _Run, messages: list[dict]) -> AnalysisResult | None:
    """get_context then score_turns A and B (before the model is called). Returns an abstain on failure."""
    messages.append({"role": "user", "content": f"Analyze clip {run.clip_id}. Use this clip_id in every tool call."})
    ctx = _step_exec(run, messages, [("get_context", {}, run.cid())])[0]
    if ctx.status != "ok":
        return run.abstain("tool_failed:get_context")
    calls = [("score_turns", {"detector": "A"}, "c2"), ("score_turns", {"detector": "B"}, "c3")]
    recs = _step_exec(run, messages, calls)
    if any(r.status != "ok" for r in recs):
        return run.abstain("tool_failed:score_turns")
    return None


def _ask(run: _Run, messages: list[dict], tools: list[dict], step: int, system: str) -> AnalysisResult | Any:
    if time.perf_counter() - run.t0 > run.caps.max_seconds or run.usd() > run.caps.max_usd:
        raise _Abort("budget_exceeded")
    resp = run.client.complete(system, messages, tools, run.model)
    for k in run.tokens:
        run.tokens[k] += int(resp.usage.get(k, 0))
    run.emit("llm", {"model": run.model, "step": step, "text": resp.text[:2000], "tool_calls": [c.name for c in resp.tool_calls],
                     "usage": resp.usage})
    return resp


def _final(run: _Run, messages: list[dict], tools: list[dict], first_text: str, step: int, system: str) -> AnalysisResult:
    out = run.finish(first_text)
    if isinstance(out, AnalysisResult):
        return out
    messages.append({"role": "assistant", "content": first_text or "(empty)"})
    messages.append({"role": "user", "content": f"Your output was invalid: {out}. Return only corrected JSON."})
    resp = _ask(run, messages, [], step + 1, system)
    out = run.finish(resp.text)
    return out if isinstance(out, AnalysisResult) else run.abstain("invalid_output")


def _run_fixed(run: _Run) -> AnalysisResult:
    messages: list[dict] = []
    bad = _prelude(run, messages)
    if bad:
        return bad
    ctx = ev.context(run.records) or {}
    turns = ctx["turns"]
    seq: list[tuple[str, dict, str]] = []
    for t in turns:
        seq.append(("score_windows", {"detector": "B", "start": t["start"], "end": t["end"], "window_s": 2, "hop_s": 1}, ""))
    seq.append(("find_boundaries", {"start": 0.0, "end": ctx["duration_s"], "signals": ["p_fake", "speaker", "channel"]}, ""))
    for i, a in enumerate(turns):
        for b in turns[i + 1:]:
            if a["speaker"] == b["speaker"]:
                seq.append(("speaker_consistency", {"turn_a": a["idx"], "turn_b": b["idx"]}, ""))
    calls = [(n, a, f"c{4 + k}") for k, (n, a, _) in enumerate(seq)]
    _step_exec(run, messages, calls)  # tool failures here are not on the critical path
    messages[-1]["content"].append({"type": "text", "text": "Aggregate every tool result above and return the AnalysisResult JSON."})
    system = system_prompt(fixed=True)
    resp = _ask(run, messages, [], 0, system)
    return _final(run, messages, [], resp.text, 0, system)


def _run_adaptive(run: _Run) -> AnalysisResult:
    messages: list[dict] = []
    bad = _prelude(run, messages)
    if bad:
        return bad
    tools, system = manager.anthropic_tools(), system_prompt(fixed=False)
    for step in range(run.caps.max_steps):
        resp = _ask(run, messages, tools, step, system)
        if not resp.tool_calls:
            return _final(run, messages, tools, resp.text, step, system)
        calls = [(c.name, {k: v for k, v in c.input.items() if k != "clip_id"}, c.id) for c in resp.tool_calls]
        _step_exec(run, messages, calls, resp.text)
    raise _Abort("budget_exceeded")


def analyze(clip_id: str, mode: Mode, model: str | None = None, on_event: Callable[[TraceEvent], None] | None = None,
            caps: Caps | None = None, trace_id: str | None = None) -> AnalysisResult:
    """Analyze one stored clip. Synchronous; emits tool_call/tool_result/llm events and a final event (seq from 0)."""
    caps = caps or Caps()
    client = make_client()
    model = model or DEFAULT_MODEL.get(mode, "")
    run = _Run(clip_id, mode, model or "", on_event, caps, client)
    if trace_id:
        run.trace_id = trace_id
    try:
        if mode == "baseline":
            from baseline_eval.baseline import run_baseline

            def on_call(name: str, args: dict, rec: ToolRecord) -> None:
                cid = run.cid()
                run.emit("tool_call", {"tool": name, "args": args, "call_id": cid})
                run.n_calls += 1
                run.emit("tool_result", {"tool": name, "call_id": cid, "status": rec.status, "record": rec.model_dump(), "cached": False})

            result = run_baseline(clip_id, on_call=on_call)
            result = result.model_copy(update={"trace_id": run.trace_id, "usage": run.usage()})
        else:
            result = _run_fixed(run) if mode == "fixed" else _run_adaptive(run)
    except _Abort as a:
        result = run.abstain(a.reason)
    except Exception as exc:
        log.exception("analyze failed")
        run.emit("error", {"message": f"{type(exc).__name__}: {exc}"})
        result = run.abstain("internal_error")
    run.emit("final", result.model_dump())
    return result
