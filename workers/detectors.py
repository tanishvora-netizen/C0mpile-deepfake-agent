"""Real AI-voice detectors that run locally on CPU (three independent wav2vec2 classifiers).

Three independent classifiers, and a voice is flagged only when all three agree. On our check set (real
LibriSpeech, film, Hindi and Opus-compressed microphone-style speech vs macOS TTS) A and B alone each flag
some real people; A+B wrongly flagged 5 of 47 short (2-6 s) real clips, A+B+C flagged none. A+B+C missed
one macOS voice ("Ralph"). Weights come from the Hugging Face Hub on first use, safetensors only.
"""
from __future__ import annotations

import threading

import numpy as np

SR = 16000
MODELS = {
    "A": "garystafford/wav2vec2-deepfake-voice-detector",
    "B": "mo-thecreator/Deepfake-audio-detection",
    "C": "Gustking/wav2vec2-large-xlsr-deepfake-audio-classification",
}
CHUNK_S = 30.0  # score each voice in one pass; short tail chunks made detector B misfire

_lock = threading.Lock()
_loaded: dict[str, tuple] = {}


def available() -> bool:
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except ImportError:
        return False
    return True


def _load(detector: str) -> tuple:
    if detector not in _loaded:
        from transformers import AutoFeatureExtractor, AutoModelForAudioClassification

        model_id = MODELS[detector]
        fe = AutoFeatureExtractor.from_pretrained(model_id)
        model = AutoModelForAudioClassification.from_pretrained(model_id, use_safetensors=True).eval()
        labels = {i: str(lbl).lower() for i, lbl in model.config.id2label.items()}
        fake_idx = [i for i, lbl in labels.items() if any(k in lbl for k in ("fake", "spoof", "synth"))]
        if not fake_idx:
            raise RuntimeError(f"{model_id} has no fake/spoof label: {labels}")
        _loaded[detector] = (fe, model, fake_idx)
    return _loaded[detector]


def warm_up() -> None:
    """Download and load every detector now instead of on the first request."""
    with _lock:
        for det in MODELS:
            _load(det)


def _chunks(x: np.ndarray) -> list[np.ndarray]:
    """Equal pieces of at most CHUNK_S, so no piece is a short tail."""
    k = int(np.ceil(len(x) / (CHUNK_S * SR))) or 1
    return list(np.array_split(x, k))


def p_fake(x: np.ndarray, detector: str) -> float:
    """Probability that this 16 kHz mono float audio is AI-generated, per one detector."""
    import torch

    with _lock:
        fe, model, fake_idx = _load(detector)
        total, weight = 0.0, 0
        for chunk in _chunks(np.asarray(x, dtype=np.float32)):
            inputs = fe(chunk, sampling_rate=SR, return_tensors="pt")
            with torch.inference_mode():
                probs = torch.softmax(model(**inputs).logits[0], dim=-1)
            total += float(sum(probs[i] for i in fake_idx)) * len(chunk)
            weight += len(chunk)
    return round(total / max(weight, 1), 4)
