# Roadmap: CallGuard

## Overview

CallGuard goes from a spec and an empty repo to a working scam interrupt in four phases that mirror the spec's checkpoints. Phase 1 lays the shared foundations (contracts, fixtures, LLM adapter, golden clips, repo scaffold) so every module can be built in isolation. Phase 2 builds all eleven modules in parallel, one plan per spec module, each running on mocks with no GPU. Phase 3 wires those modules together through the API gateway so the full G3 flow passes with every mock on, then connects the real-tools path behind the tools manager for the GPU box. Phase 4 delivers the full product (adaptive mode, real Twilio, held transfer with approval link, case packet), produces the adaptive-versus-baseline comparison table, and ships the README and demo runbook, with the optional localizer and separation workers last. Scope is the full spec (M0 to M9); there are no time estimates, and the spec's checkpoints are used as gates, not as a schedule.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundations (M0 + repo scaffold)** - Shared contracts, fixtures, LLM adapter, golden clips and repo scaffold so every module builds in isolation
- [ ] **Phase 2: Modules on mocks (M1 to M9)** - Eleven parallel module plans, one per spec module, each tested on mocks with no GPU
- [ ] **Phase 3: Integration I1 + I2** - Full G3 flow through M8 with all mocks (smoke.sh, console), then the real-tools path behind M3
- [ ] **Phase 4: Full product I3 + numbers I4 + ship** - Adaptive mode, real Twilio, held transfer, case packet, eval table, README and runbook; optional M2D/M2E last

## Phase Details

### Phase 1: Foundations (M0 + repo scaffold)
**Goal**: Every later module can be built, tested and run against shared contracts, fixtures, an LLM adapter and golden clips with no GPU, no network and no neighbouring module.
**Depends on**: Nothing (first phase)
**Spec**: `SPEC-deepfake-agent.md` sections "M0 Shared contracts", "Stack, repo layout and ports", "How we code fast without losing quality" (golden clips, speed rules, definition of done), "Tool inventory", "Agents and LLMs" (LLM call rules and the `LLMClient` adapter)
**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08, FND-09, FND-10, FND-11, FND-12
**Success Criteria** (what must be TRUE):
  1. On a clean macOS checkout (Python 3.11 via uv, no GPU, no network) `uv sync` then `make test-contracts` passes: every contract model round-trips, every committed fixture (a G3 `ToolRecord` per orchestrator tool, the fixed-mode tool records for G1 to G6, an `AnalysisResult` per golden clip, the G3 `TraceEvent` stream, a finished G3 case) validates against its model, the finished case's hash chain verifies through the shared hash helper, and regenerated JSON Schemas and tool cards show no diff.
  2. The G3 fixtures carry the demo story: detectors A and B disagree on turn 0 (the cloned turn) in `score_turns`, a `rescore_region` record resolves it, detector A's whole-clip `clip_p_fake` is visibly lower than its turn 0 score, the G3 trace fixture runs `get_context`, `score_turns`, `find_boundaries`, `rescore_region`, `final` in that order, and the G1 and G4 fixtures show no A/B disagreement (so the adaptive trace calls `rescore_region` only where the prompt rule fires).
  3. The `LLMClient` adapter switches between Anthropic, OpenAI-compatible and Mock by config alone; its tests (Mock, plus a local fake OpenAI-compatible HTTP server) pass with no network and show tool-use translation, JSON output, and tokens, latency, sampling settings and dollar cost logged per call.
  4. Running `scripts/make_golden_placeholders.py` deterministically produces G1 to G6 passed through G.711 at 8 kHz plus `data/golden/expected.json` (turn boundaries, speakers, labels, `mixed`, `composition`), and `data/golden/README.md` states where real consented clips replace the placeholders and that written consent is required.
  5. `make test-<module>` exists and passes (skeleton tests) for all fourteen module directories and `make test` aggregates them; each module has a README (spec section, run command, test command, mock behaviour); `.env.example` lists the nine spec variables plus `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_COMPAT_MODEL`, `PUBLIC_BASE_URL` and `HF_TOKEN`; `make smoke` runs the skeleton and names the unwired stages; root `CLAUDE.md` is byte-identical to before.
**Plans**: 5 plans (suggested; plan-phase refines)

