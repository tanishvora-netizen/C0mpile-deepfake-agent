"""Real AI-voice detectors that run locally on CPU (three independent wav2vec2 classifiers).

Three independent classifiers, and a voice is flagged only when all three agree. On our check set (real
LibriSpeech, film, Hindi and Opus-compressed microphone-style speech vs macOS TTS) A and B alone each flag
some real people; A+B wrongly flagged 5 of 47 short (2-6 s) real clips, A+B+C flagged none. A+B+C missed
one macOS voice ("Ralph"). Weights come from the Hugging Face Hub on first use, safetensors only.
"""
from __future__ import annotations

import contextlib
import threading

import numpy as np

SR = 16000
MODELS = {
    "A": "garystafford/wav2vec2-deepfake-voice-detector",
    "B": "mo-thecreator/Deepfake-audio-detection",
    "C": "Gustking/wav2vec2-large-xlsr-deepfake-audio-classification",
}
CHUNK_S = 30.0  # score each voice in one pass; short tail chunks made detector B misfire

_load_lock = threading.Lock()
# Metal aborts the process if two threads touch the GPU at once (seen: model load during inference),
# so every GPU step, loading included, goes through this one re-entrant lock. ~2.4x faster than CPU.
_gpu_lock = threading.RLock()
_model_locks = {det: threading.Lock() for det in MODELS}  # on CPU, A, B and C run side by side
_loaded: dict[str, tuple] = {}
_device: str | None = None


def device() -> str:
    """'mps' on Apple Silicon (same scores as CPU, measured), else 'cpu'. Override with CALLGUARD_DEVICE."""
    global _device
    if _device is None:
        import os

        import torch

        want = os.environ.get("CALLGUARD_DEVICE", "auto")
        _device = want if want != "auto" else ("mps" if torch.backends.mps.is_available() else "cpu")
    return _device


def available() -> bool:
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except ImportError:
        return False
    return True


def _gpu_guard():
    return _gpu_lock if device() != "cpu" else contextlib.nullcontext()


def _load(detector: str) -> tuple:
    with _gpu_guard(), _load_lock:
        return _load_unlocked(detector)


def _load_unlocked(detector: str) -> tuple:
    if detector not in _loaded:
        from transformers import AutoFeatureExtractor, AutoModelForAudioClassification

        model_id = MODELS[detector]
        fe = AutoFeatureExtractor.from_pretrained(model_id)
        model = AutoModelForAudioClassification.from_pretrained(model_id, use_safetensors=True).eval().to(device())
        labels = {i: str(lbl).lower() for i, lbl in model.config.id2label.items()}
        fake_idx = [i for i, lbl in labels.items() if any(k in lbl for k in ("fake", "spoof", "synth"))]
        if not fake_idx:
            raise RuntimeError(f"{model_id} has no fake/spoof label: {labels}")
        _loaded[detector] = (fe, model, fake_idx)
    return _loaded[detector]


def warm_up() -> None:
    """Download and load every detector now instead of on the first request."""
    for det in MODELS:
        _load(det)


def _chunks(x: np.ndarray) -> list[np.ndarray]:
    """Equal pieces of at most CHUNK_S, so no piece is a short tail."""
    k = int(np.ceil(len(x) / (CHUNK_S * SR))) or 1
    return list(np.array_split(x, k))


def p_fake(x: np.ndarray, detector: str) -> float:
    """Probability that this 16 kHz mono float audio is AI-generated, per one detector."""
    import torch

    dev = device()
    lock = _gpu_lock if dev != "cpu" else _model_locks[detector]
    total, weight = 0.0, 0
    with lock:
        fe, model, fake_idx = _load(detector)
        for chunk in _chunks(np.asarray(x, dtype=np.float32)):
            inputs = {k: v.to(dev) for k, v in fe(chunk, sampling_rate=SR, return_tensors="pt").items()}
            with torch.inference_mode():
                probs = torch.softmax(model(**inputs).logits[0], dim=-1).cpu()
            total += float(sum(probs[i] for i in fake_idx)) * len(chunk)
            weight += len(chunk)
    return round(total / max(weight, 1), 4)
