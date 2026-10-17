#!/usr/bin/env bash
# Full G3 flow against the API with curl + jq. Exits non-zero on the first failed assertion.
# Env: API_URL (use an already-running server), MOCK_* default to 1, DATA_DIR defaults to a temp dir.
set -uo pipefail
cd "$(dirname "$0")/.."

export MOCK_TOOLS="${MOCK_TOOLS:-1}" MOCK_LLM="${MOCK_LLM:-1}" MOCK_TWILIO="${MOCK_TWILIO:-1}"
SERVER_PID=""
TMP_DATA=""
cleanup() {
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null && wait "$SERVER_PID" 2>/dev/null
  [[ -n "$TMP_DATA" ]] && rm -rf "$TMP_DATA"
  return 0
}
trap cleanup EXIT

fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "missing dependency: $1"; }
need curl; need jq

check() { # check <label> <actual> <expected>
  if [[ "$2" == "$3" ]]; then echo "ok   $1 = $2"; else fail "$1: expected '$3', got '$2'"; fi
}
get()  { curl -sS --fail-with-body "$API$1"; }
post() { curl -sS --fail-with-body -H 'content-type: application/json' -d "$2" "$API$1"; }

if [[ -n "${API_URL:-}" ]]; then
  API="$API_URL"
elif curl -sf "http://127.0.0.1:8000/clips/golden" >/dev/null 2>&1; then
  API="http://127.0.0.1:8000"
  echo "using the server already running on :8000"
else
  PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
  API="http://127.0.0.1:$PORT"
  TMP_DATA=$(mktemp -d)
  export DATA_DIR="${DATA_DIR:-$TMP_DATA}"
  if command -v uv >/dev/null 2>&1; then RUN=(uv run); else RUN=(); fi
  "${RUN[@]}" python -m uvicorn api.app:app --host 127.0.0.1 --port "$PORT" --log-level warning \
    >"${TMP_DATA}/server.log" 2>&1 &
  SERVER_PID=$!
  echo "started uvicorn pid $SERVER_PID on $API"
  for _ in $(seq 1 120); do
    curl -sf "$API/clips/golden" >/dev/null 2>&1 && break
    kill -0 "$SERVER_PID" 2>/dev/null || { cat "$TMP_DATA/server.log" >&2; fail "server exited during startup"; }
    sleep 0.5
  done
  curl -sf "$API/clips/golden" >/dev/null 2>&1 || { cat "$TMP_DATA/server.log" >&2; fail "server did not become ready"; }
fi

[[ -f data/golden/G3.wav ]] || fail "data/golden/G3.wav missing (run: make golden)"

# 1. upload
CLIP=$(curl -sS --fail-with-body -F "file=@data/golden/G3.wav" "$API/clips") || fail "upload: $CLIP"
CLIP_ID=$(jq -r .clip_id <<<"$CLIP")
[[ ${#CLIP_ID} -eq 64 ]] || fail "clip_id not a sha256: $CLIP_ID"
echo "ok   uploaded G3 clip_id=${CLIP_ID:0:12}"

# 2. analyze (adaptive) and replay the SSE stream
JOB=$(post /analyze "{\"clip_id\":\"$CLIP_ID\",\"mode\":\"adaptive\"}") || fail "analyze: $JOB"
JOB_ID=$(jq -r .job_id <<<"$JOB")
STREAM=$(curl -sSN --max-time 180 "$API/analyze/$JOB_ID/stream") || fail "stream failed"
EVENTS=$(grep '^data:' <<<"$STREAM" | sed 's/^data: *//')
check "last stream event kind" "$(tail -n1 <<<"$EVENTS" | jq -r .kind)" "final"
check "stream seq in order" "$(jq -s '[.[].seq] == ([.[].seq] | sort)' <<<"$EVENTS")" "true"

RESULT=$(get "/analyze/$JOB_ID") || fail "result: $RESULT"
check "turn 0 label" "$(jq -r '.segments[0].label' <<<"$RESULT")" "synthetic"
echo "ok   analysis: composition=$(jq -r .composition <<<"$RESULT") system=$(jq -r .system <<<"$RESULT")"

# 3. open the case, policy runs
CASE=$(post /cases/from-analysis "{\"job_id\":\"$JOB_ID\",\"member_id\":\"grandma\"}") || fail "case: $CASE"
CASE_ID=$(jq -r .case_id <<<"$CASE")
check "actions" "$(jq -r '[.actions[].type] | join(",")' <<<"$CASE")" "verify_contact,hold_new_payee,notify_trusted_contact"
check "case state after policy" "$(jq -r .state <<<"$CASE")" "VERIFYING"

# 4. $9,500 new-payee transfer must be held
TX=$(post /bank/transfers '{"member_id":"grandma","payee":"Reyes Bail Services","amount":9500,"new_payee":true}') || fail "transfer: $TX"
TX_ID=$(jq -r .id <<<"$TX"); TOKEN=$(jq -r .token <<<"$TX")
check "transfer state" "$(jq -r .state <<<"$TX")" "HELD"
[[ -n "$TOKEN" && "$TOKEN" != "null" ]] || fail "held transfer has no approval token"
check "approve page amount == 9500" "$(get "/approve/$TOKEN" | jq '.amount == 9500')" "true"

# 5. Jake replies NO
REPLY=$(post /dev/simulate-reply "{\"case_id\":\"$CASE_ID\",\"reply\":\"NO\"}") || fail "reply: $REPLY"
check "case state after NO" "$(jq -r .state <<<"$REPLY")" "CONTRADICTED"
check "case state (GET)" "$(get "/cases/$CASE_ID" | jq -r .state)" "CONTRADICTED"
check "transfer still held" "$(get "/transfers/$TX_ID" | jq -r .state)" "HELD"

# 6. packet and chain
PACKET=$(get "/cases/$CASE_ID/packet") || fail "packet: $PACKET"
check "packet chain ok" "$(jq -r .chain.ok <<<"$PACKET")" "true"
check "case chain ok" "$(get "/cases/$CASE_ID" | jq -r .chain.ok)" "true"
jq -e '.sar_draft | contains("DRAFT for BSA officer review")' <<<"$PACKET" >/dev/null || fail "SAR draft not marked as draft"
echo "ok   SAR draft marked DRAFT for BSA officer review"

# 7. trusted contact declines
check "decline" "$(post "/bank/transfers/$TX_ID/decline" "{\"token\":\"$TOKEN\"}" | jq -r .state)" "DECLINED"

echo "SMOKE PASS"
