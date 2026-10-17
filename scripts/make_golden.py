"""Write deterministic placeholder golden clips G1..G6 plus expected.json and index.json.

Run: uv run python scripts/make_golden.py
clip_id = sha256 over the decoded mono PCM16 bytes (same as intake.store.ingest computes).
Real recordings (SPEC "Golden clips") can replace the wavs; re-run to refresh index.json.
"""
from __future__ import annotations

import hashlib
import json
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

SR = 16000
OUT = ROOT / "data" / "golden"
F0 = {"S1": 140.0, "S2": 215.0}

# (start, end, speaker, kind) with kind in {"real", "fake"}; expected label follows kind.
CLIPS: dict[str, dict] = {
    "G1": {"duration": 6.0, "segs": [(0.0, 6.0, "S1", "real")], "mixed": False, "composition": "none"},
    "G2": {"duration": 6.0, "segs": [(0.0, 6.0, "S1", "fake")], "mixed": False, "composition": "none"},
    "G3": {
        "duration": 7.0,
        "segs": [(0.0, 3.0, "S1", "fake"), (3.0, 7.0, "S2", "real")],
        "mixed": True,
        "composition": "speaker_handoff",
    },
    "G4": {
        "duration": 7.0,
        "segs": [(0.0, 3.5, "S1", "real"), (3.5, 7.0, "S2", "real")],
        "mixed": False,
        "composition": "none",
    },
    "G5": {
        "duration": 8.0,
        "segs": [(0.0, 2.5, "S1", "real"), (2.5, 5.5, "S1", "fake"), (5.5, 8.0, "S1", "real")],
        "mixed": True,
        "composition": "splice",
    },
    "G6": {
        "duration": 7.0,
        "segs": [(0.0, 3.0, "S1", "fake"), (3.0, 7.0, "S2", "real")],
        "mixed": True,
        "composition": "speaker_handoff",
        "composition_allowed": ["speaker_handoff", "overlay"],
        "music_bed_snr_db": 10.0,
    },
}


def voice(speaker: str, kind: str, dur: float, rng: np.random.Generator) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    f0 = F0[speaker]
    if kind == "fake":  # clean, steady, slight vibrato, no breath noise
        f = f0 * (1 + 0.004 * np.sin(2 * np.pi * 5.0 * t))
    else:  # jittery pitch random walk plus breath noise
        walk = np.cumsum(rng.normal(0, 0.0006, n))
        f = f0 * (1 + 0.03 * np.sin(2 * np.pi * 0.7 * t) + walk - walk.mean())
    phase = 2 * np.pi * np.cumsum(f) / SR
    x = sum((0.6 ** k) * np.sin((k + 1) * phase) for k in range(6))
    env = 0.55 + 0.45 * np.sin(2 * np.pi * 3.5 * t + (0.0 if kind == "fake" else rng.uniform(0, 6)))
    x = x * env
    if kind == "real":
        x = x + rng.normal(0, 0.12, n)
    x = x / (np.max(np.abs(x)) + 1e-9) * 0.5
    return x


def render(name: str, spec: dict) -> np.ndarray:
    seed = int(name[1:]) * 7919
    rng = np.random.default_rng(seed)
    n = int(spec["duration"] * SR)
    out = np.zeros(n)
    fade = int(0.02 * SR)
    for s, e, spk, kind in spec["segs"]:
        a, b = int(s * SR), int(e * SR)
        seg = voice(spk, kind, (b - a) / SR, rng)
        w = np.ones(b - a)
        w[:fade] = np.linspace(0, 1, fade)
        w[-fade:] = np.linspace(1, 0, fade)
        out[a:b] += seg * w
    if "music_bed_snr_db" in spec:
        t = np.arange(n) / SR
        bed = sum(np.sin(2 * np.pi * f * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.5 * t)) for f in (220.0, 277.2, 329.6))
        p_sig, p_bed = float(np.mean(out**2)), float(np.mean(bed**2))
        out = out + bed * np.sqrt(p_sig / p_bed / (10 ** (spec["music_bed_snr_db"] / 10)))
    out = out / (np.max(np.abs(out)) + 1e-9) * 0.8
    return out


def to_pcm16(x: np.ndarray) -> np.ndarray:
    return np.clip(np.round(x * 32767), -32768, 32767).astype("<i2")


def write_wav(path: Path, pcm: np.ndarray) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    expected: dict[str, dict] = {}
    index: dict[str, str] = {}
    for name, spec in CLIPS.items():
        pcm = to_pcm16(render(name, spec))
        write_wav(OUT / f"{name}.wav", pcm)
        clip_id = hashlib.sha256(pcm.tobytes()).hexdigest()
        index[clip_id] = name
        expected[name] = {
            "duration_s": spec["duration"],
            "mixed": spec["mixed"],
            "composition": spec["composition"],
            "composition_allowed": spec.get("composition_allowed", [spec["composition"]]),
            "segments": [
                {"start": s, "end": e, "speaker": spk, "label": "synthetic" if kind == "fake" else "bona_fide"}
                for s, e, spk, kind in spec["segs"]
            ],
        }
    (OUT / "expected.json").write_text(json.dumps(expected, indent=2) + "\n")
    (OUT / "index.json").write_text(json.dumps(index, indent=2) + "\n")
    print(f"wrote {len(CLIPS)} clips to {OUT}")
    try:
        from contracts.fixtures import build_fixtures

        build_fixtures.main()
    except ImportError as exc:  # fixtures builder not available yet
        print(f"skipping fixtures: {exc}")


if __name__ == "__main__":
    main()
