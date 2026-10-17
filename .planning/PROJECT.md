# CallGuard

## What This Is

CallGuard finds which speaker turns in a phone call or voicemail are AI-generated, then stops the money from leaving. One orchestrator agent calls specialist audio tools (through a single tools manager) to localize synthetic turns by speaker; plain deterministic rules then text the claimed person on their saved number, hold new-payee transfers, and notify a trusted contact. Every step lands in a hash-chained case record with a draft SAR narrative.

Built for the c0mpiled-14 hackathon (UC Berkeley). Main track: Regulated industries, a credit union's scam interrupt and audit trail. Side track: Personal AI for the aging population, the member ("Grandma") and caregiver experience. Primary user of the console is a credit union analyst; the demo audience is judges.

## Core Value

When a cloned voice opens a call and a live human takes over, CallGuard flags only the cloned turn and, before any money moves, verifies the claimed person out of band and holds new-payee transfers until a second person approves.

## Business Context

- **Customer**: A credit union (analyst/BSA officer) protecting members; caregivers as secondary users
- **Revenue model**: None. Hackathon build; AntiDeepfake and NISQA weights are CC BY-NC-SA 4.0 (non-commercial)
- **Success metric (developer-facing)**: The four demo must-show outcomes all work on golden clip G3 (see Active requirements) AND a single command (`make eval`) produces the adaptive-vs-baseline comparison table that tests technical claim H2
- **Strategy notes**: `SPEC-deepfake-agent.md` (authoritative build spec; every phase references its module sections by name)

## Requirements

### Validated

(None yet — ship to validate)

### Active

Full spec scope, modules M0 to M9 (hour estimates intentionally removed; do not reduce scope). Detail and IDs live in `.planning/REQUIREMENTS.md`.

Demo must-show outcomes (all on G3):
- [ ] **Outcome 1**: The agent flags only the cloned turn and passes the human turn, with its tool trace visible
- [ ] **Outcome 2**: The claimed contact ("Jake") gets a text on his saved number; his "NO" reply marks the case CONTRADICTED
- [ ] **Outcome 3**: Grandma's $9,500 wire to a new payee is HELD until her trusted contact approves or declines
- [ ] **Outcome 4**: The credit union gets a hash-chained case record and a draft SAR narrative

Technical claim:
- [ ] **H2**: One command produces a comparison table (with 95% bootstrap intervals) of an agent that localizes mixed-authenticity audio by speaker turn versus a fixed, no-LLM localizing pipeline. The requirement is an honest table, not a guaranteed win.

Modules (each a parallel subagent target):
- [ ] M0 shared contracts, fixtures, LLMClient adapter, golden clips, repo scaffold
- [ ] M1 intake and clip store; M2A detectors; M2B context; M2C boundaries; M2D localizer (optional); M2E separation (optional)
- [ ] M3 tools manager; M4 orchestrator (fixed, adaptive); M5 baseline and eval harness; M6 policy and actions; M7 case store and case writer; M8 API gateway; M9 frontend

### Out of Scope

- Live in-call streaming — SPEC "Not today" (stretch only); recordings are uploaded or forwarded, not streamed
- Training or fine-tuning detectors — SPEC "Not today"; detectors are used as published
- Native mobile apps — SPEC "Not today"; the member and trusted-contact screens are phone-width web pages
- LLM-assigned scores or LLM decisions in policy/actions — violates the LLM call rules; scores come from tools, actions from rules
- Orchestrator side-effect tools, or the orchestrator seeing transcripts or free-text metadata — SPEC rule
- Dialing or texting any number heard on the call or sent as caller metadata — security rule; only saved contact numbers
- Real consented or cloned voice recordings committed to the repo — consent and privacy; the repo ships synthesized placeholders and documents where real clips go
- Production bank integration — a mock bank is part of M6
- PDF export of the case packet — SPEC marks it optional (tracked as v2)

## Context

