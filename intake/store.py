"""M1 intake and clip store: any audio in, hashed 16 kHz mono clip out (SPEC M1)."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

from contracts.models import ClipMeta

MIN_S = 1.0
MAX_S = 600.0
ROOT = Path(__file__).resolve().parent.parent
GOLDEN_INDEX = ROOT / "data" / "golden" / "index.json"


class IntakeError(ValueError):
    """Raised for audio that cannot be decoded or is too short or too long."""


def data_dir() -> Path:
    return Path(os.environ.get("DATA_DIR", "./var")).resolve()


def _clip_dir(clip_id: str) -> Path:
    return data_dir() / "clips" / clip_id


def _run(cmd: list[str]) -> bytes:
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=120, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise IntakeError(f"ffmpeg unavailable or timed out: {exc}") from exc
    if proc.returncode != 0:
        raise IntakeError("could not decode audio: " + proc.stderr.decode("utf-8", "replace")[-200:].strip())
    return proc.stdout


def _decode(path: Path) -> tuple[bytes, int]:
    """Decode to mono PCM16 little-endian at the original sample rate."""
    probe = _run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate",
                  "-of", "csv=p=0", str(path)]).decode().strip().splitlines()
    if not probe or not probe[0].strip().isdigit():
        raise IntakeError("no audio stream found")
    sr = int(probe[0].strip())
    pcm = _run(["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(sr),
                "-f", "s16le", "-acodec", "pcm_s16le", "-"])
    return pcm, sr


def _write_wav(path: Path, pcm: bytes, sr: int) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm)


def _resample_16k(src: Path, dst: Path) -> None:
    head = ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-ac", "1"]
    try:
        _run([*head, "-af", "aresample=resampler=soxr", "-ar", "16000", str(dst)])
    except IntakeError:  # ffmpeg build without soxr
        _run([*head, "-ar", "16000", str(dst)])


def _store(pcm: bytes, sr: int, parent: str | None = None) -> ClipMeta:
    clip_id = hashlib.sha256(pcm).hexdigest()
    final = _clip_dir(clip_id)
    if (final / "meta.json").exists():
        return get(clip_id)
    duration = len(pcm) / 2 / sr
    if duration < MIN_S:
        raise IntakeError(f"clip is {duration:.2f}s; minimum is {MIN_S:.0f}s")
    if duration > MAX_S:
        raise IntakeError(f"clip is {duration:.0f}s; maximum is {MAX_S / 60:.0f} minutes")
    final.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix=".tmp-", dir=final.parent))
    try:
        _write_wav(tmp / "orig.wav", pcm, sr)
        _resample_16k(tmp / "orig.wav", tmp / "16k.wav")
        meta = ClipMeta(
            clip_id=clip_id, duration_s=round(duration, 3), orig_sr=sr,
            paths={"orig": str(final / "orig.wav"), "16k": str(final / "16k.wav")}, parent_clip_id=parent,
        )
        (tmp / "meta.json").write_text(meta.model_dump_json())
        try:
            tmp.rename(final)
        except OSError:  # concurrent ingest of the same clip won the race
            shutil.rmtree(tmp, ignore_errors=True)
        return get(clip_id)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise


def ingest(src: Path | bytes, filename: str) -> ClipMeta:
    """Decode, hash (sha256 of mono PCM16 bytes) and store a clip. Same audio -> same clip_id."""
    if isinstance(src, Path):
        pcm, sr = _decode(src)
    else:
        suffix = Path(filename).suffix or ".bin"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(src)
            tmp_path = Path(f.name)
        try:
            pcm, sr = _decode(tmp_path)
        finally:
            tmp_path.unlink(missing_ok=True)
    return _store(pcm, sr)


def get(clip_id: str) -> ClipMeta:
    meta = _clip_dir(clip_id) / "meta.json"
    if not meta.exists():
        raise KeyError(clip_id)
    return ClipMeta.model_validate_json(meta.read_text())


def derive(parent_id: str, samples: np.ndarray, sr: int, kind: str) -> ClipMeta:
    """Store a derived clip (e.g. kind='speech_stem') from float samples in [-1, 1]."""
    get(parent_id)
    pcm = np.clip(np.round(np.asarray(samples, dtype=np.float64) * 32767), -32768, 32767).astype("<i2").tobytes()
    return _store(pcm, sr, parent=parent_id)


def golden_name(clip_id: str) -> str | None:
    """'G3' etc. if this clip_id is one of the golden clips (data/golden/index.json), else None."""
    try:
        return json.loads(GOLDEN_INDEX.read_text()).get(clip_id)
    except (OSError, ValueError):
        return None
