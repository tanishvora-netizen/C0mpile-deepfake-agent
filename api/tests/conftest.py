import pytest


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "var"))
    monkeypatch.setenv("MOCK_TOOLS", "1")
    monkeypatch.setenv("MOCK_LLM", "1")
    monkeypatch.setenv("MOCK_TWILIO", "1")
    monkeypatch.setenv("VERIFY_TIMEOUT_S", "0")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


@pytest.fixture
def stubs(monkeypatch):
    """Fake intake + orchestrator so API tests pass without Agent A's code (or ffmpeg)."""
    import hashlib
    import sys
    import time
    import types

    from api import app as api_app
    from contracts.models import ClipMeta, TraceEvent
    from policy_actions.tests.g3 import g3_result

    known: dict[str, ClipMeta] = {}

    def ingest(data: bytes, filename: str) -> ClipMeta:
        if len(data) < 8:
            raise ValueError("clip too short")
        cid = hashlib.sha256(data).hexdigest()
        known[cid] = ClipMeta(clip_id=cid, duration_s=7.0, orig_sr=16000, paths={})
        return known[cid]

    def get(clip_id: str) -> ClipMeta:
        return known[clip_id]

    intake_store = types.ModuleType("intake.store")
    intake_store.ingest, intake_store.get = ingest, get
    intake_store.golden_name = lambda cid: None
    intake_pkg = types.ModuleType("intake")
    intake_pkg.store = intake_store

    def analyze(clip_id, mode, model=None, on_event=None):
        res = g3_result(clip_id)
        res = res.model_copy(update={"system": mode})
        for seq, kind in enumerate(["tool_call", "tool_result", "llm"]):
            time.sleep(0.01)
            if on_event:
                on_event(TraceEvent(trace_id="trace-g3", seq=seq, kind=kind, payload={"n": seq}))
        if on_event:
            on_event(TraceEvent(trace_id="trace-g3", seq=3, kind="final", payload=res.model_dump()))
        return res

    run = types.ModuleType("orchestrator.run")
    run.analyze = analyze
    orch_pkg = types.ModuleType("orchestrator")
    orch_pkg.run = run
    for name, mod in [("intake", intake_pkg), ("intake.store", intake_store),
                      ("orchestrator", orch_pkg), ("orchestrator.run", run)]:
        monkeypatch.setitem(sys.modules, name, mod)
    api_app.JOBS.clear()
    api_app.GOLDEN.clear()
    return run