Plans:
- [ ] 01-01: Golden clips: placeholder synthesizer, G.711 8 kHz pass, `expected.json`, data README (FND-11)
- [ ] 01-02: Contracts: pydantic v2 models, JSON Schemas with drift test, shared tool cards, canonical-JSON/hash helper (FND-01, FND-02, FND-03, FND-04)
- [ ] 01-03: Fixtures: tool records, analysis results, trace stream, finished case, G3 A/B-disagreement story (FND-05, FND-06)
- [ ] 01-04: `LLMClient` adapter in `contracts/` (Anthropic, OpenAI-compatible, Mock) with tests (FND-07)
- [ ] 01-05: Repo scaffold: uv project and per-module dependency groups, Makefile, module skeletons and READMEs, `.env.example`, `.gitignore`, `scripts/smoke.sh` skeleton (FND-08, FND-09, FND-10, FND-12)

Ordering note: 01-05 and 01-01 have no dependencies; 01-02 and 01-04 follow the scaffold; 01-03 needs `expected.json` (01-01) and the models (01-02).

### Phase 2: Modules on mocks (M1 to M9)
**Goal**: Every spec module exists, runs on mocks with no GPU or network, and passes its own acceptance checks via `make test-<module>`, so one executor per module can work in parallel.
**Depends on**: Phase 1
**Spec**: Each plan reads its own section of `SPEC-deepfake-agent.md`: "M1 Intake and clip store", "M2 Tool workers" (M2A Detectors, M2B Context, M2C Boundaries), "M3 Tools manager", "M4 Orchestrator agent", "M5 Baseline and eval harness", "M6 Policy and actions", "M7 Case store and case writer", "M8 API gateway", "M9 Frontend"; shared background in "Tool inventory", "Agents and LLMs", "End-to-end workflow" and the golden clips table
**Requirements**: INTK-01, INTK-02, INTK-03, INTK-04, INTK-05, WRK-01, WRK-02, DET-01, DET-02, DET-03, DET-04, DET-05, CTX-01, CTX-02, CTX-03, CTX-04, CTX-05, BND-01, BND-02, TOOLS-01, TOOLS-02, TOOLS-03, TOOLS-04, TOOLS-05, TOOLS-06, TOOLS-07, ORCH-01, ORCH-02, ORCH-03, ORCH-04, ORCH-05, ORCH-06, ORCH-07, ORCH-08, ORCH-09, EVAL-01, EVAL-02, EVAL-03, EVAL-04, EVAL-05, EVAL-06, EVAL-07, POL-01, POL-02, POL-03, POL-04, POL-05, POL-06, POL-07, POL-08, CASE-01, CASE-02, CASE-03, CASE-04, CASE-05, CASE-06, API-01, API-02, API-03, API-04, API-05, API-06, API-07, WEB-01, WEB-02, WEB-03, WEB-04, WEB-05, WEB-06, WEB-07, WEB-08, WEB-09
**Success Criteria** (what must be TRUE):
  1. For each of the eleven module plans, `make test-<module>` (`intake`, `detectors`, `context`, `boundaries`, `tools_manager`, `orchestrator`, `baseline_eval`, `policy_actions`, `cases`, `api`, `web`) passes locally on macOS with `MOCK_TOOLS=1 MOCK_LLM=1 MOCK_TWILIO=1`, no GPU and no network; ruff is clean (tsc strict for `web/`); each plan's diff touches only its own module directory; each README states the run command, test command and what is mocked.
  2. Audio in and tool workers (M1, M2A to M2C): the same file uploaded twice returns one `clip_id` and writes no new files, a wav and a high-bitrate mp3 of one recording differ by under 50 ms, G1 to G6 ingest to 16 kHz mono, and a 0.5 s clip is rejected readably; the detector, context and boundary workers start as FastAPI services on 8101 to 8104 in `MOCK_TOOLS=1` mode meeting the common worker contract (errors come back as HTTP 200 `{"error"}`); mock mean `p_fake` on G2 exceeds G1 for both detectors; `/turns` returns a whole-clip `clip_p_fake`; G4 shows two speakers and G1 one; a 3.4 kHz low-passed clip is flagged `low_bandwidth` by the real channel analyzer; the G5, G4 and G1 change-point checks pass; real-model code paths exist behind config but are not executed.
  3. Tools manager and orchestrator (M3, M4): a killed worker yields a `failed` record and the caller continues, a repeat call returns from cache in under 10 ms, bumping one tool's version re-runs only that tool, `GET /tools/anthropic` is accepted unchanged by the Anthropic SDK, and with `MOCK_TOOLS=1` all G3 tools return fixtures with no worker; fixed mode returns valid results for G1 to G6 (G3 turn 0 `synthetic` and turn 1 `bona_fide` with `speaker_handoff`, G4 no `synthetic`), a cap of 2 tool calls yields `abstain="budget_exceeded"`, a failed `score_turns` yields an abstain naming it, an OpenAI-compatible endpoint works with no code change, and adaptive mode with the Mock LLM on G3 calls `rescore_region` because detectors A and B disagree while the G1 and G4 traces do not.
  4. Baseline and eval harness (M5): the no-LLM baseline emits `AnalysisResult` with `system="baseline"` and localizes by speaker turn and by `p_fake` change point; `mixset.py` builds the ~100-clip manifest (40/20/15/15/10 scenarios, 50 ms crossfades, one codec pass, deterministic 30/70 dev/held-out split) on placeholder sources; the manifest check passes and a loudness-only splice detector scores near chance; `make eval` regenerates `results/table.md` and `results/results.json` from cached tool outputs in one command with 95% bootstrap intervals, an "A alone (clip level)" row built from `clip_p_fake`, per-clip clip-level A scores in `results.json`, and run provenance marked mock.
  5. Product modules (M6 to M9): G3 yields `verify_contact` to Jake, `hold_new_payee` and `notify_trusted_contact` while G1 yields no actions; a NO reply gives `CONTRADICTED` and 120 s of silence gives `UNREACHABLE`; a $9,500 new-payee transfer is `HELD` and approve gives `RELEASED` while decline gives `DECLINED`; editing one stored event makes `verify_chain` fail at that seq, the G3 packet generates in under 30 s and every packet evidence number appears in a case event; the API SSE stream delivers events in `seq` order ending with `final`; the web app renders the G3 fixture with turn 0 red and turn 1 neutral, shows the detector-A whole-clip score next to the per-turn timeline, animates the G3 SSE fixture in order, completes the HELD then RELEASED/DECLINED bank flow against fixtures, and every screen passes an automated 390 px viewport check.