- Single authoritative input: `SPEC-deepfake-agent.md` (CallGuard Build Spec, Oct 17, 2026, author Tanish Rathin Vora). No ADRs or PRDs exist; the ingest report (`.planning/INGEST-CONFLICTS.md`) has 0 blockers, 0 warnings, 6 informational notes, resolved in the roadmap (see Key Decisions).
- The repository root IS the spec's `callguard/` root. Do not create a nested `callguard/`. A root `CLAUDE.md` with the subagent rules exists and must be kept.
- Dev machine: macOS laptop, no GPU. Toolchain seen at roadmap time: uv 0.13.1, ffmpeg 9.0.2, node 26.8.1, GNU Make 3.81 (old; keep the Makefile compatible), system Python 3.14.6 (uv provides the pinned Python 3.11). Real-model worker code (torch, fairseq, pyannote, etc., one env per worker) is implemented behind config for a rented GPU box but is not executed locally.
- Real consented clips are not in the repo. Golden clips G1 to G6 start as deterministic synthesized placeholders; the mixed eval set builder runs on placeholder sources locally and on real consented recordings plus open-TTS clones when available.
- Checkpoints from the SPEC (foundations, I1 mock end to end, I2 real tools, I3 full product, I4 numbers and freeze, ship) are used as phase gates, not as a schedule. SPEC wording says "four integration checkpoints" but lists six milestones; all six are treated as gates.
- Cut order if behind (SPEC): M2E, M2D, live Twilio (use simulated replies), the open-weights comparator, the PartialSpoof subset. Never cut the G3 demo flow or the adaptive-versus-baseline comparison on our own set. The user ruled that M2D/M2E are optional and deferrable but everything else stays in scope.
- Datasets for eval: own mixed set (main result), LlamaPartialSpoof subset (out-of-domain), PartialSpoof subset (in-domain sanity; overlaps AntiDeepfake post-training data), DFToolBench-A-500 (tool-use smoke test; overlaps detector training corpora).

## Constraints

- **Tech stack**: Python 3.11 managed with `uv` (FastAPI, pydantic v2, httpx, `anthropic` SDK, SQLite, pytest, ruff); frontend Vite, React, TypeScript (strict), Tailwind, wavesurfer.js regions; Twilio Python SDK plus a public tunnel for webhooks — fixed by the SPEC
- **Runtime**: Everything builds, tests and runs end to end with `MOCK_TOOLS=1 MOCK_LLM=1 MOCK_TWILIO=1`, no GPU, no network — the dev machine has no GPU
- **Isolation**: One env per heavy worker behind HTTP (AntiDeepfake pins Python 3.9.0 and fairseq 0.12.2 and never shares an env); backend services share `DATA_DIR` on one GPU box
- **Module ownership**: Each module edits only its own directory; contract changes go through `CONTRACT_CHANGE.md` — keeps parallel subagents conflict-free
- **Licensing/access**: AntiDeepfake and NISQA weights CC BY-NC-SA 4.0; pyannote weights gated on Hugging Face (accept terms, `HF_TOKEN`); Twilio trial accounts only text verified numbers
- **Consent**: Written consent for every cloned voice; state it in the demo close and README
- **Method**: Contracts first, a mock for every module, the same six golden clips in every module's tests, fixed integration gates; anything not working at a gate is cut, not debugged past it
- **Operational**: If a model will not load within 20 minutes, drop it and continue; tune prompts and thresholds on the dev split and report only on the held-out split; cache tool outputs by clip_id, tool, version and params

## Key Decisions

