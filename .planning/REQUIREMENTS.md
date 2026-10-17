# Requirements: CallGuard

**Defined:** 2026-10-17
**Core Value:** When a cloned voice opens a call and a live human takes over, CallGuard flags only the cloned turn and, before any money moves, verifies the claimed person out of band and holds new-payee transfers until a second person approves.

Source: `SPEC-deepfake-agent.md`. IDs were derived from the per-module acceptance checklists, the four demo must-show outcomes and technical claim H2. Module requirements are verifiable locally with `MOCK_TOOLS=1 MOCK_LLM=1 MOCK_TWILIO=1` (no GPU, no network) unless tagged:

- **(hardware-gated)**: needs the rented GPU box; locally it is satisfied by code, collected-but-skipped tests with an explicit reason, and a runbook. The on-box run is recorded when the box is available.
- **(credential-gated)**: needs live Twilio or Anthropic credentials; every such requirement has a mock-path equivalent that must pass locally.

## v1 Requirements

Requirements for the full spec (M0 to M9). Each maps to exactly one roadmap phase.

### Foundations (M0 + repo scaffold)

- [ ] **FND-01**: `contracts/models.py` defines, in pydantic v2 and exactly as in SPEC M0, `ClipMeta`, `ToolCard`, `ToolRecord`, `Turn`, `Evidence`, `Segment`, `AnalysisResult`, `TraceEvent`, `Action`, `CaseEvent`, plus the shared Case (`OPEN`, `VERIFYING`, `VERIFIED`, `CONTRADICTED`, `UNREACHABLE`) and Transfer (`PENDING`, `HELD`, `RELEASED`, `DECLINED`) state values
- [ ] **FND-02**: JSON Schemas for every contract model are generated into `contracts/` and a test fails if they drift from `models.py`
- [ ] **FND-03**: The eight orchestrator tool cards (`get_context`, `score_turns`, `score_windows`, `rescore_region`, `find_boundaries`, `speaker_consistency`, `localize`, `separate`) are authored once as JSON in `contracts/` (name, version, description, `args_schema`, `values_schema`, `known_weaknesses`) and are the single source for M3 `GET /tools` and every worker's `GET /cards`; `score_turns` values carry per-turn `p_fake` and a whole-clip `clip_p_fake`; the `localize` card states it was trained on PartialSpoof and is weak out of domain
- [ ] **FND-04**: A canonical-JSON and event-hash helper in `contracts/` implements `hash = sha256(prev_hash + canonical_json(case_id, seq, ts, type, payload))` with 64 zeros as seq 0 `prev_hash`, as the single source of truth for fixtures and M7
- [ ] **FND-05**: `contracts/fixtures/` holds one `ToolRecord` per orchestrator tool for G3, `ToolRecord`s for the fixed-mode tool set (`get_context`, `score_turns` A and B, `score_windows` B, `find_boundaries`, `speaker_consistency`) for G1 to G6, one `AnalysisResult` per golden clip, one `TraceEvent` stream for G3, and one finished G3 case with a valid hash chain; a test validates every fixture against its model; fixtures are labeled placeholder until real outputs replace them
- [ ] **FND-06**: The G3 fixtures encode the demo story: detectors A and B disagree on turn 0 (the cloned turn) in `score_turns`, a `rescore_region` record resolves it, detector A's `clip_p_fake` is clearly lower than its turn 0 `p_fake` (the averaging point), the G3 `TraceEvent` stream runs `get_context`, `score_turns`, `find_boundaries`, `rescore_region`, `final` in order, and the G1 and G4 fixtures show no A/B disagreement
- [ ] **FND-07**: One `LLMClient` adapter with Anthropic, OpenAI-compatible and Mock implementations is selected by config alone (`MOCK_LLM=1` forces Mock); it supports system prompt, messages, native tool-use (translating tool definitions between formats) and JSON output, uses the lowest-variance sampling the API allows, and logs sampling settings, tokens, latency and dollar cost for every call
- [ ] **FND-08**: The root uv project pins Python 3.11 and declares main-env dependencies as per-module groups sufficient for every Phase 2 plan, so no module plan edits root dependency files; worker environments are per-worker directories
- [ ] **FND-09**: The `Makefile` provides `dev`, `test-<module>` for every module directory (`contracts`, `intake`, `detectors`, `context`, `boundaries`, `localizer`, `separation`, `tools_manager`, `orchestrator`, `baseline_eval`, `policy_actions`, `cases`, `api`, `web`), an aggregate `test`, `eval` and `smoke`; it works under GNU Make 3.81 and calls fixed module entry points that skeletons stub
- [ ] **FND-10**: Every module directory has a README (spec section name, run command, test command, what is mocked), a `tests/` directory with a passing placeholder test, and the `CONTRACT_CHANGE.md` convention is documented; the existing root `CLAUDE.md` is preserved unchanged
- [ ] **FND-11**: `scripts/make_golden_placeholders.py` deterministically synthesizes G1 to G6 placeholder clips per the SPEC (G3 10 s clone then 40 s real, G5 3 s crossfaded insert, G6 music bed at 10 dB SNR) through G.711 at 8 kHz; `data/golden/expected.json` records per clip the turn boundaries, speakers, labels, `mixed` and `composition`; `data/golden/README.md` states where real consented clips go and the consent-record requirement
- [ ] **FND-12**: `.env.example` lists the nine SPEC variables plus `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_COMPAT_MODEL`, `PUBLIC_BASE_URL` and `HF_TOKEN`, `.env` is gitignored, and a `scripts/smoke.sh` skeleton lists the G3 flow stages and reports which are not yet wired