**Plans**: 11 plans (one per spec module, all in the same wave, depending only on Phase 1)
**UI hint**: yes

Plans:
- [ ] 02-01: M1 Intake and clip store, `intake/`, `make test-intake` (INTK-01 to INTK-05) — SPEC § M1 Intake and clip store
- [ ] 02-02: M2A Detectors, `workers/detectors/` (AntiDeepfake :8101, XLS-R + SLS :8102), `make test-detectors` (WRK-01, WRK-02 for detectors, DET-01 to DET-05) — SPEC § M2 Tool workers, M2A Detectors
- [ ] 02-03: M2B Context, `workers/context/` (:8103), `make test-context` (CTX-01 to CTX-05) — SPEC § M2 Tool workers, M2B Context
- [ ] 02-04: M2C Boundaries, `workers/boundaries/` (:8104), `make test-boundaries` (BND-01, BND-02) — SPEC § M2 Tool workers, M2C Boundaries
- [ ] 02-05: M3 Tools manager, `tools_manager/` (:8100), `make test-tools_manager` (TOOLS-01 to TOOLS-07) — SPEC § M3 Tools manager
- [ ] 02-06: M4 Orchestrator (fixed, adaptive, validation, caps), `orchestrator/`, `make test-orchestrator` (ORCH-01 to ORCH-09) — SPEC § M4 Orchestrator agent
- [ ] 02-07: M5 Baseline, eval harness, mixed-set builder, `baseline_eval/`, `make test-baseline_eval` (EVAL-01 to EVAL-07) — SPEC § M5 Baseline and eval harness
- [ ] 02-08: M6 Policy and actions with mock bank, `policy_actions/`, `make test-policy_actions` (POL-01 to POL-08) — SPEC § M6 Policy and actions
- [ ] 02-09: M7 Case store and case writer, `cases/`, `make test-cases` (CASE-01 to CASE-06) — SPEC § M7 Case store and case writer
- [ ] 02-10: M8 API gateway, `api/` (:8000), `make test-api` (API-01 to API-07) — SPEC § M8 API gateway
- [ ] 02-11: M9 Frontend, `web/` (:5173), `make test-web` (WEB-01 to WEB-09) — SPEC § M9 Frontend

Parallelism note: the eleven plans have no inter-plan dependencies. Each stubs its neighbours behind a seam (for example M3 resolves clips through a resolver seam over M1 `get()`; M4 and M5 call tools through a fixture-backed in-process client; M6 appends to an in-memory M7 sink; M8 uses in-process fakes of M1/M4/M5/M6/M7; M9 reads fixture JSON). A needed contract change goes in `CONTRACT_CHANGE.md` and stops that plan. The seams are replaced by the real modules in Phase 3.

