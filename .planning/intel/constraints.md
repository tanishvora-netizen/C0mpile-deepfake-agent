# Constraints (from SPECs)

All entries sourced from /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md. Entries are ordered: cross-cutting first, then M0 through M9 (one plan per module suggested by the caller). Repo layout root in SPEC is `callguard/`.

## Stack, repo layout and ports
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: protocol
- content:
  - One monorepo, one directory per module, every heavy model in its own environment behind HTTP. All backend services on one rented GPU box sharing `DATA_DIR`; laptops run web app and mocks.
  - Main env: Python 3.11 managed with `uv`; FastAPI, pydantic v2, httpx, `anthropic` SDK, SQLite, pytest, ruff.
  - Worker envs: one per worker. AntiDeepfake pins Python 3.9.0 and fairseq 0.12.2, so never shares an env. Libraries: torch, silero-vad, pyannote.audio, speechbrain, ruptures, faster-whisper, ffmpeg.
  - Frontend: Vite, React, TypeScript, Tailwind, wavesurfer.js with regions plugin.
  - Telephony: Twilio Python SDK; public tunnel (ngrok or cloudflared) for webhooks.
  - Layout:
    ```
    callguard/
      CLAUDE.md                 # rules for every coding subagent
      Makefile                  # make dev, make test-<module>, make eval, make smoke
      contracts/                # M0: models.py, JSON schemas, fixtures/  (lead owns)
      intake/                   # M1
      workers/
        detectors/              # M2A: antideepfake/, xlsr_sls/  (separate envs)
        context/                # M2B: vad, diarization, lid, channel, nisqa, ecapa
        boundaries/             # M2C: window scorer, change points
        localizer/              # M2D (optional): CFPRF or MRM
        separation/             # M2E (optional): Demucs
      tools_manager/            # M3
      orchestrator/             # M4
      baseline_eval/            # M5
      policy_actions/           # M6
      cases/                    # M7
      api/                      # M8
      web/                      # M9
      data/golden/              # G1 to G6 clips + expected.json
      scripts/smoke.sh          # full G3 flow with every mock on
    ```
  - Ports: API gateway 8000 (M8); Tools manager 8100 (M3); AntiDeepfake worker 8101 (M2A); XLS-R + SLS worker 8102 (M2A); Context worker 8103 (M2B); Boundaries worker 8104 (M2C); Localizer worker 8105 optional (M2D); Separation worker 8106 optional (M2E); Web app 5173 (M9).
  - Env vars (all in `.env`, never committed): `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `TOOLS_URL`, `DATA_DIR`, `MOCK_TOOLS`, `MOCK_LLM`, `MOCK_TWILIO`.

## Rules for every coding subagent (root CLAUDE.md content)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: protocol
- content:
  1. Read contracts/models.py, this module's README and its spec section before writing code.
  2. Edit only files inside your module directory. Need a contract change? Write it in CONTRACT_CHANGE.md and stop.
  3. Ship a mock: the module must run with MOCK_*=1 from contracts/fixtures, with no GPU and no network.
  4. Never raise across a module boundary. Return ToolRecord(status="failed") or an error TraceEvent.
  5. Tests live in <module>/tests and use data/golden. `make test-<module>` must pass before you hand back.
  6. Typed Python, pydantic at every boundary, ruff clean. TypeScript strict in web/.
  7. Log JSON lines to stdout, always with trace_id or case_id.
  8. No secrets in code; read env vars.
  9. Hand back: what you built, how to run it, what is still mocked, what failed.

## Definition of done and speed rules (all modules)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: nfr
- content:
  - Done = acceptance checks pass, the mock runs with no GPU or network, README states run and test commands, ruff is clean.
  - Run every worker once on G1 to G6 and commit the `ToolRecord`s as fixtures, so orchestrator, policy and frontend iterate with no GPU in the loop.
  - Cache tool outputs by `clip_id`, tool, version and parameters; never rerun a detector on the same input.
  - If a model will not load within 20 minutes, drop it and continue.
  - Tune prompts and thresholds on a dev split; report only on the held-out split.
  - Method: contracts first, a mock for every module, same six golden clips as every module's tests, fixed integration checkpoints.

## LLM call rules
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: nfr
- content:
  - No LLM ever sets a score. Every continuous score comes from a tool output; the validator checks that each `tool_score` appears in a `ToolRecord` from the trace.
  - The orchestrator has no side-effect tools and never sees transcripts or free-text metadata.
  - Use the lowest-variance sampling settings the API allows, logged with every run.
  - All calls go through one `LLMClient` adapter (Anthropic, OpenAI-compatible, Mock), so swapping models is a config change.
  - Model strings: adaptive `claude-sonnet-5-5`; fixed `claude-haiku-5-5`; eval upper bound `claude-opus-5-5`; case writer `claude-sonnet-5-5`; name-matcher fallback `claude-haiku-5-5`; cross-provider = open-weights model via vLLM or Ollama.

## Golden clips G1-G6 (shared test data)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: nfr
- content:
  - Record in the first 30 minutes in `data/golden/`. Pass every clip through G.711 at 8 kHz after mixing. Keep written consent for every cloned voice.
  - G1: one real speaker, 30 s. Expect all `bona_fide`, `mixed=false`.
  - G2: one cloned speaker, 30 s. Expect all `synthetic`, `mixed=false`.
  - G3: 10 s cloned "Jake", then 40 s real "lawyer" (the demo clip). Expect turn 0 `synthetic`, turn 1 `bona_fide`, `speaker_handoff`.
  - G4: two real speakers handing off. Expect all `bona_fide`; catches speaker-change false alarms.
  - G5: one real speaker with a 3 s cloned insert, crossfaded. Expect insert `synthetic`, `splice`.
  - G6: G3 with a music bed at 10 dB SNR. Expect same as G3, `overlay` flag allowed.

## Tool inventory (orchestrator-visible)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: api-contract
- content:
  - Eight orchestrator tools, all served by the tools manager; six required, two optional (`localize`, `separate`). `transcribe` exists but is callable only by the policy layer.
  - `get_context`: wraps Silero VAD, pyannote diarization, VoxLingua107 LID, channel analyzer, NISQA. Args `clip_id`. Returns speech segments, speaker turns, language + confidence, per-turn bandwidth, clipping and SNR, MOS. Worker context :8103.
  - `score_turns`: wraps AntiDeepfake (A) or XLS-R + SLS (B). Args `clip_id`, `detector`. Returns `p_fake` per speaker turn. Worker A :8101, B :8102.
  - `score_windows`: window scorer over one detector. Args `clip_id`, `detector`, `start`, `end`, `window_s` in {2, 4, 10}, `hop_s`. Returns score track inside range. A :8101, B :8102.
  - `rescore_region`: one detector with long context. Args `clip_id`, `detector`, `start`, `end`, `context_s` up to 30. Returns one `p_fake` for the range. A :8101, B :8102.
  - `find_boundaries`: `ruptures` change points over score track and channel features. Args `clip_id`, `start`, `end`, `signals[]`. Returns change points, each with the signal that moved. boundaries :8104.
  - `speaker_consistency`: SpeechBrain ECAPA. Args `clip_id`, `turn_a`, `turn_b`. Returns cosine similarity and `same_speaker`. context :8103.
  - `localize` (optional): CFPRF or MRM frame-level localizer. Args `clip_id`, `start`, `end`. Returns frame probabilities summarized into segments. localizer :8105.
  - `separate` (optional): Demucs. Args `clip_id`. Returns `clip_id` of derived speech stem. separation :8106.
  - `transcribe` (policy only): faster-whisper. Args `clip_id`, `start`, `end`. Returns text of one segment. M6 in-process.
  - Score direction: every detector returns `p_fake` in [0, 1]. AntiDeepfake sample code uses index 0 for fake and 1 for real, so `p_fake` is softmax index 0; confirm on a known fake and a known real clip.
  - Input format: detectors take 16 kHz mono; NISQA runs on the original-rate copy.
  - Short turns: turns under 1 s get flag `too_short`; agent must not label from them alone.
  - `find_boundaries` names the signal because a change in diarization or channel features alone is a speaker change, while a change in `p_fake` is an authenticity change.
  - Licenses: AntiDeepfake and NISQA weights CC BY-NC-SA 4.0 (non-commercial); pyannote weights gated on Hugging Face.

## M0 Shared contracts (contracts/)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: schema
- content:
  - Only coupling between modules; write first, commit fixtures for every one, change only via `CONTRACT_CHANGE.md`. Lead owns directory and finishes in first 30 minutes.
  - Models (pydantic v2) in `contracts/models.py`:
    ```python
    from typing import Literal
    from pydantic import BaseModel

    class ClipMeta(BaseModel):
        clip_id: str                      # sha256 of decoded mono PCM
        duration_s: float
        orig_sr: int
        paths: dict[str, str]             # {"orig": ".../orig.wav", "16k": ".../16k.wav"}
        parent_clip_id: str | None = None # set for derived clips, e.g. a speech stem

    class ToolCard(BaseModel):            # served by GET /tools; read by the orchestrator
        name: str
        version: str
        description: str
        args_schema: dict                 # JSON Schema
        values_schema: dict
        known_weaknesses: list[str]

    class ToolRecord(BaseModel):
        tool: str
        version: str
        clip_id: str
        params: dict
        status: Literal["ok", "failed", "invalid_input"]
        values: dict                      # shape given by the tool card
        validity: dict                    # {"min_duration_s": 1.0, "sample_rate": 16000}
        flags: list[str] = []             # "too_short", "low_bandwidth", "clipped"
        runtime_ms: int
        error: str | None = None

    class Turn(BaseModel):
        idx: int
        speaker: str
        start: float
        end: float

    class Evidence(BaseModel):
        tool: str
        field: str
        value: float | str | bool

    class Segment(BaseModel):
        start: float
        end: float
        speaker: str | None
        label: Literal["bona_fide", "synthetic", "uncertain"]
        tool_score: float | None          # p_fake from a ToolRecord in the trace; used for EER
        evidence: list[Evidence]

    class AnalysisResult(BaseModel):
        clip_id: str
        system: Literal["baseline", "fixed", "adaptive"]
        model: str | None
        segments: list[Segment]
        mixed: bool
        composition: Literal["none", "speaker_handoff", "splice", "overlay"]
        abstain: str | None = None        # reason, e.g. "budget_exceeded", "tool_failed:score_turns"
        summary: str                      # at most 3 sentences, cites tools by name
        trace_id: str
        usage: dict                       # tokens, tool_calls, seconds, usd

    class TraceEvent(BaseModel):          # streamed over SSE
        trace_id: str
        seq: int
        kind: Literal["tool_call", "tool_result", "llm", "final", "error"]
        payload: dict

    class Action(BaseModel):
        type: Literal["verify_contact", "hold_new_payee", "notify_trusted_contact"]
        case_id: str
        target: str | None                # contact id, never a raw phone number from the call
        reason: str

    class CaseEvent(BaseModel):
        case_id: str
        seq: int
        ts: str                           # ISO 8601 UTC
        type: str                         # clip_ingested, analysis_done, action, verification, transfer_*
        payload: dict
        prev_hash: str                    # 64 zeros for seq 0
        hash: str                         # sha256(prev_hash + canonical_json(case_id, seq, ts, type, payload))
    ```
  - Shared state values (M6, M7, M8, M9): Case = `OPEN`, `VERIFYING`, `VERIFIED`, `CONTRADICTED`, `UNREACHABLE`. Transfer = `PENDING`, `HELD`, `RELEASED`, `DECLINED`.
  - Fixtures in `contracts/fixtures/`: one `ToolRecord` per tool for golden clip G3, one `AnalysisResult` per golden clip, one `TraceEvent` stream for G3, one finished case for G3. Every module's mock reads these files.
  - Acceptance: none stated as a checklist in the source (absent). Checkpoint "foundations" (H+0:30) requires contracts, fixtures, CLAUDE.md and G1-G6 committed.

## M1 Intake and clip store (intake/)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: api-contract
- content:
  - Turns uploaded audio into a hashed, normalized clip read by `clip_id`. About 45 minutes; no dependencies beyond contracts.
  - Interface (imported by M8 and M2E):
    ```python
    ingest(src: Path | bytes, filename: str) -> ClipMeta
    get(clip_id: str) -> ClipMeta
    derive(parent_id: str, samples: np.ndarray, sr: int, kind: str) -> ClipMeta   # e.g. kind="speech_stem"
    ```
  - Storage: `data/clips/<clip_id>/orig.wav`, `16k.wav`, `meta.json`.
  - Tasks: (1) decode with ffmpeg to mono float32 at original rate; accept wav, mp3, m4a, ogg, opus, webm. (2) SHA-256 over decoded PCM16 bytes so same audio in two containers gets one `clip_id`. (3) If clip exists, return its `ClipMeta` without rewriting files. (4) Write `orig.wav` at original rate and `16k.wav` resampled with ffmpeg soxr. (5) Reject clips under 1 s or over 10 minutes with a clear error.
- acceptance:
  - [ ] Same file uploaded twice returns same `clip_id` and no new files.
  - [ ] One recording saved as wav and as mp3 at high bitrate decodes to same duration within 50 ms.
  - [ ] G1 to G6 all ingest, and `16k.wav` is 16 kHz mono.
  - [ ] A 0.5 s clip is rejected with a readable error.

## M2 Tool workers: common worker contract (workers/)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: api-contract
- content:
  - Each worker is a small FastAPI service in its own environment; turns audio into numbers; knows nothing about agents, cases or other workers except where noted. Split into five parts (M2A-M2E) for parallel subagents.
  - `GET /health` returns `{"ok": true, "version": "..."}`.
  - `GET /cards` returns the `ToolCard`s for operations the worker serves.
  - `POST /<op>` takes `{"clip_id", "path_16k", "path_orig", "params"}` and returns `{"values", "version", "flags", "runtime_ms"}`. Tools manager wraps this into a `ToolRecord`.
  - On any error, return HTTP 200 with `{"error": "..."}`. Never crash the process.

## M2A Detectors (workers/detectors, ports 8101 and 8102)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: api-contract
- content:
  - Two services with identical operations: AntiDeepfake on 8101, XLS-R + SLS on 8102. Each in a separate env.
  - Tasks: (1) load checkpoint named in config; AntiDeepfake default `nii-yamagishilab/wav2vec-large-anti-deepfake-nda` (XLS-R variants from same collection are a config swap); XLS-R + SLS uses SLSforADD code with XLS-R 300M base. (2) `/turns`: score each turn as one input, batched on GPU; turns over 30 s split into 30 s chunks and logits averaged. (3) `/windows`: score a range with `window_s` and `hop_s`; return `[{t_start, t_end, p_fake}]`. (4) `/region`: score exactly `[start, end]` as one input, up to 30 s. (5) Normalize to `p_fake` and also return raw logits; flag inputs under 1 s `too_short`.
- acceptance:
  - [ ] Index order confirmed on one known fake and one known real clip.
  - [ ] Mean `p_fake` on G2 is higher than on G1 for both detectors.
  - [ ] `/turns` on G3 returns two scores in under 5 s on GPU.

## M2B Context (workers/context, port 8103)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: api-contract
- content:
  - Everything that describes the audio rather than judging it.
  - `/context` returns in one call: Silero VAD speech segments and speech ratio; pyannote diarization turns (min 1, max 3 speakers, merging same-speaker gaps under 0.3 s); VoxLingua107 language and confidence on the longest turn; per-turn channel features (bandwidth = median 99% spectral rolloff; clipping fraction at |x| >= 0.99; SNR from VAD speech vs non-speech energy); NISQA MOS on the original-rate copy.
  - `/speaker_consistency`: ECAPA embeddings per turn, cached; returns cosine and `same_speaker` at a threshold tuned on G4.
- acceptance:
  - [ ] G4 returns two speakers and G1 returns one.
  - [ ] G3 turn boundaries land within 0.5 s of the manifest.
  - [ ] A clip low-passed at 3.4 kHz gets the `low_bandwidth` flag.

## M2C Boundaries (workers/boundaries, port 8104)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: api-contract
- content:
  - Finds where something changes and reports what changed.
  - `/boundaries` takes `start`, `end`, `signals` (any of `p_fake_A`, `p_fake_B`, `bandwidth`, `loudness`, `snr`).
  - Build each signal as a frame series at 0.5 s hop. `p_fake` series come from detector workers' `/windows` with 2 s windows; channel series computed locally.
  - Z-score each series and run `ruptures` Pelt with RBF cost. Tune penalty on G3 and G5 only.
  - For each change point return time, each signal's left-versus-right mean difference, and `moved` (the signal with the largest change).
- acceptance:
  - [ ] G5 returns a `p_fake` change point within 0.5 s of each insert edge.
  - [ ] G4 returns a change point whose `moved` is a channel signal, not `p_fake`.
  - [ ] G1 returns no change point with `moved` set to `p_fake`.

## M2D Localizer (workers/localizer, port 8105, optional)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: api-contract
- content:
  - Wrap CFPRF (github.com/ItzJuny/CFPRF) or MRM (github.com/hieuthi/MultiResoModel-Simple).
  - `/localize` returns frame probabilities and segments where probability is above 0.5.
  - Tool card must state it was trained on PartialSpoof and is weak out of domain.
- acceptance:
  - [ ] G5 returns a segment overlapping the insert.

## M2E Separation (workers/separation, port 8106, optional)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: api-contract
- content:
  - Run Demucs `htdemucs`, keep the vocals stem. Save through M1 `derive()` and return the new `clip_id`.
- acceptance:
  - [ ] G6 speech stem has a higher NISQA MOS than the mixed clip.

## M3 Tools manager (tools_manager/, port 8100)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: api-contract
- content:
  - Single door between orchestrator and every worker: validates, caches, times out, normalizes; no other module talks to a worker directly. FastAPI on 8100. About 90 minutes; depends on contracts and M1 only.
  - Endpoints: `GET /tools` returns `ToolCard[]` for the eight orchestrator tools (used by M4 prompt builder); `GET /tools/anthropic` returns tool definitions in Anthropic tool-use format generated from the cards (M4 adaptive loop); `POST /tools/{name}` with `{clip_id, params, trace_id}` returns one `ToolRecord` (M4, M5 baseline); `GET /budget/{trace_id}` returns tool calls and seconds used so far (M4 cap checks).
  - Tasks: (1) registry mapping tool name to worker URL, operation and version; `get_context` fans out to context worker in one call. (2) Validate `params` against card's `args_schema`; bad argument returns `status="invalid_input"` with validation message. (3) Resolve `clip_id` to file paths via M1 `get()`. (4) Disk cache keyed by SHA-256 of `clip_id`, tool, version and canonical JSON params; a version bump invalidates only that tool. (5) 60 s timeout per call, retry once on connection error; any worker failure becomes `status="failed"`. (6) Count calls and seconds per `trace_id`. (7) With `MOCK_TOOLS=1`, serve `ToolRecord`s from `contracts/fixtures/` keyed by clip and tool.
- acceptance:
  - [ ] A worker killed mid-run yields a `failed` record and the caller keeps going.
  - [ ] A repeat call returns from cache in under 10 ms.
  - [ ] Bumping one tool's version re-runs only that tool.
  - [ ] `GET /tools/anthropic` output is accepted unchanged by the Anthropic SDK.
  - [ ] With `MOCK_TOOLS=1`, all G3 tools return fixtures with no worker running.

## M4 Orchestrator agent (orchestrator/)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: protocol
- content:
  - One LLM agent reads tool records, picks further tools within caps, returns a validated `AnalysisResult`; no side-effect tools; never sees transcripts. Develops entirely against `MOCK_TOOLS=1` until checkpoint I2.
  - Interface:
    ```python
    async def run(clip_id: str, mode: Literal["fixed", "adaptive"], model: str,
                  caps: Caps) -> AsyncIterator[TraceEvent]   # last event: kind="final", payload=AnalysisResult
    ```
  - Files: `llm_client.py` (Anthropic, OpenAI-compatible, Mock adapters), `fixed.py`, `adaptive.py`, `prompt.md`, `validate.py`, `caps.py`.
  - Fixed mode (build first, default `claude-haiku-5-5`): (1) `get_context`. (2) `score_turns` with A and B in parallel. (3) `score_windows` with B, 4 s windows, 1 s hop, inside every turn. (4) `find_boundaries` over whole clip with all signals. (5) `speaker_consistency` for every pair of turns diarization gave the same label. (6) One LLM call with every record returning `AnalysisResult` JSON.
  - Adaptive mode (default `claude-sonnet-5-5`): (1) always run `get_context` and `score_turns` (A and B) first, before the model is called. (2) Native tool-use loop using `GET /tools/anthropic`, parallel tool calls allowed. (3) Default caps: 12 steps, 20 tool calls, 90 s and $0.25 per clip, tuned on dev split. Cap breach ends with `abstain="budget_exceeded"`, never a crash.
  - System prompt skeleton (`prompt.md`):
    ```text
    You are an evidence aggregator for speech authenticity. Tools do the listening; you decide which
    tools to run and reconcile their outputs. You never hear audio.

    Task: label each speaker turn bona_fide, synthetic or uncertain, then refine segment edges.
    Rules:
    - Label by speaker turn first. Use find_boundaries to place edges; trust a change point whose
      `moved` signal is p_fake, not one where only channel features moved.
    - A speaker change alone is never evidence of synthesis.
    - Every segment cites the tool and field it relies on. Never invent a number.
    - If detectors A and B disagree on a turn, call rescore_region on it. Still disagreeing -> uncertain.
    - Turns flagged too_short cannot be labeled synthetic on their own score.
    - If a tool on the critical path failed, abstain and name it.
    - Output only JSON matching the AnalysisResult schema.

    Tool cards: {tool_cards}
    ```
  - Validation (`validate.py`): parse with pydantic; on failure retry once with the error message, second failure returns `abstain="invalid_output"`; reject any `tool_score` not in a `ToolRecord` from this trace; reject segments that overlap or fall outside the clip; log tokens, latency and dollar cost on every run.
- acceptance:
  - [ ] Fixed mode returns valid JSON for G1 to G6 from fixtures.
  - [ ] G3 labels turn 0 `synthetic` and turn 1 `bona_fide` with `speaker_handoff`.
  - [ ] G4 returns no `synthetic` segment.
  - [ ] A cap of 2 tool calls returns `abstain="budget_exceeded"`.
  - [ ] A fixture where `score_turns` failed returns an abstain naming that tool.
  - [ ] Swapping `model` to an OpenAI-compatible endpoint runs with no code change.

## M5 Baseline and eval harness (baseline_eval/)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: protocol
- content:
  - Proves or disproves H2: builds the mixed test set, runs a no-LLM localizing baseline, produces one comparison table from one command. Uses M3 for tools and M4 for agent modes.
  - Baseline (no LLM, must localize too): (1) `get_context`, then `score_turns` with A and B, average the two `p_fake` per turn. (2) Label turn `synthetic` above threshold tau tuned on dev split. (3) Inside each turn run `find_boundaries`; where `moved` is `p_fake` with change >= 0.4, split the turn and label each side by window mean. (4) Emit `AnalysisResult` with `system="baseline"`.
  - Mixed test-set builder (`mixset.py`), must not hand the agent a shortcut (real scam calls have no hard cuts): (1) sources: consented teammate recordings, clones of the same teammates from an open voice-cloning TTS, optional public real speech (check each license). (2) About 100 clips: 40 clone-to-human handoffs, 20 real-to-real handoffs, 15 single real, 15 single cloned, 10 same-speaker cloned inserts. (3) Match loudness with `pyloudnorm`, crossfade every join over 50 ms. (4) After mixing, pass the whole clip through one codec: G.711 mu-law 8 kHz or Opus 16 kbps via ffmpeg. (5) Manifest JSONL with `clip`, `codec`, `scenario`, `segments[{start, end, speaker, label}]`. (6) Split 30% dev (tau, penalties, prompts), 70% held out for reporting.
  - Datasets: own mixed set (main result); LlamaPartialSpoof subset (out-of-domain); PartialSpoof subset (in-domain sanity check; overlaps AntiDeepfake post-training data); DFToolBench-A-500 (smoke test of tool use; ~2 s clips; overlaps detector training corpora).
  - Systems compared: A alone (clip level), B alone, baseline, fixed (`claude-haiku-5-5`), adaptive (`claude-sonnet-5-5`), adaptive with one non-Anthropic model.
  - Metrics: utterance EER (score = max segment `tool_score`), segment EER at 160 ms and 640 ms, per-turn accuracy, boundary F1 at 0.5 s tolerance, abstain rate, tool calls, seconds and dollars per clip.
  - Statistics: 95% bootstrap intervals from 1,000 resamples on every number.
- acceptance:
  - [ ] `make eval` regenerates `results/table.md` and `results/results.json` from cached tool outputs in one command.
  - [ ] A manifest check confirms every segment label matches the audio it points to.
  - [ ] A plain splice detector (change point on loudness alone) scores near chance on the crossfaded set; otherwise the set has a shortcut.

## M6 Policy and actions (policy_actions/)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: protocol
- content:
  - Plain code turns a verdict into outcomes: text to real person, held transfer, trusted-contact alert. No LLM decides anything here. Develops against the G3 `AnalysisResult` fixture with `MOCK_TWILIO=1`.
  - Files: `claim.py`, `rules.yaml`, `engine.py`, `verifier.py`, `breaker.py`, `contacts.yaml`.
  - Claimed identity (`claim.py`): (1) for each `synthetic` segment run faster-whisper on that segment only. (2) Fuzzy-match saved contact names and relationship words ("grandma", "it's me", "your grandson") from `contacts.yaml`. (3) No match: call `claude-haiku-5-5` fallback with transcript as quoted data and contact list as options; it may only return a contact id or `unknown`.
  - Rules (`rules.yaml`), top to bottom, first match wins:
    ```yaml
    - id: clone_claims_contact
      when: {any_segment: synthetic, claimed_contact: known}
      do: [verify_contact, hold_new_payee, notify_trusted_contact]
    - id: clone_unknown_identity
      when: {any_segment: synthetic, claimed_contact: unknown}
      do: [hold_new_payee, notify_trusted_contact]
    - id: analysis_abstained
      when: {abstain: true}
      do: [hold_new_payee]
    - id: all_bona_fide
      when: {all_segments: bona_fide}
      do: []
    ```
  - State machine (`breaker.py`):
    ```text
    Case:      OPEN -> VERIFYING(contact) -> VERIFIED      (reply YES)
                                          -> CONTRADICTED  (reply NO)
                                          -> UNREACHABLE   (no reply in 120 s)
    Transfer:  new payee while case is not VERIFIED -> HELD
               HELD -> RELEASED  (trusted contact approves, or case becomes VERIFIED)
               HELD -> DECLINED  (trusted contact declines)
    ```
  - Verifier (`verifier.py`): text the contact's saved number: "Hi Jake, someone is calling Grandma with your voice and asking for money. Reply YES if it's really you, NO if not." Inbound webhook checks `X-Twilio-Signature` header, then parses YES or NO. Never dial or text a number spoken on the call or sent as caller metadata. Twilio trial accounts only text verified numbers (verify every teammate's phone before build). With `MOCK_TWILIO=1`, replies come from `POST /dev/simulate-reply`.
- acceptance:
  - [ ] G3 produces `verify_contact` to Jake, `hold_new_payee` and `notify_trusted_contact`.
  - [ ] A NO reply moves the case to `CONTRADICTED`; no reply in 120 s gives `UNREACHABLE`.
  - [ ] A $9,500 transfer to a new payee is `HELD`; approve gives `RELEASED`, decline gives `DECLINED`.
  - [ ] G1 produces no actions and transfers go through.
  - [ ] Every state change appends a `CaseEvent` through M7.

## M7 Case store and case writer (cases/)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: api-contract
- content:
  - Regulated-track deliverable: append-only, tamper-evident record of what was claimed, what verification returned and what was blocked, plus draft SAR narrative a BSA officer can edit. Depends on contracts only.
  - Interface:
    ```python
    open_case(member_id: str, clip_id: str) -> str                 # returns case_id
    append(case_id: str, type: str, payload: dict) -> CaseEvent
    get_case(case_id: str) -> tuple[str, list[CaseEvent]]           # state, events
    verify_chain(case_id: str) -> tuple[bool, int | None]           # ok, first bad seq
    write_packet(case_id: str) -> dict                              # summary, timeline, evidence, sar_draft
    ```
  - Tasks: (1) SQLite tables `cases(id, member_id, clip_id, state, created_at)` and `events(case_id, seq, ts, type, payload_json, prev_hash, hash)`, insert-only. (2) Mirror each event to `data/cases/<case_id>.jsonl`. (3) `hash = sha256(prev_hash + canonical_json(case_id, seq, ts, type, payload))`; `prev_hash` for seq 0 is 64 zeros. (4) Case writer: one `claude-sonnet-5-5` call over structured events, transcript text passed as quoted data; returns incident summary, timeline, evidence table citing tool names, SAR narrative draft covering who, what, when, where, why, how. (5) Mark narrative "DRAFT for BSA officer review" and reference FinCEN alert FIN-2024-Alert004 on deepfake fraud. (6) Export packet as JSON and Markdown; PDF optional.
- acceptance:
  - [ ] Editing one stored event makes `verify_chain` fail at that seq.
  - [ ] The G3 demo case produces a packet in under 30 s.
  - [ ] Every number in the packet's evidence table appears in a case event.

## M8 API gateway (api/, port 8000)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: api-contract
- content:
  - One FastAPI app wiring intake, orchestrator, policy, cases and mock bank behind REST, SSE and Twilio webhooks. Built by the lead alongside contracts; every route works with all mocks on.
  - Routes: `POST /clips` (multipart) ingests audio, returns `ClipMeta` (M1). `POST /analyze` with `{clip_id, mode, model}` starts a job, mode `baseline|fixed|adaptive` (M4 or M5 baseline). `GET /analyze/{job_id}/stream` SSE of `TraceEvent`s (M4). `GET /analyze/{job_id}` final `AnalysisResult` (M4). `POST /cases/from-analysis` with `{job_id, member_id}` opens case and runs policy (M6, M7). `GET /cases/{case_id}` state, events, chain status (M7). `GET /cases/{case_id}/packet` incident packet and SAR draft (M7). `POST /bank/transfers` with `{member_id, payee, amount, new_payee}` creates a transfer, returns `PENDING` or `HELD` (M6 breaker). `POST /bank/transfers/{id}/approve` or `/decline` with `{token}` second key for held transfer (M6 breaker). `POST /twilio/sms` verification replies, signature checked (M6 verifier). `POST /twilio/recording` (stretch) ingests forwarded-call recording and starts job (M1, M4). `POST /dev/simulate-reply` (mock only) fakes YES/NO (M6). `GET /eval/results` serves `results/results.json` (M5).
  - Tasks: (1) jobs as in-process asyncio tasks; persist results in SQLite so restart does not lose the demo case. (2) CORS from port 5173 and expose app through a tunnel for Twilio webhooks. (3) Write `scripts/smoke.sh` running full G3 flow with curl: upload, analyze, case, transfer, simulated NO reply, packet.
- acceptance:
  - [ ] `smoke.sh` passes with `MOCK_TOOLS=1 MOCK_LLM=1 MOCK_TWILIO=1` and no GPU.
  - [ ] The SSE stream delivers events in `seq` order and ends with a `final` event.

## M9 Frontend (web/, port 5173)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- type: api-contract
- content:
  - Four screens making the demo legible in two minutes. Vite, React, TypeScript (strict), Tailwind, wavesurfer.js regions. Builds entirely against fixture JSON until checkpoint I1.
  - Routes: `/console` (judges, credit union analyst): clip picker, mode and model selector, live tool trace, speaker-turn timeline, segment table, actions panel, case packet. `/bank` (member "Grandma", phone-width): balance, send money, transfer status in plain words. `/approve/:token` (trusted contact, phone-width): amount, payee, why held, Approve and Decline. `/eval` (judges): comparison table from `GET /eval/results`.
  - Console components: (1) `ClipPicker`: upload a file or pick G1 to G6. (2) `ModeSelector`: baseline/fixed/adaptive plus model dropdown. (3) `TraceFeed`: one row per SSE event with tool name, arguments, short result, milliseconds; failed calls in warning colour. (4) `Timeline`: waveform with one region per segment and a speaker lane; `synthetic` critical colour, `uncertain` warning colour, `bona_fide` neutral. (5) `SegmentTable`: start, end, speaker, label, `tool_score`, evidence. (6) `ActionsPanel`: verification status per contact plus mock-only YES and NO buttons. (7) `CasePacket`: summary, SAR draft, "chain verified" badge.
  - Bank screen copy when held: "Paused for your safety. We could not confirm the caller was Jake. We've asked your trusted contact to approve this transfer."
- acceptance:
  - [ ] The G3 fixture renders turn 0 red and turn 1 neutral on the timeline.
  - [ ] The G3 SSE fixture animates in the trace feed in order.
  - [ ] The bank flow shows `HELD`, then `RELEASED` or `DECLINED` after the approve page is used.
  - [ ] Every screen works at 390 px wide.
