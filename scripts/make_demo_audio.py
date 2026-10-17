"""Voice the golden clips G1..G6 with macOS text-to-speech so demos have audible words.

These are STAND-INS, not evidence: every voice here is synthetic TTS, and in mock mode the verdicts come
from contracts/fixtures, not from this audio. For a real demo, replace the "real" lines with a recorded
teammate and the "fake" lines with a consented voice clone (SPEC "Golden clips").

Speaker windows and labels come from scripts/make_golden.py CLIPS, so expected.json and the fixtures
stay valid. Writes data/golden/G*.wav, refreshes index.json, regenerates fixtures, and writes one
caption transcript per clip to contracts/fixtures/transcripts/.
"""
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from make_golden import CLIPS, OUT, SR

TRANSCRIPTS = ROOT / "contracts" / "fixtures" / "transcripts"

JAKE_REAL = "Tom"
JAKE_CLONE = "Eddy (English (US))"
LAWYER = "Reed (English (US))"
FRIEND = "Daniel"

# Per clip, one line per segment in CLIPS order: (voice, spoken text, caption text, who).
LINES: dict[str, list[tuple[str, str, str, str]]] = {
    "G1": [(JAKE_REAL, "Hi Grandma, it's Jake. Just calling to say I'll see you Sunday for dinner.",
            "Hi Grandma, it's Jake. Just calling to say I'll see you Sunday for dinner.", "Jake")],
    "G2": [(JAKE_CLONE, "Grandma, it's Jake. I lost my phone. Can you send money to my new account?",
            "Grandma, it's Jake. I lost my phone. Can you send money to my new account?", "Caller says they're Jake")],
    "G3": [
        (JAKE_CLONE, "Grandma, it's Jake. I'm in trouble.",
         "Grandma, it's Jake. I'm in trouble.", "Caller says they're Jake"),
        (LAWYER, "I'm Jake's lawyer. Wire ninety-five hundred dollars for bail today.",
         "I'm Jake's lawyer. Wire $9,500 for bail today.", "Second voice: 'Lawyer'"),
    ],
    "G4": [
        (JAKE_REAL, "Hi Grandma, it's Jake. Here's my friend Sam.",
         "Hi Grandma, it's Jake. Here's my friend Sam.", "Jake"),
        (FRIEND, "Hi! So nice to meet you. See you on Sunday.",
         "Hi! So nice to meet you. See you on Sunday.", "Jake's friend Sam"),
    ],
    "G5": [
        (JAKE_REAL, "Hi Grandma, it's Jake.", "Hi Grandma, it's Jake.", "Jake"),
        (JAKE_CLONE, "Please wire money to my new account today.",
         "Please wire money to my new account today.", "Inserted voice ('Jake')"),
        (JAKE_REAL, "Anyway, see you Sunday. Love you!", "Anyway, see you Sunday. Love you!", "Jake"),
    ],
}
LINES["G6"] = LINES["G3"]


def _run(cmd: list[str], data: bytes | None = None) -> bytes:
    return subprocess.run(cmd, input=data, capture_output=True, check=True).stdout


def _tts(voice: str, text: str, rate: int, tmp: Path) -> np.ndarray:
    aiff = tmp / "line.aiff"
    _run(["say", "-v", voice, "-r", str(rate), "-o", str(aiff), text])
    raw = _run(["ffmpeg", "-v", "error", "-i", str(aiff), "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"])
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def _fit(voice: str, text: str, window_s: float, tmp: Path) -> np.ndarray:
    """Speak the line fast enough to fit the window, then pad with silence to exactly fill it."""
    n = round(window_s * SR)
    lead = int(0.12 * SR)
    for rate in (185, 205, 225, 245, 270, 300):
        x = _tts(voice, text, rate, tmp)
        nz = np.flatnonzero(np.abs(x) > 1e-3)
        if nz.size:
            x = x[nz[0]: nz[-1] + 1]
        if len(x) + lead <= n:
            break
    x = x[: n - lead]
    out = np.zeros(n, dtype=np.float32)
    out[lead: lead + len(x)] = x
    return out


def _music_bed(n: int) -> np.ndarray:
    t = np.arange(n) / SR
    chord = sum(np.sin(2 * np.pi * f * t) for f in (220.0, 277.18, 329.63, 440.0))
    return (chord * (0.6 + 0.4 * np.sin(2 * np.pi * 0.5 * t))).astype(np.float32)


def _phone_line(x: np.ndarray) -> np.ndarray:
    """Round-trip through G.711 mu-law at 8 kHz, as a real call would be."""
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes()
    mulaw = _run(["ffmpeg", "-v", "error", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-",
                  "-ar", "8000", "-acodec", "pcm_mulaw", "-f", "wav", "-"], pcm)
    back = _run(["ffmpeg", "-v", "error", "-i", "-", "-ar", str(SR), "-ac", "1", "-f", "s16le", "-"], mulaw)
    return np.frombuffer(back, dtype=np.int16)


def render(name: str, tmp: Path) -> tuple[np.ndarray, list[dict]]:
    spec = CLIPS[name]
    total = np.zeros(round(spec["duration"] * SR), dtype=np.float32)
    captions = []
    for (start, end, speaker, _kind), (voice, spoken, caption, who) in zip(spec["segs"], LINES[name], strict=True):
        seg = _fit(voice, spoken, end - start, tmp)
        i = round(start * SR)
        total[i: i + len(seg)] += seg[: len(total) - i]
        captions.append({"start": start, "end": end, "speaker": speaker, "who": who, "text": caption})
    peak = float(np.max(np.abs(total))) or 1.0
    total *= 0.8 / peak
    if "music_bed_snr_db" in spec:
        bed = _music_bed(len(total))
        speech_rms = float(np.sqrt(np.mean(total**2)))
        bed *= speech_rms / (float(np.sqrt(np.mean(bed**2))) * 10 ** (spec["music_bed_snr_db"] / 20))
        total = total + bed
        total *= 0.9 / float(np.max(np.abs(total)))
    return _phone_line(total), captions


def _write_wav(path: Path, pcm: np.ndarray) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main() -> None:
    if not shutil.which("say") or not shutil.which("ffmpeg"):
        print("make_demo_audio: needs macOS `say` and ffmpeg; keeping placeholder tones")
        return
    index: dict[str, str] = {}
    captions: dict[str, list[dict]] = {}
    with tempfile.TemporaryDirectory() as td:
        for name in CLIPS:
            pcm, captions[name] = render(name, Path(td))
            _write_wav(OUT / f"{name}.wav", pcm)
            index[hashlib.sha256(pcm.tobytes()).hexdigest()] = name
    (OUT / "index.json").write_text(json.dumps(index, indent=2) + "\n")

    from contracts.fixtures import build_fixtures

    build_fixtures.main()
    TRANSCRIPTS.mkdir(parents=True, exist_ok=True)
    for name, items in captions.items():
        (TRANSCRIPTS / f"{name}.json").write_text(json.dumps(items, indent=2) + "\n")
    print(f"voiced {len(index)} clips in {OUT}")


if __name__ == "__main__":
    main()