### Phase 3: Integration I1 + I2
**Goal**: The whole G3 flow runs end to end across the real modules with every mock on (I1), and the real-tools path is wired behind the tools manager and ready for the GPU box (I2).
**Depends on**: Phase 2
**Spec**: `SPEC-deepfake-agent.md` sections "Integration checkpoints, team split and demo script" (checkpoints I1 and I2), "M8 API gateway" (the `scripts/smoke.sh` task), "M3 Tools manager", "M2 Tool workers" (common worker contract and acceptance checks), "Stack, repo layout and ports", "How we code fast without losing quality" (speed rules)
**Requirements**: INTG-01, INTG-02, INTG-03, INTG-04, REAL-01, REAL-02, REAL-03, REAL-04
**Success Criteria** (what must be TRUE):
  1. `scripts/smoke.sh` passes the full G3 flow with curl (upload, analyze, case, transfer, simulated NO reply, packet) under `MOCK_TOOLS=1 MOCK_LLM=1 MOCK_TWILIO=1` with no GPU and no network, and asserts the case ends `CONTRADICTED`, the $9,500 new-payee transfer is `HELD`, and the packet's hash chain verifies.
  2. `make dev` starts the API (8000), tools manager (8100) and web app (5173) with mocks, and the console renders G3 from the live mock-backed API: turn 0 red and turn 1 neutral on the timeline, detector A's whole-clip score beside it, the trace feed streaming `get_context`, `score_turns`, `find_boundaries`, `rescore_region`, the actions panel and the case packet.
  3. All Phase 2 fakes are replaced by the real modules through their documented interfaces (M8 to M1/M4/M5/M6/M7, M4 to M3 over HTTP, M6 to M7), no module imports another's internals, and the aggregate `make test` and ruff are green across the whole repo.
  4. Real-tools path runs locally over real HTTP: with M3 outside mock mode and the detector, context and boundary workers running in worker-level `MOCK_TOOLS=1` stub mode on 8101 to 8104, M3 returns records for all six required tools, killing a worker mid-run yields a `failed` record, and fixed mode and the baseline complete on G1 to G6.
  5. GPU-box readiness (hardware-gated): a runbook and Makefile targets start each worker in its own environment (pinned Python 3.9.0 + fairseq 0.12.2 for AntiDeepfake) on a shared `DATA_DIR`; `make test-gpu` collects the real-model acceptance checks and skips locally with an explicit reason; `scripts/regen_fixtures.py` writes real tool outputs for G1 to G6 to `contracts/fixtures/real/` without touching the story fixtures. The on-box run is a human verification item recorded when a GPU box is available.
**Plans**: 4 plans (suggested; plan-phase refines)
**UI hint**: yes

Plans:
- [ ] 03-01: I1 wiring: replace Phase 2 seams with real modules through M8, `make dev`, aggregate `make test` and ruff (INTG-01, INTG-03 backend half, INTG-04)
- [ ] 03-02: `scripts/smoke.sh` full G3 flow and console-on-live-API verification (INTG-02, INTG-03)
- [ ] 03-03: I2 live-tools path: M3 non-mock HTTP to stub-mode workers, killed-worker behaviour, fixed mode and baseline on G1 to G6, worker launch targets and GPU-box runbook (REAL-01, REAL-02)
- [ ] 03-04: GPU acceptance suite (`make test-gpu`) and `scripts/regen_fixtures.py` to `contracts/fixtures/real/` (REAL-03, REAL-04)

Integration note: these are lead-owned integration plans, so they may touch several module directories; keep each edit minimal, route any contract change through `CONTRACT_CHANGE.md`, and do not run overlapping-file plans in parallel (03-03 and 03-04 touch workers and `scripts/`; 03-01 and 03-02 touch `api/`, `orchestrator/`, `web/`, `scripts/`).