### Intake (M1)

- [ ] **INTK-01**: `ingest(src, filename)` decodes wav, mp3, m4a, ogg, opus and webm with ffmpeg to mono float32 at the original rate and writes `data/clips/<clip_id>/orig.wav`, `16k.wav` (ffmpeg soxr) and `meta.json`, returning `ClipMeta`
- [ ] **INTK-02**: `clip_id` is the SHA-256 of the decoded PCM16 bytes; uploading the same file twice returns the same `clip_id` and writes no new files; one recording saved as wav and as high-bitrate mp3 decodes to the same duration within 50 ms
- [ ] **INTK-03**: G1 to G6 all ingest and each `16k.wav` is 16 kHz mono
- [ ] **INTK-04**: A clip under 1 s (for example 0.5 s) or over 10 minutes is rejected with a readable error
- [ ] **INTK-05**: `get(clip_id)` returns the stored `ClipMeta` (readable error for unknown ids) and `derive(parent_id, samples, sr, kind)` stores a derived clip (for example `speech_stem`) with `parent_clip_id` set

### Tool workers: common contract (M2)

- [ ] **WRK-01**: Every worker service implements the common contract: `GET /health` returns `{"ok": true, "version": "..."}`, `GET /cards` returns its `ToolCard`s from the shared cards, `POST /<op>` takes `{clip_id, path_16k, path_orig, params}` and returns `{values, version, flags, runtime_ms}`, and any error returns HTTP 200 `{"error": "..."}` without crashing the process (M2A to M2C here; M2D and M2E conform under OPT-01 and OPT-02)
- [ ] **WRK-02**: Workers honor `MOCK_TOOLS=1` by serving deterministic outputs derived from `contracts/fixtures` and the golden manifest without loading any model, and real-model code paths are lazily imported behind config so the HTTP contract runs locally with no GPU

### Detectors (M2A)

- [ ] **DET-01**: Two FastAPI services, AntiDeepfake on 8101 and XLS-R + SLS on 8102, each in its own environment directory, expose identical operations `/turns`, `/windows` and `/region`
- [ ] **DET-02**: `/turns` scores each speaker turn as one input (batched), splits turns over 30 s into 30 s chunks and averages logits, returns per-turn `p_fake` with raw logits plus a whole-clip `clip_p_fake`, and flags inputs under 1 s `too_short`
- [ ] **DET-03**: `/windows` returns `[{t_start, t_end, p_fake}]` for a range given `window_s` and `hop_s`, and `/region` scores exactly `[start, end]` (up to 30 s) as one input
- [ ] **DET-04**: `p_fake` is softmax index 0 (fake) for AntiDeepfake and normalized for XLS-R + SLS, checkpoints are named in config (default `nii-yamagishilab/wav2vec-large-anti-deepfake-nda`; XLS-R variants are a config swap; XLS-R + SLS uses SLSforADD with XLS-R 300M), and the AntiDeepfake env pins Python 3.9.0 and fairseq 0.12.2 with setup documented
- [ ] **DET-05**: In mock mode mean `p_fake` on G2 exceeds G1 for both detectors and G3 turn 0 shows the A/B disagreement defined in the fixtures

### Context (M2B)

- [ ] **CTX-01**: `/context` returns in one call Silero VAD speech segments and speech ratio, diarization turns (1 to 3 speakers, same-speaker gaps under 0.3 s merged), VoxLingua107 language and confidence on the longest turn, per-turn channel features, and NISQA MOS on the original-rate copy
- [ ] **CTX-02**: The channel analyzer (real DSP, runs locally) computes per-turn bandwidth (median 99% spectral rolloff), clipping fraction (|x| of 0.99 or more) and SNR (VAD speech versus non-speech energy); a clip low-passed at 3.4 kHz gets the `low_bandwidth` flag
- [ ] **CTX-03**: `/speaker_consistency` caches ECAPA embeddings per turn and returns cosine similarity and `same_speaker` at a threshold tuned on G4
- [ ] **CTX-04**: G4 returns two speakers and G1 returns one, and G3 turn boundaries land within 0.5 s of the manifest (mock mode)
- [ ] **CTX-05**: Real-model paths for Silero VAD, pyannote (gated, `HF_TOKEN`), VoxLingua107, NISQA and SpeechBrain ECAPA exist behind config, and a model that fails to load degrades the output with a flag rather than crashing the worker

