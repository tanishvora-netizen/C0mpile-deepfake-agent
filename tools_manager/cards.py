"""ToolCards for the eight orchestrator tools (SPEC "Tool inventory")."""
from __future__ import annotations

from contracts.models import ToolCard

VERSION = "0.1.0"

_CLIP = {"type": "string", "description": "clip_id returned by intake"}
_DET = {"type": "string", "enum": ["A", "B"], "description": "A = AntiDeepfake, B = XLS-R + SLS"}
_T = {"type": "number", "minimum": 0}


def _args(props: dict, required: list[str]) -> dict:
    return {"type": "object", "properties": {"clip_id": _CLIP, **props}, "required": ["clip_id", *required]}


_TURN_ROW = {"type": "object", "properties": {"idx": {"type": "integer"}, "start": _T, "end": _T, "p_fake": _T}}

CARDS: list[ToolCard] = [
    ToolCard(
        name="get_context",
        version=VERSION,
        description=(
            "Speech segments, speaker turns, language, per-turn bandwidth, clipping, SNR and MOS. "
            "Call first; every other tool refers to the turns it returns."
        ),
        args_schema=_args({}, []),
        values_schema={
            "type": "object",
            "properties": {
                "duration_s": {"type": "number"},
                "speech_segments": {"type": "array"},
                "turns": {"type": "array", "items": {"type": "object"}},
                "language": {"type": "string"},
                "language_conf": {"type": "number"},
                "per_turn": {"type": "array"},
                "mos": {"type": "number"},
            },
        },
        known_weaknesses=["Diarization can merge two similar voices into one turn", "Short turns are unreliable"],
    ),
    ToolCard(
        name="score_turns",
        version=VERSION,
        description="p_fake per speaker turn from one detector (A or B), plus a whole-clip p_fake.",
        args_schema=_args({"detector": _DET}, ["detector"]),
        values_schema={
            "type": "object",
            "properties": {
                "detector": {"type": "string"},
                "turns": {"type": "array", "items": _TURN_ROW},
                "clip_p_fake": {"type": "number"},
            },
        },
        known_weaknesses=[
            "Whole-clip score dilutes a short fake inside a long real clip",
            "Detector A misses some cloned voices under telephone bandwidth",
        ],
    ),
    ToolCard(
        name="score_windows",
        version=VERSION,
        description="p_fake track over sliding windows inside a time range, from one detector.",
        args_schema=_args(
            {
                "detector": _DET,
                "start": _T,
                "end": _T,
                "window_s": {"type": "number", "enum": [2, 4, 10]},
                "hop_s": {"type": "number", "minimum": 0.25},
            },
            ["detector"],
        ),
        values_schema={
            "type": "object",
            "properties": {"windows": {"type": "array", "items": _TURN_ROW}, "window_s": {"type": "number"}},
        },
        known_weaknesses=["Windows shorter than 2 s are noisy", "Windows straddling a boundary blend both sides"],
    ),
    ToolCard(
        name="rescore_region",
        version=VERSION,
        description=(
            "Re-score one time range with one detector using up to 30 s of surrounding context. "
            "Use it to settle a turn where detectors A and B disagree."
        ),
        args_schema=_args(
            {"detector": _DET, "start": _T, "end": _T, "context_s": {"type": "number", "minimum": 1, "maximum": 30}},
            ["detector", "start", "end"],
        ),
        values_schema={
            "type": "object",
            "properties": {"detector": {"type": "string"}, "start": _T, "end": _T, "p_fake": _T},
        },
        known_weaknesses=["Context can include the other speaker, which pulls the score toward that side"],
    ),
    ToolCard(
        name="find_boundaries",
        version=VERSION,
        description=(
            "Change points over the p_fake track and channel features. Each change point names the signal "
            "that moved: p_fake (authenticity change), speaker (speaker change) or channel."
        ),
        args_schema=_args(
            {
                "start": _T,
                "end": _T,
                "signals": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["p_fake", "speaker", "channel"]},
                },
            },
            [],
        ),
        values_schema={
            "type": "object",
            "properties": {"change_points": {"type": "array", "items": {"type": "object"}}},
        },
        known_weaknesses=[
            "A speaker or channel change alone is not evidence of synthesis",
            "Resolution is about 0.25 s",
        ],
    ),
    ToolCard(
        name="speaker_consistency",
        version=VERSION,
        description="Cosine similarity of speaker embeddings for two turns, and whether they are the same speaker.",
        args_schema=_args(
            {"turn_a": {"type": "integer", "minimum": 0}, "turn_b": {"type": "integer", "minimum": 0}},
            ["turn_a", "turn_b"],
        ),
        values_schema={
            "type": "object",
            "properties": {"cosine": {"type": "number"}, "same_speaker": {"type": "boolean"}},
        },
        known_weaknesses=["Unreliable on turns under 2 s", "A cloned voice can match its target closely"],
    ),
    ToolCard(
        name="localize",
        version=VERSION,
        description="(optional) Frame-level fake localizer summarized into segments.",
        args_schema=_args({"start": _T, "end": _T}, ["start", "end"]),
        values_schema={"type": "object", "properties": {"segments": {"type": "array"}}},
        known_weaknesses=["Not installed in this build"],
    ),
    ToolCard(
        name="separate",
        version=VERSION,
        description="(optional) Speech/background separation; returns the clip_id of the speech stem.",
        args_schema=_args({}, []),
        values_schema={"type": "object", "properties": {"stem_clip_id": {"type": "string"}}},
        known_weaknesses=["Not installed in this build"],
    ),
]

CARD_BY_NAME: dict[str, ToolCard] = {c.name: c for c in CARDS}