Roadmap-level decisions (made while resolving the ingest INFO notes and the parallel-build constraints). Spec-derived decisions are in the `<decisions>` block below.

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Shared `LLMClient` lives in `contracts/` (lead-owned, Phase 1); `orchestrator/llm_client.py` re-exports it | M4, M6 (name-matcher fallback) and M7 (case writer) all call LLMs; one adapter avoids three copies and cross-module imports while keeping the SPEC's file list satisfied | — Pending |
| Tool cards are authored once as JSON in `contracts/`; M3 serves them and workers' `/cards` read them | `GET /tools` must work with no worker running (`MOCK_TOOLS=1`); a single source prevents card drift | — Pending |
| `score_turns` values include a whole-clip `clip_p_fake` next to per-turn `p_fake` | Resolves INFO: the demo shows detector A's whole-clip score beside the timeline, and the eval's "A alone (clip level)" needs the same number; additive to `values`, no model change | — Pending |
| G3 fixtures encode A/B disagreement on the cloned turn; Mock LLM follows the prompt rule (disagree, then `rescore_region`) | Resolves INFO: the demo trace must show `rescore_region`, which the prompt only calls on disagreement | — Pending |
| Workers honor `MOCK_TOOLS=1` (fixture/manifest-derived outputs, no model load) | Lets the M3-to-worker HTTP path run locally without a GPU and without adding an env var | — Pending |
| Root `pyproject.toml`, `Makefile`, `data/golden`, `.env.example` are frozen by Phase 1; Makefile targets call fixed module entry points | Phase 2 plans run in parallel and may edit only their own directory | — Pending |
| Phase 2 modules couple only through contracts and documented interfaces, each stubbing neighbours behind a seam; Phase 3 swaps seams for real modules | Preserves one-plan-per-module parallelism; integration risk is concentrated and tested in Phase 3 | — Pending |
| `scripts/smoke.sh` and cross-module wiring are Phase 3 (lead-owned integration), not part of the M8 plan | smoke.sh lives outside `api/` and needs every module | — Pending |
| Mock bank (balance, transfers, approval tokens) lives in `policy_actions/` with the breaker | The SPEC diagram places the mock bank in M6; M8 `/bank/*` routes are thin wrappers | — Pending |
| Regenerated real-tool fixtures go to a separate `contracts/fixtures/real/` set, not over the story fixtures | Prevents tests and the A/B-disagreement demo story from silently changing when GPU outputs differ | — Pending |
| M2D/M2E are v1 but last in the final phase and never gate it; M3 registers `localize`/`separate` behind a config flag | User ruling plus SPEC cut order; the critical path must not depend on them | — Pending |
| `make eval` labels run provenance (mock vs real) in `results/` and `/eval` | A mock-backed table must never be mistaken for evidence on H2 | — Pending |

<decisions>
## Source-Spec Decisions (record as fixed; single SPEC source, no ADRs)

Source: `SPEC-deepfake-agent.md`. No ADR exists, so none are ADR-locked; the user directed these be recorded as fixed project decisions. Change only with explicit user approval (contracts via `CONTRACT_CHANGE.md`).

