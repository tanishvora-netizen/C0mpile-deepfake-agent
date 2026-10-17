import io
import json
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np
import pytest

from intake import store

GOLDEN = Path(__file__).resolve().parents[2] / "data" / "golden"
INDEX = json.loads((GOLDEN / "index.json").read_text())  # {clip_id: name}


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    return tmp_path


def _wav_bytes(seconds: float, sr: int = 16000) -> bytes:
    t = np.arange(int(seconds * sr)) / sr
    pcm = (np.sin(2 * np.pi * 220 * t) * 12000).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


@pytest.mark.parametrize("clip_id,name", list(INDEX.items()))
def test_golden_clips_ingest_with_index_clip_id(clip_id, name):
    meta = store.ingest((GOLDEN / f"{name}.wav").read_bytes(), f"{name}.wav")
    assert meta.clip_id == clip_id
    with wave.open(meta.paths["16k"]) as w:
        assert (w.getframerate(), w.getnchannels()) == (16000, 1)
    assert store.get(clip_id).duration_s == meta.duration_s
    assert store.golden_name(clip_id) == name


def test_same_file_twice_no_new_files(data_dir):
    data = (GOLDEN / "G3.wav").read_bytes()
    a = store.ingest(data, "a.wav")
    files = sorted(p.name for p in (data_dir / "clips").rglob("*"))
    b = store.ingest(data, "b.wav")
    assert a.clip_id == b.clip_id
    assert files == sorted(p.name for p in (data_dir / "clips").rglob("*"))


def test_short_and_missing_clips():
    with pytest.raises(store.IntakeError):
        store.ingest(_wav_bytes(0.5), "short.wav")
    with pytest.raises(store.IntakeError):
        store.ingest(b"not audio", "x.wav")
    with pytest.raises(KeyError):
        store.get("0" * 64)
    assert store.golden_name("0" * 64) is None


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")
def test_wav_and_mp3_duration_match(tmp_path):
    wav = tmp_path / "x.wav"
    wav.write_bytes(_wav_bytes(3.0))
    mp3 = tmp_path / "x.mp3"
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-b:a", "320k", str(mp3)], check=False, capture_output=True)
    if r.returncode != 0:
        pytest.skip("no mp3 encoder")
    assert abs(store.ingest(wav.read_bytes(), "x.wav").duration_s - store.ingest(mp3.read_bytes(), "x.mp3").duration_s) < 0.05
