# CallGuard build interfaces (fast build)

This build targets the G3 demo flow end to end with all mocks on (`MOCK_TOOLS=1 MOCK_LLM=1 MOCK_TWILIO=1`), no GPU and no network.
The spec is `SPEC-deepfake-agent.md`. Contracts live in `contracts/models.py` (pydantic v2) and `contracts/hashing.py`. Do not edit either; propose changes in `CONTRACT_CHANGE.md`.

Everything runs in **one Python process**: `api/app.py` imports the modules below directly. HTTP worker services are out of scope; the tools manager serves fixtures in-process.
Use Python 3.11 through `uv run`. Read env vars with `os.environ.get(name, default)`. `DATA_DIR` defaults to `./var`.

## Golden clips and fixtures (owner: Agent A)

- `scripts/make_golden.py` deterministically writes placeholder clips to `data/golden/G1.wav` … `G6.wav`. Use numpy tones/noise, 16 kHz mono, 4–8 s.
  It also writes `data/golden/expected.json` and `data/golden/index.json`, which maps `{clip_id: "G3", ...}`. `clip_id` is the sha256 that intake computes.
- G3 is the demo story:
  - turn 0 (0.0–3.0 s, speaker `S1`) is a **cloned "Jake"**: "Grandma, it's Jake, I'm in trouble"
  - turn 1 (3.0–7.0 s, speaker `S2`) is a **real human "lawyer"** asking for a $9,500 wire
  - expected labels: turn 0 `synthetic`, turn 1 `bona_fide`, `mixed=true`, `composition="speaker_handoff"`
  - detectors A and B **disagree** on turn 0, so adaptive mode calls `rescore_region`
  - A's whole-clip `clip_p_fake` is lower than its turn-0 score
- G1 is all human, with one speaker and no actions.
- Fixture files under `contracts/fixtures/`:
  - `tool_records/G{n}/{tool}__{detector or 'none'}.json`
  - `analysis/G{n}.json` (an `AnalysisResult`)
  - `trace/G3.jsonl`
  - `transcripts/G3.json`, as `[{"start":0,"end":3,"text":"Grandma, it's Jake..."}, ...]`
  - `case_G3.json` (a list of `CaseEvent` with a valid chain)

## Module interfaces

### Agent A: detection pipeline

| Module | Function | Signature |
| --- | --- | --- |
| `intake/store.py` | `ingest` | `ingest(data: bytes, filename: str) -> ClipMeta`. Decodes with ffmpeg to mono 16k plus orig. Same audio returns the same `clip_id`. Rejects clips under 1 s or over 10 min with `IntakeError(ValueError)`. |
| | `get` | `get(clip_id) -> ClipMeta`, raises `KeyError` |
| | `golden_name` | `golden_name(clip_id) -> str \| None` |
| `tools_manager/manager.py` | `list_cards` | `list_cards() -> list[ToolCard]` |
| | `anthropic_tools` | `anthropic_tools() -> list[dict]`, Anthropic tool-use format |
| | `call_tool` | `call_tool(name: str, args: dict) -> ToolRecord`. Never raises; on error returns `status="failed"`. Caches by (clip_id, tool, version, params). |
| `orchestrator/llm_client.py` | `LLMClient` | Anthropic, OpenAI-compatible or Mock. Mock is the default when `MOCK_LLM=1` or `ANTHROPIC_API_KEY` is unset. |
| `orchestrator/run.py` | `analyze` | `analyze(clip_id, mode: Literal["baseline","fixed","adaptive"], model: str \| None = None, on_event: Callable[[TraceEvent], None] \| None = None) -> AnalysisResult`. Synchronous. Emits `tool_call`/`tool_result`/`llm` events and finally a `final` event whose payload is the result dict. `seq` starts at 0. |
| `baseline_eval/baseline.py` | `run_baseline` | `run_baseline(clip_id) -> AnalysisResult` with `system="baseline"` |
| `baseline_eval/run_eval.py` | (script) | `python -m baseline_eval.run_eval` writes `results/results.json` and `results/table.md` comparing baseline, fixed and adaptive on G1–G6, with provenance `"mock"` |

### Agent B: product backend

| Module | Function | Signature |
| --- | --- | --- |
| `cases/store.py` (SQLite at `$DATA_DIR/cases.db`) | `open_case` | `open_case(clip_id: str, member_id: str) -> str` returns `case_id`, state `OPEN` |
| | `append` | `append(case_id, type: str, payload: dict) -> CaseEvent`, hash-chained via `contracts.hashing` |
| | `events` | `events(case_id) -> list[CaseEvent]` |
| | `verify_chain` | `verify_chain(case_id) -> dict` returns `{"ok": bool, "bad_seq": int \| None}` |
| | `get_state` / `set_state` | |
| `cases/writer.py` | `write_packet` | `write_packet(case_id) -> dict` with `summary`, `timeline`, `evidence`, `sar_draft` (marked "DRAFT for BSA officer review") and `chain`. Uses a template under `MOCK_LLM`, otherwise `claude-sonnet-5-5`. |
| `policy_actions/` | `engine.decide` | `decide(result: AnalysisResult, case_id: str) -> list[Action]`. Claimed identity comes from transcripts of synthetic segments only; it matches `contacts.yaml` (Jake) and relationship words. |
| | `verifier` | `send_verification(case_id, contact_id)` and `handle_reply(case_id, text) -> state`. NO means `CONTRADICTED`, YES means `VERIFIED`, a timeout means `UNREACHABLE`. Mock Twilio just logs and records. |
| | `bank` | `create_transfer(member_id, payee, amount, new_payee) -> dict` with `{id, state, token, reason}`. Returns `HELD` when there is a new payee and the member's open case is not `VERIFIED`. `approve(transfer_id, token)` sets `RELEASED`; `decline(transfer_id, token)` sets `DECLINED`. Writes `transfer_*` case events. |
| `api/app.py` | FastAPI on :8000 | The exact routes in SPEC "M8 API gateway", plus CORS for :5173. Jobs run in a thread or asyncio task. SSE events are `data: <TraceEvent json>`, in seq order, ending with `final`. |
| | `GET /clips/golden` | Returns `[{"name":"G3","clip_id":...}]`. Ingests `data/golden/*.wav` on startup. |
| | `GET /transfers/{id}` | Returns `{id, state, amount, payee, reason}` |
| | `GET /approve/{token}` | Returns the transfer for the approve page |
| `scripts/smoke.sh` | | Runs the full G3 flow with curl: upload, analyze, case, transfer, simulated NO, packet. Exits 0 only if the case is `CONTRADICTED`, the transfer is `HELD` and the chain is ok. |

### Agent C: frontend

- `web/` uses Vite, React, TypeScript (strict) and Tailwind, with routes `/console`, `/bank`, `/approve/:token` and `/eval`.
- It talks to `http://localhost:8000` using the routes above and the shapes from `contracts/models.py`.
- With `?fixtures=1` it renders from `web/src/fixtures/*.json`, a copy of the G3 fixtures, so it works without the API.
