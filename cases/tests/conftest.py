import pytest


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "var"))
    monkeypatch.setenv("MOCK_TOOLS", "1")
    monkeypatch.setenv("MOCK_LLM", "1")
    monkeypatch.setenv("MOCK_TWILIO", "1")
    monkeypatch.setenv("VERIFY_TIMEOUT_S", "0")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
