"""Where the voices are: turns from the uploaded files, or from pauses in a single recording."""
from __future__ import annotations

import wave

import numpy as np

SR = 16000
FRAME_S = 0.03
MIN_PAUSE_S = 0.5
MIN_TURN_S = 1.0


def load_16k(path: str) -> np.ndarray:
    with wave.open(path, "rb") as w:
        raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


def _speech_mask(x: np.ndarray) -> np.ndarray:
    n = int(FRAME_S * SR)
    frames = x[: len(x) // n * n].reshape(-1, n)
    rms = np.sqrt(np.mean(frames**2, axis=1)) if len(frames) else np.zeros(0)
    if not len(rms):
        return rms.astype(bool)
    floor = np.percentile(rms, 10)
    return rms > max(floor * 3.0, rms.max() * 0.05, 1e-4)


def speech_segments(x: np.ndarray, start: float = 0.0, end: float | None = None) -> list[tuple[float, float]]:
    """Stretches of speech separated by pauses of at least MIN_PAUSE_S."""
    end = len(x) / SR if end is None else end
    seg = x[int(start * SR): int(end * SR)]
    mask = _speech_mask(seg)
    out: list[list[float]] = []
    for i, on in enumerate(mask):
        if not on:
            continue
        t0, t1 = start + i * FRAME_S, start + (i + 1) * FRAME_S
        if out and t0 - out[-1][1] < MIN_PAUSE_S:
            out[-1][1] = t1
        else:
            out.append([t0, t1])
    return [(round(a, 2), round(b, 2)) for a, b in out]


def _merge_short(segs: list[tuple[float, float]]) -> list[tuple[float, float]]:
    merged = list(segs)
    i = 0
    while len(merged) > 1 and i < len(merged):
        a, b = merged[i]
        if b - a >= MIN_TURN_S:
            i += 1
            continue
        j = i - 1 if i > 0 else i + 1  # fold into the previous turn, or the next one at the start
        lo, hi = min(merged[i][0], merged[j][0]), max(merged[i][1], merged[j][1])
        merged[min(i, j)] = (lo, hi)
        del merged[max(i, j)]
        i = max(i - 1, 0)
    return merged


def turns(x: np.ndarray, sources: list[dict]) -> list[dict]:
    """One turn per uploaded file (trimmed to its speech); otherwise split a single recording at pauses."""
    if sources:
        out = []
        for k, src in enumerate(sources):
            segs = speech_segments(x, src["start"], src["end"]) or [(src["start"], src["end"])]
            out.append({"idx": k, "speaker": f"Voice {k + 1}", "start": segs[0][0], "end": segs[-1][1]})
        return out
    segs = _merge_short(speech_segments(x)) or [(0.0, round(len(x) / SR, 2))]
    return [{"idx": k, "speaker": "Voice 1", "start": a, "end": b} for k, (a, b) in enumerate(segs)]


def channel_stats(x: np.ndarray, start: float, end: float) -> dict:
    seg = x[int(start * SR): int(end * SR)]
    if len(seg) < 256:
        return {"bandwidth_hz": 0, "clipping_frac": 0.0, "snr_db": 0.0, "too_short": True}
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2
    cum = np.cumsum(spec) / max(spec.sum(), 1e-12)
    bandwidth = float(np.searchsorted(cum, 0.99) * SR / 2 / len(cum))
    mask = _speech_mask(seg)
    n = int(FRAME_S * SR)
    frames = seg[: len(seg) // n * n].reshape(-1, n)
    energy = np.mean(frames**2, axis=1) if len(frames) else np.zeros(1)
    sig = energy[mask].mean() if mask.any() else energy.mean()
    noise = energy[~mask].mean() if (~mask).any() else 1e-8
    return {
        "bandwidth_hz": round(bandwidth),
        "clipping_frac": round(float(np.mean(np.abs(seg) > 0.99)), 4),
        "snr_db": round(float(10 * np.log10(max(sig, 1e-10) / max(noise, 1e-10))), 1),
        "too_short": (end - start) < MIN_TURN_S,
    }
