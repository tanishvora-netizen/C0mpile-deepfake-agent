"""Shared contracts (SPEC M0). Change only via CONTRACT_CHANGE.md."""
from typing import Literal
from pydantic import BaseModel

class ClipMeta(BaseModel):
    clip_id: str                      # sha256 of decoded mono PCM
    duration_s: float
    orig_sr: int
    paths: dict[str, str]             # {"orig": ".../orig.wav", "16k": ".../16k.wav"}
    parent_clip_id: str | None = None # set for derived clips, e.g. a speech stem

class ToolCard(BaseModel):            # served by GET /tools; read by the orchestrator
    name: str
    version: str
    description: str
    args_schema: dict                 # JSON Schema
    values_schema: dict
    known_weaknesses: list[str]

class ToolRecord(BaseModel):
    tool: str
    version: str
    clip_id: str
    params: dict
    status: Literal["ok", "failed", "invalid_input"]
    values: dict                      # shape given by the tool card
    validity: dict                    # {"min_duration_s": 1.0, "sample_rate": 16000}
    flags: list[str] = []             # "too_short", "low_bandwidth", "clipped"
    runtime_ms: int
    error: str | None = None

class Turn(BaseModel):
    idx: int
    speaker: str
    start: float
    end: float

class Evidence(BaseModel):
    tool: str
    field: str
    value: float | str | bool

class Segment(BaseModel):
    start: float
    end: float
    speaker: str | None
    label: Literal["bona_fide", "synthetic", "uncertain"]
    tool_score: float | None          # p_fake from a ToolRecord in the trace; used for EER
    evidence: list[Evidence]

class AnalysisResult(BaseModel):
    clip_id: str
    system: Literal["baseline", "fixed", "adaptive"]
    model: str | None
    segments: list[Segment]
    mixed: bool
    composition: Literal["none", "speaker_handoff", "splice", "overlay"]
    abstain: str | None = None        # reason, e.g. "budget_exceeded", "tool_failed:score_turns"
    summary: str                      # at most 3 sentences, cites tools by name
    trace_id: str
    usage: dict                       # tokens, tool_calls, seconds, usd

class TraceEvent(BaseModel):          # streamed over SSE
    trace_id: str
    seq: int
    kind: Literal["tool_call", "tool_result", "llm", "final", "error"]
    payload: dict

class Action(BaseModel):
    type: Literal["verify_contact", "hold_new_payee", "notify_trusted_contact"]
    case_id: str
    target: str | None                # contact id, never a raw phone number from the call
    reason: str

class CaseEvent(BaseModel):
    case_id: str
    seq: int
    ts: str                           # ISO 8601 UTC
    type: str                         # clip_ingested, analysis_done, action, verification, transfer_*
    payload: dict
    prev_hash: str                    # 64 zeros for seq 0
    hash: str                         # sha256(prev_hash + canonical_json(case_id, seq, ts, type, payload))


CASE_STATES = ("OPEN", "VERIFYING", "VERIFIED", "CONTRADICTED", "UNREACHABLE")
TRANSFER_STATES = ("PENDING", "HELD", "RELEASED", "DECLINED")
CaseState = Literal["OPEN", "VERIFYING", "VERIFIED", "CONTRADICTED", "UNREACHABLE"]
TransferState = Literal["PENDING", "HELD", "RELEASED", "DECLINED"]
