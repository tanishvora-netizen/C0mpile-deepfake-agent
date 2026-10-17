#!/usr/bin/env bash
# One command to set up and launch the CallGuard demo (mock mode: no GPU, no network, no API keys).
#
#   bash scripts/demo.sh            set up everything, start the API and web app, open the demo
#   bash scripts/demo.sh --check    also run the tests and the end-to-end smoke check first
#
# Needs: uv, node + npm, ffmpeg. On macOS the demo calls are voiced with the built-in `say` voices.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_PORT=8000
WEB_PORT=5173
DEMO_URL="http://localhost:${WEB_PORT}/demo"
export MOCK_TOOLS=1 MOCK_LLM=1 MOCK_TWILIO=1 DATA_DIR="$ROOT/var"

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

step "Checking tools"
for tool in uv node npm ffmpeg; do
  command -v "$tool" >/dev/null || fail "$tool is not installed (macOS: brew install ${tool/npm/node})"
done
for port in "$API_PORT" "$WEB_PORT"; do
  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "port $port is already in use; stop whatever is running there and try again"
  fi
done

step "Installing Python packages (Python 3.11 via uv)"
uv python install 3.11 >/dev/null
uv sync -q

step "Installing web packages"
(cd web && npm install --silent --no-audit --no-fund)

step "Creating the demo calls and their scripted detector results"
uv run python scripts/make_golden.py >/dev/null
uv run python scripts/make_demo_audio.py
uv run python -m baseline_eval.run_eval >/dev/null

if [[ "${1:-}" == "--check" ]]; then
  step "Running tests"
  uv run pytest -q
  step "Running the end-to-end smoke check"
  bash scripts/smoke.sh
fi

step "Starting the API on :$API_PORT and the web app on :$WEB_PORT"
mkdir -p "$DATA_DIR"
uv run uvicorn api.app:app --port "$API_PORT" >"$DATA_DIR/api.log" 2>&1 &
API_PID=$!
(cd web && npm run dev -- --port "$WEB_PORT" --strictPort) >"$DATA_DIR/web.log" 2>&1 &
WEB_PID=$!
trap 'kill $API_PID $WEB_PID 2>/dev/null; echo; echo "Stopped."' EXIT INT TERM

for _ in $(seq 1 60); do
  curl -sf "http://localhost:$API_PORT/clips/golden" >/dev/null && curl -sf "http://localhost:$WEB_PORT/" >/dev/null && break
  sleep 0.5
done
curl -sf "http://localhost:$API_PORT/clips/golden" >/dev/null || fail "the API did not start; see $DATA_DIR/api.log"
curl -sf "http://localhost:$WEB_PORT/" >/dev/null || fail "the web app did not start; see $DATA_DIR/web.log"

printf '\n\033[32mCallGuard is running.\033[0m\n'
printf '  Demo:          %s\n' "$DEMO_URL"
printf '  Analyst view:  http://localhost:%s/console\n' "$WEB_PORT"
printf '  API:           http://localhost:%s/docs\n' "$API_PORT"
printf 'Press Ctrl+C to stop.\n'
command -v open >/dev/null && open "$DEMO_URL"
wait