### Phase 4: Full product I3 + numbers I4 + ship
**Goal**: The four demo outcomes work on G3 end to end, `make eval` produces the adaptive-versus-baseline comparison table with intervals, and the repo ships with a README and demo runbook; the optional localizer and separation workers come last and never gate the phase.
**Depends on**: Phase 3
**Spec**: `SPEC-deepfake-agent.md` sections "Overview" (the four demo must-show outcomes), "End-to-end workflow", "Agents and LLMs", "M4 Orchestrator agent" (adaptive mode), "M6 Policy and actions" (verifier, breaker), "M7 Case store and case writer", "M5 Baseline and eval harness" (datasets, metrics and comparators, statistics), "M9 Frontend" (bank, approve, eval screens), "Integration checkpoints, team split and demo script" (I3, I4, ship, cut order, demo script); optional work: "M2 Tool workers" § M2D Localizer and § M2E Separation
**Requirements**: DEMO-01, DEMO-02, DEMO-03, DEMO-04, DEMO-05, LIVE-01, LIVE-02, H2-01, H2-02, H2-03, H2-04, H2-05, SHIP-01, SHIP-02, SHIP-03, OPT-01, OPT-02
**Success Criteria** (what must be TRUE):
  1. Outcome 1: running adaptive mode on G3 through the API and console labels only turn 0 `synthetic` and turn 1 `bona_fide` with `speaker_handoff`, the visible trace streams `get_context`, `score_turns`, `find_boundaries` and `rescore_region`, and detector A's whole-clip score appears next to the timeline (demonstrating the averaging point); this passes with the Mock LLM and, when `ANTHROPIC_API_KEY` is set, with the real `claude-sonnet-5-5` path with tokens, latency and dollar cost logged.
  2. Outcomes 2 and 3: after the G3 case opens, Jake's saved number is texted and a NO reply (simulated via `/dev/simulate-reply`, or a real signed Twilio webhook through `PUBLIC_BASE_URL` when credentials exist) marks the case `CONTRADICTED` (YES gives `VERIFIED`, 120 s of silence gives `UNREACHABLE`); on `/bank` at 390 px a $9,500 wire to a new payee shows `HELD` with the specified plain-words copy, and the trusted contact's `/approve/:token` page declines (`DECLINED`) or approves (`RELEASED`) with the result visible on the bank screen.
  3. Outcome 4: the G3 case packet shows a verified hash chain, an evidence table citing tools and a draft SAR narrative marked "DRAFT for BSA officer review", generated in under 30 s; tampering with one stored event turns the console's chain badge to failed; `scripts/smoke.sh` is extended to cover adaptive mode (asserting `rescore_region`), approve and decline by token, and the tamper check, and still passes with all mocks and no GPU.
  4. H2: one `make eval` command produces `results/table.md` and `results/results.json` with adaptive versus the no-LLM baseline on the held-out half of the own mixed set with 95% bootstrap intervals, plus A alone (clip level), B alone, fixed, the `claude-opus-5-5` upper bound, adaptive with one non-Anthropic model, and the LlamaPartialSpoof, PartialSpoof and DFToolBench rows with their caveats; tuning is confined to the dev split in code; `/eval` renders the table with run provenance (mock or real) so a mock-backed table is never presented as evidence.
  5. Ship: the README and demo runbook let a fresh reader run the mock-only demo locally and follow the GPU-box and Twilio paths (pre-flight checklist, fallbacks, consent statement, licence notes), and at freeze the aggregate `make test`, `make smoke` and ruff are green.
**Plans**: 7 plans (suggested; plan-phase refines)
**UI hint**: yes

Plans:
- [ ] 04-01: I3 adaptive mode end to end on G3 through API and console, real Anthropic path behind credentials (DEMO-01, LIVE-02)
- [ ] 04-02: Verification and held transfer: real Twilio send/receive with signature check and tunnel config behind credentials, approval-link flow at 390 px (DEMO-02, DEMO-03, LIVE-01)
- [ ] 04-03: Case packet with real case-writer path, chain-verified badge and tamper demo, extended `scripts/smoke.sh` (DEMO-04, DEMO-05)
- [ ] 04-04: I4 numbers: held-out and external-dataset runs, comparators, dev/held-out discipline, `/eval` provenance (H2-01 to H2-05)
- [ ] 04-05: Ship: README, demo runbook, freeze checks (SHIP-01 to SHIP-03)
- [ ] 04-06: OPTIONAL and deferrable, M2D Localizer `workers/localizer/` :8105, `make test-localizer` (OPT-01) — SPEC § M2D Localizer
- [ ] 04-07: OPTIONAL and deferrable, M2E Separation `workers/separation/` :8106, `make test-separation` (OPT-02) — SPEC § M2E Separation

Gating note: criteria 1 to 5 are satisfiable without 04-06 and 04-07; execute those last and only if everything else is green. Credential-gated and hardware-gated items (real Twilio, real Anthropic runs, real-output eval) each keep a mock-path equivalent that must pass locally. If forced to cut, follow the spec's cut order (M2E, M2D, live Twilio via simulated replies, the open-weights comparator row, the PartialSpoof row) and never cut the G3 demo flow or the adaptive-versus-baseline comparison on the own set.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 (Phase 2 plans run in parallel within the phase)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundations (M0 + repo scaffold) | 0/5 | Not started | - |
| 2. Modules on mocks (M1 to M9) | 0/11 | Not started | - |
| 3. Integration I1 + I2 | 0/4 | Not started | - |
| 4. Full product I3 + numbers I4 + ship | 0/7 | Not started | - |