### Boundaries (M2C)

- [ ] **BND-01**: `/boundaries` takes `start`, `end` and `signals` (any of `p_fake_A`, `p_fake_B`, `bandwidth`, `loudness`, `snr`), builds each as a 0.5 s hop series (`p_fake` from the detector workers' `/windows` with 2 s windows, channel series computed locally), z-scores them, runs `ruptures` Pelt with RBF cost, and returns per change point the time, each signal's left-versus-right mean difference, and `moved`
- [ ] **BND-02**: The penalty is tuned on G3 and G5 only; G5 returns a `p_fake` change point within 0.5 s of each insert edge, G4 returns a change point whose `moved` is a channel signal, and G1 returns no change point with `moved` set to `p_fake` (mock mode)

### Tools manager (M3)

- [ ] **TOOLS-01**: `GET /tools` returns the `ToolCard`s for the orchestrator tools (six required; `localize` and `separate` advertised only when enabled by config), served from the shared cards with no worker running
- [ ] **TOOLS-02**: `GET /tools/anthropic` returns tool definitions in Anthropic tool-use format generated from the cards, and the output is accepted unchanged by the Anthropic SDK
- [ ] **TOOLS-03**: `POST /tools/{name}` with `{clip_id, params, trace_id}` looks up the registry (tool to worker URL, operation, version; `get_context` fans out to the context worker in one call), validates `params` against `args_schema` (bad argument returns `status="invalid_input"` with the message), resolves `clip_id` to paths through a clip-resolver seam over M1 `get()`, and returns one `ToolRecord`
- [ ] **TOOLS-04**: Results are cached on disk keyed by the SHA-256 of `clip_id`, tool, version and canonical JSON params; a repeat call returns in under 10 ms and bumping one tool's version re-runs only that tool
- [ ] **TOOLS-05**: Each worker call times out at 60 s with one retry on connection error, and any worker failure becomes `status="failed"`; a worker killed mid-run yields a `failed` record and the caller keeps going
- [ ] **TOOLS-06**: `GET /budget/{trace_id}` returns tool calls and seconds used so far for that trace
- [ ] **TOOLS-07**: With `MOCK_TOOLS=1` all G3 tools (and the fixed-mode tool set for G1 to G6) return `ToolRecord`s from `contracts/fixtures` keyed by clip and tool with no worker running

### Orchestrator (M4)

- [ ] **ORCH-01**: `run(clip_id, mode, model, caps)` is an async iterator of `TraceEvent`s whose last event is `kind="final"` with an `AnalysisResult`; failures become error events or abstain results, never exceptions; the orchestrator has no side-effect tools and never sees transcripts or free-text metadata
- [ ] **ORCH-02**: Fixed mode (default `claude-haiku-5-5`) runs `get_context`, `score_turns` A and B in parallel, `score_windows` with B (4 s windows, 1 s hop) inside every turn, `find_boundaries` over the whole clip with all signals, `speaker_consistency` for every same-label turn pair, then one LLM call returning `AnalysisResult` JSON, valid for G1 to G6 from fixtures
- [ ] **ORCH-03**: Fixed-mode results match `data/golden/expected.json` labels and composition from fixtures: G3 turn 0 `synthetic` and turn 1 `bona_fide` with `speaker_handoff`, and G4 returns no `synthetic` segment
- [ ] **ORCH-04**: Adaptive mode (default `claude-sonnet-5-5`) always runs `get_context` and `score_turns` (A and B) before the model is called, then runs a native tool-use loop over `GET /tools/anthropic` with parallel tool calls allowed
- [ ] **ORCH-05**: Default caps of 12 steps, 20 tool calls, 90 s and $0.25 per clip are enforced (using M3 `/budget/{trace_id}`); a breach, including a cap of 2 tool calls, ends with `abstain="budget_exceeded"` and never a crash
- [ ] **ORCH-06**: When detectors A and B disagree on a turn the agent calls `rescore_region` on it, and a turn that still disagrees is `uncertain`; with `MOCK_LLM=1` and `MOCK_TOOLS=1` the adaptive trace on G3 shows `get_context`, `score_turns`, `find_boundaries`, `rescore_region`, and the G1 and G4 traces do not call `rescore_region`
- [ ] **ORCH-07**: A fixture where `score_turns` failed returns an abstain naming that tool (for example `tool_failed:score_turns`); turns flagged `too_short` are never labeled `synthetic` on their own score; a speaker change alone is never evidence of synthesis
- [ ] **ORCH-08**: `validate.py` parses with pydantic and retries once with the error message (second failure returns `abstain="invalid_output"`), rejects any `tool_score` not in a `ToolRecord` from this trace, rejects overlapping or out-of-clip segments, and logs tokens, latency and dollar cost on every run into `usage`
- [ ] **ORCH-09**: Swapping `model` to an OpenAI-compatible endpoint runs both modes with no code change (tested against a local fake OpenAI-compatible server), and `orchestrator/llm_client.py` uses the shared adapter

### Baseline and eval harness (M5)

- [ ] **EVAL-01**: The no-LLM baseline runs `get_context`, averages A and B `score_turns` per turn, labels a turn `synthetic` above τ (tuned on the dev split), runs `find_boundaries` inside each turn and, where `moved` is `p_fake` with change of 0.4 or more, splits the turn and labels each side by window mean, emitting `AnalysisResult` with `system="baseline"`
- [ ] **EVAL-02**: `mixset.py` builds the ~100-clip mixed set (40 clone-to-human handoffs, 20 real-to-real handoffs, 15 single real, 15 single cloned, 10 same-speaker cloned inserts), matching loudness with `pyloudnorm`, crossfading every join over 50 ms, and passing each whole clip through one codec (G.711 μ-law 8 kHz or Opus 16 kbps via ffmpeg); it runs locally on placeholder sources and on real consented recordings plus open-TTS clones when supplied
- [ ] **EVAL-03**: The builder writes a JSONL manifest (`clip`, `codec`, `scenario`, `segments[{start, end, speaker, label}]`) with a deterministic 30% dev / 70% held-out split, and a manifest check confirms every segment label matches the audio it points to
- [ ] **EVAL-04**: A plain splice detector (change point on loudness alone) scores near chance on the crossfaded set, verified by an automated check; otherwise the set has a shortcut
- [ ] **EVAL-05**: The harness computes utterance EER (score = max segment `tool_score`), segment EER at 160 ms and 640 ms, per-turn accuracy, boundary F1 at 0.5 s tolerance, abstain rate, and tool calls, seconds and dollars per clip, each with a 95% bootstrap interval from 1,000 resamples
- [ ] **EVAL-06**: `make eval` regenerates `results/table.md` and `results/results.json` from cached tool outputs in one command, covering A alone (clip level, from `clip_p_fake`), B alone, baseline, fixed, adaptive and adaptive with one non-Anthropic model; `results.json` carries each clip's clip-level detector-A score and labels run provenance (mock or real)
- [ ] **EVAL-07**: Dataset adapters exist for a LlamaPartialSpoof subset (out-of-domain), a PartialSpoof subset (in-domain sanity) and DFToolBench-A-500 (tool-use smoke test), with download and license notes and subsampling, tested on tiny local fixtures

### Policy and actions (M6)

- [ ] **POL-01**: `claim.py` runs faster-whisper on each `synthetic` segment only (fixture transcript in mock mode, real path behind config), fuzzy-matches contact names and relationship words ("grandma", "it's me", "your grandson") from `contacts.yaml`, and never sends the transcript back to the orchestrator
- [ ] **POL-02**: When string matching fails, the `claude-haiku-5-5` fallback receives the transcript as quoted data and the contact list as options and may only return a contact id or `unknown` (anything else is coerced to `unknown`)
- [ ] **POL-03**: `rules.yaml` is evaluated top to bottom with first match winning (`clone_claims_contact`, `clone_unknown_identity`, `analysis_abstained`, `all_bona_fide`); G3 produces `verify_contact` to Jake, `hold_new_payee` and `notify_trusted_contact`; G1 produces no actions; `Action.target` is a contact id, never a raw number from the call
- [ ] **POL-04**: `verifier.py` texts the contact's saved number from `contacts.yaml` with "Hi Jake, someone is calling Grandma with your voice and asking for money. Reply YES if it's really you, NO if not.", never dials or texts a number spoken on the call or sent as caller metadata, and with `MOCK_TWILIO=1` sends nothing and accepts replies through the simulate-reply hook
- [ ] **POL-05**: The inbound reply handler checks the `X-Twilio-Signature` header (invalid signature rejected) and then parses YES or NO
- [ ] **POL-06**: `breaker.py` implements the case state machine OPEN to VERIFYING(contact) to VERIFIED (reply YES), CONTRADICTED (reply NO) or UNREACHABLE (no reply in 120 s; timeout configurable for tests)
- [ ] **POL-07**: The transfer breaker and in-process mock bank (balance, transfers, one-time approval tokens) hold a new-payee transfer while the case is not VERIFIED (a $9,500 new-payee transfer is `HELD`), move `HELD` to `RELEASED` on trusted-contact approval or when the case becomes VERIFIED, move `HELD` to `DECLINED` on decline, and let transfers through when there is no case or every segment is `bona_fide` (G1)
- [ ] **POL-08**: Every state change appends a `CaseEvent` through the M7 interface (an in-memory fake sink in this phase's tests)

### Case store and case writer (M7)

- [ ] **CASE-01**: SQLite tables `cases(id, member_id, clip_id, state, created_at)` and `events(case_id, seq, ts, type, payload_json, prev_hash, hash)` are insert-only for events, every event is mirrored to `data/cases/<case_id>.jsonl`, and the interface `open_case`, `append`, `get_case`, `verify_chain`, `write_packet` matches SPEC M7
- [ ] **CASE-02**: Event hashes use the shared `contracts` helper (seq 0 `prev_hash` is 64 zeros) and editing one stored event makes `verify_chain` fail at that seq
- [ ] **CASE-03**: `get_case` returns the case state derived from state-change events using the shared Case values
- [ ] **CASE-04**: The case writer makes one `claude-sonnet-5-5` call (Mock locally) over the structured events, passing any transcript text as quoted data, and returns an incident summary, timeline, evidence table citing tool names, and a SAR narrative covering who, what, when, where, why and how, marked "DRAFT for BSA officer review" and referencing FinCEN alert FIN-2024-Alert004
- [ ] **CASE-05**: The packet exports as JSON and Markdown, and the G3 demo case produces a packet in under 30 s
- [ ] **CASE-06**: Every number in the packet's evidence table appears in a case event, verified by an automated check

### API gateway (M8)

- [ ] **API-01**: `POST /clips` (multipart) ingests audio through M1 and returns `ClipMeta`; an intake rejection maps to a readable 4xx
- [ ] **API-02**: `POST /analyze` with `{clip_id, mode, model}` starts an in-process asyncio job (`baseline`, `fixed` or `adaptive`), `GET /analyze/{job_id}` returns the final `AnalysisResult`, and `GET /analyze/{job_id}/stream` is an SSE stream of `TraceEvent`s in `seq` order ending with a `final` event
- [ ] **API-03**: `POST /cases/from-analysis` with `{job_id, member_id}` opens a case and runs policy, `GET /cases/{case_id}` returns state, events and chain status, and `GET /cases/{case_id}/packet` returns the incident packet and SAR draft
- [ ] **API-04**: `POST /bank/transfers` with `{member_id, payee, amount, new_payee}` returns `PENDING` or `HELD`, and `POST /bank/transfers/{id}/approve` or `/decline` with `{token}` acts as the second key for a held transfer
- [ ] **API-05**: `POST /twilio/sms` checks the Twilio signature, `POST /dev/simulate-reply` fakes a YES or NO only when `MOCK_TWILIO=1`, and `GET /eval/results` serves `results/results.json`
- [ ] **API-06**: Job results persist in SQLite so a restart does not lose the demo case, CORS allows port 5173, logs are JSON lines carrying `trace_id` or `case_id`, and every route works with all mocks on (tested with in-process fakes of neighbouring modules)
- [ ] **API-07**: `POST /twilio/recording` (stretch) ingests a forwarded-call recording through M1 and starts an analysis job, working with a posted file under `MOCK_TWILIO=1`

### Frontend (M9)

- [ ] **WEB-01**: A Vite + React + TypeScript (strict) + Tailwind + wavesurfer.js regions app on 5173 builds, type-checks and runs against fixture JSON with no backend, behind an API client that can switch to the live API
- [ ] **WEB-02**: `/console` has a `ClipPicker` (upload a file or pick G1 to G6) and a `ModeSelector` (baseline, fixed or adaptive plus a model dropdown)
- [ ] **WEB-03**: `TraceFeed` shows one row per SSE event (tool name, arguments, short result, milliseconds) with failed calls in a warning colour, and the G3 SSE fixture animates in `seq` order
- [ ] **WEB-04**: `Timeline` shows a waveform with one region per segment and a speaker lane (`synthetic` critical colour, `uncertain` warning colour, `bona_fide` neutral; the G3 fixture renders turn 0 red and turn 1 neutral) and `SegmentTable` lists start, end, speaker, label, `tool_score` and evidence
- [ ] **WEB-05**: A clip-level detector-A score (from the `score_turns` A `clip_p_fake`) is shown next to the per-turn timeline with copy that contrasts whole-clip averaging with the per-turn result
- [ ] **WEB-06**: `ActionsPanel` shows verification status per contact with mock-only YES and NO buttons, and `CasePacket` shows the summary, SAR draft and a "chain verified" badge
- [ ] **WEB-07**: `/bank` shows balance, send money and transfer status in plain words (held copy: "Paused for your safety. We could not confirm the caller was Jake. We've asked your trusted contact to approve this transfer."), `/approve/:token` shows amount, payee, why held, Approve and Decline, and the flow shows `HELD` then `RELEASED` or `DECLINED` after the approve page is used
- [ ] **WEB-08**: `/eval` renders the comparison table from the `GET /eval/results` shape, including 95% intervals and the A-alone clip-level row
- [ ] **WEB-09**: Every screen works at 390 px wide, checked by an automated viewport test

### Integration I1 (mock end to end)

- [ ] **INTG-01**: The Phase 2 module fakes are replaced by the real modules through their documented interfaces (M8 to M1, M4, M5, M6, M7; M4 to M3 over HTTP; M5 to M3 and M4; M6 to M7) and no module imports another module's internals
- [ ] **INTG-02**: `scripts/smoke.sh` passes the full G3 flow with curl (upload, analyze, case, transfer, simulated NO reply, packet) under `MOCK_TOOLS=1 MOCK_LLM=1 MOCK_TWILIO=1` with no GPU and no network, asserting the case is `CONTRADICTED`, the $9,500 transfer is `HELD` and the chain verifies
- [ ] **INTG-03**: `make dev` starts the API (8000), tools manager (8100) and web app (5173) with mocks, and the console renders G3 from the live mock-backed API (turn 0 red, turn 1 neutral, trace streaming, actions panel, case packet)
- [ ] **INTG-04**: The aggregate `make test` passes across every module and ruff is clean across the repo

### Real tools I2

- [ ] **REAL-01**: With M3 not in `MOCK_TOOLS` mode and the M2A to M2C workers running over real HTTP in worker-level `MOCK_TOOLS=1` stub mode on 8101 to 8104, M3 returns `ToolRecord`s for all six required tools; killing a worker yields a `failed` record and fixed mode and the baseline still complete on G1 to G6
- [ ] **REAL-02**: A GPU-box runbook and Makefile targets bring up each worker in its own environment (including the pinned Python 3.9.0 + fairseq 0.12.2 AntiDeepfake env) sharing `DATA_DIR`, covering gated pyannote access (`HF_TOKEN`), CC BY-NC-SA licence notes and the drop-a-model-after-20-minutes rule
- [ ] **REAL-03**: A GPU acceptance suite (pytest marker, for example `make test-gpu`) holds the real-model checks: detector index order confirmed on a known fake and known real clip, mean `p_fake` G2 above G1 for both detectors, `/turns` on G3 under 5 s, G4 two speakers and G1 one, G3 turn boundaries within 0.5 s, 3.4 kHz low-pass flagged `low_bandwidth`, G5 change points within 0.5 s of insert edges, G4 change point `moved` a channel signal, G1 none on `p_fake` **(hardware-gated)**
- [ ] **REAL-04**: `scripts/regen_fixtures.py` runs each tool on G1 to G6 through M3 against live workers and writes the resulting `ToolRecord`s and `AnalysisResult`s to a separate `contracts/fixtures/real/` set, selectable by config, leaving the story fixtures untouched **(hardware-gated for the real run)**

### Demo outcomes I3

- [ ] **DEMO-01**: Outcome 1 (adaptive mode): on G3 through the API and console the agent labels only turn 0 `synthetic` and turn 1 `bona_fide` with `speaker_handoff`, the visible trace streams `get_context`, `score_turns`, `find_boundaries` and `rescore_region`, and the detector-A whole-clip score appears beside the timeline; works with the Mock LLM and, with credentials, the real `claude-sonnet-5-5` path
- [ ] **DEMO-02**: Outcome 2: after the G3 case opens, Jake's saved number is texted, a NO reply (simulated, or a real signed Twilio webhook) marks the case `CONTRADICTED`, a YES marks it `VERIFIED`, and no reply in 120 s marks it `UNREACHABLE`
- [ ] **DEMO-03**: Outcome 3: on `/bank` at 390 px a $9,500 wire to a new payee shows `HELD` with the specified copy, and the trusted contact's `/approve/:token` page declines (`DECLINED`) or approves (`RELEASED`), with the result visible on the bank screen
- [ ] **DEMO-04**: Outcome 4: the case packet for the G3 demo case shows a verified hash chain, an evidence table citing tools and a draft SAR narrative, and tampering with a stored event turns the chain badge to failed; packet generation takes under 30 s
- [ ] **DEMO-05**: `scripts/smoke.sh` is extended to cover adaptive mode (asserting `rescore_region` in the trace), approve and decline via token, and a tamper check, and still passes with all mocks and no GPU

### Live paths I3 (credential-gated)

- [ ] **LIVE-01**: The real Twilio path sends the verification text from `TWILIO_FROM` to the saved number and receives the reply at `PUBLIC_BASE_URL` (ngrok or cloudflared) with `X-Twilio-Signature` verified, falling back to simulated replies when `MOCK_TWILIO=1` or credentials are absent **(credential-gated)**
- [ ] **LIVE-02**: The real Anthropic path runs adaptive (`claude-sonnet-5-5`), fixed (`claude-haiku-5-5`) and the case writer (`claude-sonnet-5-5`) on G3 with tokens, latency and dollar cost logged per run **(credential-gated)**

### Numbers I4 (H2)

- [ ] **H2-01**: A single `make eval` command on the integrated stack produces `results/table.md` and `results/results.json` comparing adaptive against the no-LLM baseline on the held-out half of the own mixed set with 95% bootstrap intervals on every number
- [ ] **H2-02**: The table also includes A alone (clip level), B alone, fixed (`claude-haiku-5-5`), the `claude-opus-5-5` upper bound, and adaptive with one non-Anthropic model through the OpenAI-compatible client
- [ ] **H2-03**: The table reports the LlamaPartialSpoof subset (out-of-domain) with the PartialSpoof subset (in-domain sanity) and DFToolBench-A-500 (tool-use smoke) rows, each with its dataset caveat
- [ ] **H2-04**: Dev/held-out discipline is enforced in code: τ, boundary penalties and prompts are tuned on the dev split only, and reported numbers come from the held-out split only
- [ ] **H2-05**: Results are served by `GET /eval/results`, rendered on `/eval` with run provenance (mock or real) displayed so a mock-backed table is never presented as evidence for H2

### Ship

- [ ] **SHIP-01**: The README explains what CallGuard is, the mock-only local setup, the GPU-box path, the env vars, and run and test commands per module, and includes the consent statement
- [ ] **SHIP-02**: A demo runbook gives the 2-minute script with exact steps, a pre-flight checklist (verified Twilio numbers, tunnel, gated pyannote terms, consent records, real clips in place) and fallbacks (simulated replies, fixtures)
- [ ] **SHIP-03**: At freeze, the aggregate `make test`, `make smoke` and ruff are green and the licence notes (CC BY-NC-SA weights) are recorded

### Optional and deferrable (not on the critical path)

- [ ] **OPT-01**: M2D localizer on port 8105 wraps CFPRF or MRM, `/localize` returns frame probabilities and segments above 0.5, its tool card states the PartialSpoof training and weak out-of-domain behaviour, it conforms to WRK-01, and G5 returns a segment overlapping the insert; M3 advertises `localize` when enabled
- [ ] **OPT-02**: M2E separation worker on port 8106 runs Demucs `htdemucs`, keeps the vocals stem, saves it through M1 `derive()` and returns the new `clip_id`, conforms to WRK-01, and the G6 speech stem has a higher NISQA MOS than the mixed clip; M3 advertises `separate` when enabled

## v2 Requirements

Deferred to a future release. Tracked but not in the current roadmap.

### Export

- **EXP-01**: The case packet exports as PDF (SPEC marks PDF optional)

### Streaming

- **STRM-01**: Live in-call streaming analysis (SPEC: stretch, "not today")

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Live in-call streaming | SPEC "Not today"; upload and forwarded recordings only |
| Training or fine-tuning detectors | SPEC "Not today"; detectors are used as published |
| Native mobile apps | SPEC "Not today"; phone-width web screens instead |
| LLM-assigned scores or LLM decisions in policy | Violates the LLM call rules; scores come from tools, actions from rules |
| Orchestrator side-effect tools; transcripts or free-text metadata to the orchestrator | SPEC rule |
| Dialing or texting a number heard on the call or sent as caller metadata | Security rule; saved contact numbers only |
| Committing real consented or cloned voice recordings to the repo | Consent and privacy; placeholders are synthesized, real clips are documented as external |
| Production bank integration | Mock bank only |
| Commercial use of AntiDeepfake and NISQA weights | CC BY-NC-SA 4.0 non-commercial licence |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 | Phase 1 | Pending |
| FND-02 | Phase 1 | Pending |
| FND-03 | Phase 1 | Pending |
| FND-04 | Phase 1 | Pending |
| FND-05 | Phase 1 | Pending |
| FND-06 | Phase 1 | Pending |
| FND-07 | Phase 1 | Pending |
| FND-08 | Phase 1 | Pending |
| FND-09 | Phase 1 | Pending |
| FND-10 | Phase 1 | Pending |
| FND-11 | Phase 1 | Pending |
| FND-12 | Phase 1 | Pending |
| INTK-01 | Phase 2 | Pending |
| INTK-02 | Phase 2 | Pending |
| INTK-03 | Phase 2 | Pending |
| INTK-04 | Phase 2 | Pending |
| INTK-05 | Phase 2 | Pending |
| WRK-01 | Phase 2 | Pending |
| WRK-02 | Phase 2 | Pending |
| DET-01 | Phase 2 | Pending |
| DET-02 | Phase 2 | Pending |
| DET-03 | Phase 2 | Pending |
| DET-04 | Phase 2 | Pending |
| DET-05 | Phase 2 | Pending |
| CTX-01 | Phase 2 | Pending |
| CTX-02 | Phase 2 | Pending |
| CTX-03 | Phase 2 | Pending |
| CTX-04 | Phase 2 | Pending |
| CTX-05 | Phase 2 | Pending |
| BND-01 | Phase 2 | Pending |
| BND-02 | Phase 2 | Pending |
| TOOLS-01 | Phase 2 | Pending |
| TOOLS-02 | Phase 2 | Pending |
| TOOLS-03 | Phase 2 | Pending |
| TOOLS-04 | Phase 2 | Pending |
| TOOLS-05 | Phase 2 | Pending |
| TOOLS-06 | Phase 2 | Pending |
| TOOLS-07 | Phase 2 | Pending |
| ORCH-01 | Phase 2 | Pending |
| ORCH-02 | Phase 2 | Pending |
| ORCH-03 | Phase 2 | Pending |
| ORCH-04 | Phase 2 | Pending |
| ORCH-05 | Phase 2 | Pending |
| ORCH-06 | Phase 2 | Pending |
| ORCH-07 | Phase 2 | Pending |
| ORCH-08 | Phase 2 | Pending |
| ORCH-09 | Phase 2 | Pending |
| EVAL-01 | Phase 2 | Pending |
| EVAL-02 | Phase 2 | Pending |
| EVAL-03 | Phase 2 | Pending |
| EVAL-04 | Phase 2 | Pending |
| EVAL-05 | Phase 2 | Pending |
| EVAL-06 | Phase 2 | Pending |
| EVAL-07 | Phase 2 | Pending |
| POL-01 | Phase 2 | Pending |
| POL-02 | Phase 2 | Pending |
| POL-03 | Phase 2 | Pending |
| POL-04 | Phase 2 | Pending |
| POL-05 | Phase 2 | Pending |
| POL-06 | Phase 2 | Pending |
| POL-07 | Phase 2 | Pending |
| POL-08 | Phase 2 | Pending |
| CASE-01 | Phase 2 | Pending |
| CASE-02 | Phase 2 | Pending |
| CASE-03 | Phase 2 | Pending |
| CASE-04 | Phase 2 | Pending |
| CASE-05 | Phase 2 | Pending |
| CASE-06 | Phase 2 | Pending |
| API-01 | Phase 2 | Pending |
| API-02 | Phase 2 | Pending |
| API-03 | Phase 2 | Pending |
| API-04 | Phase 2 | Pending |
| API-05 | Phase 2 | Pending |
| API-06 | Phase 2 | Pending |
| API-07 | Phase 2 | Pending |
| WEB-01 | Phase 2 | Pending |
| WEB-02 | Phase 2 | Pending |
| WEB-03 | Phase 2 | Pending |
| WEB-04 | Phase 2 | Pending |
| WEB-05 | Phase 2 | Pending |
| WEB-06 | Phase 2 | Pending |
| WEB-07 | Phase 2 | Pending |
| WEB-08 | Phase 2 | Pending |
| WEB-09 | Phase 2 | Pending |
| INTG-01 | Phase 3 | Pending |
| INTG-02 | Phase 3 | Pending |
| INTG-03 | Phase 3 | Pending |
| INTG-04 | Phase 3 | Pending |
| REAL-01 | Phase 3 | Pending |
| REAL-02 | Phase 3 | Pending |
| REAL-03 | Phase 3 | Pending |
| REAL-04 | Phase 3 | Pending |
| DEMO-01 | Phase 4 | Pending |
| DEMO-02 | Phase 4 | Pending |
| DEMO-03 | Phase 4 | Pending |
| DEMO-04 | Phase 4 | Pending |
| DEMO-05 | Phase 4 | Pending |
| LIVE-01 | Phase 4 | Pending |
| LIVE-02 | Phase 4 | Pending |
| H2-01 | Phase 4 | Pending |
| H2-02 | Phase 4 | Pending |
| H2-03 | Phase 4 | Pending |
| H2-04 | Phase 4 | Pending |
| H2-05 | Phase 4 | Pending |
| SHIP-01 | Phase 4 | Pending |
| SHIP-02 | Phase 4 | Pending |
| SHIP-03 | Phase 4 | Pending |
| OPT-01 | Phase 4 | Pending |
| OPT-02 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 109 total
- Mapped to phases: 109
- Unmapped: 0 ✓

---
*Requirements defined: 2026-10-17*
*Last updated: 2026-10-17 after initial roadmap creation*