- **D-01 Stack**: Python 3.11 + `uv`; FastAPI, pydantic v2, httpx, `anthropic` SDK, SQLite, pytest, ruff. Worker envs one per worker (torch, silero-vad, pyannote.audio, speechbrain, ruptures, faster-whisper, ffmpeg). Frontend Vite + React + TypeScript + Tailwind + wavesurfer.js regions. Twilio Python SDK + ngrok/cloudflared tunnel.
- **D-02 Layout**: Monorepo, one directory per module: `contracts/`, `intake/`, `workers/{detectors,context,boundaries,localizer,separation}/`, `tools_manager/`, `orchestrator/`, `baseline_eval/`, `policy_actions/`, `cases/`, `api/`, `web/`, `data/golden/`, `scripts/smoke.sh`, root `CLAUDE.md`, `Makefile` (`make dev`, `make test-<module>`, `make eval`, `make smoke`). Repo root = spec `callguard/` root.
- **D-03 Ports**: API gateway 8000; tools manager 8100; AntiDeepfake worker 8101; XLS-R + SLS worker 8102; context 8103; boundaries 8104; localizer 8105 (optional); separation 8106 (optional); web 5173.
- **D-04 Env vars** (in `.env`, never committed): `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `TOOLS_URL`, `DATA_DIR`, `MOCK_TOOLS`, `MOCK_LLM`, `MOCK_TWILIO`. Added by roadmap (SPEC omitted them): `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_COMPAT_MODEL`, `PUBLIC_BASE_URL`, `HF_TOKEN`.
- **D-05 Contracts (M0)**: `contracts/models.py` (pydantic v2) is the only coupling between modules: ClipMeta, ToolCard, ToolRecord, Turn, Evidence, Segment, AnalysisResult, TraceEvent, Action, CaseEvent. Shared states: Case `OPEN`, `VERIFYING`, `VERIFIED`, `CONTRADICTED`, `UNREACHABLE`; Transfer `PENDING`, `HELD`, `RELEASED`, `DECLINED`. Changes only via `CONTRACT_CHANGE.md`.
- **D-06 Rules for every coding subagent** (root `CLAUDE.md`, keep): (1) read contracts, module README and spec section first; (2) edit only your module directory, contract changes go in `CONTRACT_CHANGE.md` and stop; (3) ship a mock that runs with `MOCK_*=1` from `contracts/fixtures` with no GPU or network; (4) never raise across a module boundary, return `ToolRecord(status="failed")` or an error `TraceEvent`; (5) tests live in `<module>/tests`, use `data/golden`, and `make test-<module>` must pass; (6) typed Python, pydantic at every boundary, ruff clean, TypeScript strict in `web/`; (7) JSON-line logs to stdout always with `trace_id` or `case_id`; (8) no secrets in code; (9) hand back what was built, how to run it, what is mocked, what failed.
- **D-07 Agents and models**: One agent only (orchestrator). Adaptive `claude-sonnet-5-5`; fixed `claude-haiku-5-5` (built first); eval upper bound `claude-opus-5-5`; case writer `claude-sonnet-5-5`; name-matcher fallback `claude-haiku-5-5`; cross-provider check through an OpenAI-compatible client with an open-weights model (vLLM/Ollama). All calls go through one `LLMClient` adapter (Anthropic, OpenAI-compatible, Mock); lowest-variance sampling settings, logged with every run.
- **D-08 LLM call rules**: No LLM ever sets a score; every continuous score comes from a tool output and the validator checks each `tool_score` appears in a `ToolRecord` from the trace. The orchestrator has no side-effect tools and never sees transcripts or free-text metadata. Tool workers, tools manager, baseline, policy, verifier and circuit breaker are deterministic code.
- **D-09 Tool facts**: Eight orchestrator tools via the tools manager (six required; `localize` and `separate` optional); `transcribe` is policy-only (M6 in-process). `p_fake` in [0,1] is softmax index 0 for AntiDeepfake (confirm on a known fake and real clip). Detectors take 16 kHz mono; NISQA runs on the original-rate copy. Turns under 1 s get `too_short` and cannot be labeled alone. `find_boundaries` names the signal that moved (channel-only change = speaker change; `p_fake` change = authenticity change).
- **D-10 Policy**: Rules in `rules.yaml` evaluated top to bottom, first match wins (`clone_claims_contact`, `clone_unknown_identity`, `analysis_abstained`, `all_bona_fide`). Verification only to the contact's saved number; never a number from the call. New-payee transfer while case is not `VERIFIED` is `HELD`; release needs the trusted contact's approval link.
- **D-11 Case record**: Append-only SQLite plus JSONL mirror; `hash = sha256(prev_hash + canonical_json(case_id, seq, ts, type, payload))`, `prev_hash` of seq 0 is 64 zeros; narrative marked "DRAFT for BSA officer review" and references FinCEN alert FIN-2024-Alert004.
- **D-12 Tool manager behaviour**: single door to workers; 60 s timeout, one retry on connection error, failures become `status="failed"`; disk cache keyed by SHA-256 of clip_id, tool, version, canonical params; per-`trace_id` call and second counts.
- **D-13 Orchestrator caps and validation**: Adaptive default caps 12 steps, 20 tool calls, 90 s, $0.25 per clip; breach ends with `abstain="budget_exceeded"`. Validation: pydantic parse, one retry, then `abstain="invalid_output"`; reject unknown `tool_score` and overlapping/out-of-clip segments.
- **D-14 Eval design**: Baseline must localize (no LLM); mixed set must not hand the agent a shortcut (50 ms crossfades, loudness matching, one codec pass after mixing); 30% dev / 70% held-out; 95% bootstrap intervals from 1,000 resamples; systems A alone, B alone, baseline, fixed, adaptive, adaptive with a non-Anthropic model.
- **D-15 Golden clips**: G1 to G6 as defined in the SPEC, passed through G.711 at 8 kHz after mixing, consent kept for every cloned voice.
- **D-16 Gates**: foundations, I1 mock end to end, I2 real tools, I3 full product, I4 numbers and freeze, ship. Cut order M2E, M2D, live Twilio, open-weights comparator, PartialSpoof subset; never cut the G3 demo flow or the adaptive-versus-baseline comparison.
</decisions>

---
*Last updated: 2026-10-17 after initial roadmap creation (new-project-from-ingest)*
