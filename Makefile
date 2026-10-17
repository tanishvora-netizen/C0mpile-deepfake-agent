export MOCK_TOOLS ?= 1
export MOCK_LLM ?= 1
export MOCK_TWILIO ?= 1
export DATA_DIR ?= ./var
PY = uv run

.PHONY: dev api web test smoke lint golden eval

golden:
	$(PY) python scripts/make_golden.py
	$(PY) python scripts/make_demo_audio.py

api:
	$(PY) uvicorn api.app:app --port 8000 --reload

web:
	cd web && npm run dev

dev:
	$(MAKE) -j2 api web

test:
	$(PY) pytest -q

test-%:
	$(PY) pytest -q $*/tests

lint:
	$(PY) ruff check .

smoke:
	bash scripts/smoke.sh

eval:
	$(PY) python -m baseline_eval.run_eval
