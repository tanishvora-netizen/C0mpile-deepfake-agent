# Context (running notes by topic)

All entries sourced from /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md (type SPEC; entries here are non-constraint narrative the roadmapper needs).

## Product overview
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- name: CallGuard Build Spec: Agentic Mixed-Authenticity Detection + Scam Interrupt (dated Oct 17, 2026, author Tanish Rathin Vora)
- one-liner: finds which speaker turns in a call or voicemail are AI-generated, then stops the money from leaving. One orchestrator agent calls specialist audio tools to localize synthetic turns. Plain rules then text the claimed person on their saved number and hold new-payee transfers until a second person approves.
- event: c0mpiled-14, UC Berkeley, one-day build
- main track: Regulated industries (YC RFS: Proving You're Human): a credit union's scam interrupt and audit trail
- side track: Personal AI use (YC RFS: AI for the Aging Population): member and caregiver experience
- technical claim (H2): an agent that localizes mixed-authenticity audio by speaker turn beats a fixed, no-LLM localizing pipeline
- demo clip: 10 s consented clone of "Jake", then a real teammate as the "lawyer"
- not today: live in-call streaming (stretch), training detectors, native mobile apps

## Demo must-show outcomes
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
1. The agent flags only the cloned turn and passes the human turn, with its tool trace visible.
2. The real Jake gets a text on his saved number; his "NO" marks the case contradicted.
3. Grandma's $9,500 wire to a new payee is held until her trusted contact approves or declines.
4. The credit union gets a hash-chained case record and a draft SAR narrative.

## End-to-end workflow (module boundaries)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- Flow: Console M9 <-> API gateway M8; M8 -> Intake M1 (decode, resample, hash); M8 starts analysis job -> Orchestrator M4 <-> Tools manager M3 <-> Tool workers M2; M1 clip files -> M2; M4 -> AnalysisResult -> Policy and actions M6 (rules, Twilio verify, hold) -> Mock bank (new-payee transfers held) -> Case store M7 (hash chain, case writer); M6 -> case events -> M7.
- Only the orchestrator is an LLM agent. The tools manager is its single door to the workers; everything below the agent is deterministic code that writes to the case store.
- Every analysis mode emits the same `AnalysisResult`, so policy layer, console and eval harness never care which mode ran.
- Step list: (1) Audio in: primary = console upload of voicemail/recorded call; stretch = Twilio number records forwarded calls and posts recording to API. (2) Intake M1: ffmpeg decodes to mono, 16 kHz copy for detectors, original-rate copy for NISQA; SHA-256 of decoded samples = `clip_id`; repeat clip returns cached results. (3) Analysis job M8->M4 in mode `baseline` (no LLM), `fixed` (every tool runs, one LLM call) or `adaptive` (agent picks tools under caps). (4) Tool calls M4->M3->M2: validate args, check cache, call worker, return `ToolRecord`; failures return `status="failed"`, never exceptions. (5) Verdict M4: speaker-turn segments labeled bona_fide/synthetic/uncertain with tool evidence, plus `mixed`, `composition`, or abstain reason; trace streams over SSE. (6) Claimed identity M6: faster-whisper transcribes each synthetic segment only; matcher looks for saved contact name or relationship word; transcript never goes back to orchestrator. (7) Policy M6: rules map verdict to actions (verify claimed contact, hold new-payee transfers, notify trusted contact). (8) Verification M6: Twilio texts contact's saved number; reply webhook moves case to VERIFIED or CONTRADICTED, or UNREACHABLE after timeout. (9) Circuit breaker M6: new-payee transfer from member while case is not VERIFIED is HELD; release needs trusted contact's approval link. (10) Case record M7: every step appends a hash-chained event; case writer (Sonnet 5.5) produces incident summary and SAR narrative draft. (11) Console M9: speaker-turn timeline, tool trace, verification status, held transfer, case packet.

## Agents and LLMs
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- One agent only: the orchestrator. Other LLM calls: case writer and optional name-matching fallback.
- Orchestrator adaptive mode: single agent, native tool use, ReAct loop under caps; `claude-sonnet-5-5`.
- Orchestrator fixed mode: one aggregation call over all tool records; `claude-haiku-5-5`; cheap/reproducible; the first mode built.
- Orchestrator upper bound: same harness, eval only; `claude-opus-5-5`.
- Cross-provider check: same harness through an OpenAI-compatible client; an open-weights model served with vLLM or Ollama (v0.2 rule: test a non-Anthropic model before claiming which orchestrator is best).
- Case writer: one call over structured case events; `claude-sonnet-5-5`.
- Name-matcher fallback: one call, only when string matching fails; `claude-haiku-5-5`; optional.
- Tool workers, tools manager, baseline, policy, verifier, circuit breaker: deterministic code, no model.

## Team split
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- Person A (lead and integration): M0, M8, M3. Subagents in parallel: tools manager, API gateway.
- Person B (ML tools, on the GPU box): M2A, M2B, M2C; M2D and M2E if time. Subagents: detectors, context, boundaries.
- Person C (agent and eval): M4, M5. Subagents: orchestrator, baseline plus test-set builder.
- Person D (product): M9, M6, M7. Subagents: frontend, policy and actions, case store.
- With three people merge A and D's integration work; with two, one person takes M2 and M5 and the other takes everything else.
- Four people each drive two or three coding subagents; team merges at fixed checkpoints; anything not working at a checkpoint is cut, not debugged past it.

## Integration checkpoints (phase gates)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
1. H+0:30, foundations: contracts, fixtures, `CLAUDE.md` and golden clips G1 to G6 are committed. Every subagent is launched with its section.
2. H+2:00, I1 mock end to end: `smoke.sh` passes and the console renders G3 from mocks, with no GPU.
3. H+4:00, I2 real tools: workers live behind M3. Fixed mode and the baseline run on G1 to G6; fixtures regenerated from real outputs.
4. H+5:30, I3 full product: adaptive mode, real Twilio texts, the held transfer and the case packet all work on G3.
5. H+6:30, I4 numbers and freeze: eval table runs on the held-out set and the LlamaPartialSpoof subset. Feature freeze.
6. H+7:00 to H+8:00, ship: record demo video, finish README, submit.

## Module dependency / timing notes stated in the SPEC
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- M0: lead owns; finish in first 30 minutes.
- M1: about 45 minutes; no dependencies beyond contracts.
- M2: five parts (M2A-M2E) so up to five subagents build in parallel; no time estimate stated.
- M3: about 90 minutes; depends on contracts and M1 only.
- M4: develops entirely against `MOCK_TOOLS=1` until checkpoint I2; no time estimate stated (absent in source).
- M5: uses M3 for tools and M4 for agent modes; no time estimate stated (absent in source).
- M6: develops against the G3 `AnalysisResult` fixture with `MOCK_TWILIO=1`; time/dependency text partially absent in source.
- M7: depends on contracts only; time estimate absent in source.
- M8: built by the lead alongside contracts; every route works with all mocks on.
- M9: builds entirely against fixture JSON until checkpoint I1.

## Cut order if behind
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- Cut in this order: (1) M2E separation, (2) M2D localizer, (3) live Twilio (use simulated replies), (4) the open-weights comparator, (5) the PartialSpoof subset.
- Never cut: the G3 demo flow, or the adaptive-versus-baseline comparison on your own set.

## Demo script (2 minutes)
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- 0:00 One line on the problem: a cloned grandchild opens the call, then a live "lawyer" takes over.
- 0:15 Upload G3 in the console and run adaptive mode. Trace streams `get_context`, `score_turns`, `find_boundaries`, `rescore_region`.
- 0:40 Timeline shows turn 0 synthetic and turn 1 bona fide, with `speaker_handoff`. Show detector A's whole-clip score beside it to make the point about averaging.
- 1:00 Jake's real phone gets the text; he replies NO and the case turns `CONTRADICTED`.
- 1:15 On the bank screen, a $9,500 wire to a new payee shows `HELD`. The trusted contact opens the approve link and declines.
- 1:35 The case packet: chain verified, evidence citing tools, SAR draft.
- 1:50 The eval table: adaptive versus the no-LLM baseline, with intervals. Close by stating that every cloned voice was recorded with consent.

## Datasets for eval
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- Own mixed set: main result; matches the product. Caveat: synthetic mixes are simpler than real calls.
- LlamaPartialSpoof subset: out-of-domain partial and full fakes plus bona fide. Caveat: download size; subsample.
- PartialSpoof subset: in-domain sanity check. Caveat: built on ASVspoof 2019 LA, which overlaps AntiDeepfake's post-training data.
- DFToolBench-A-500: smoke test of tool use. Caveat: clips about 2 s; overlaps detector training corpora.

## Pre-event / operational prerequisites
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
- pyannote weights are gated on Hugging Face: accept terms before the event.
- AntiDeepfake and NISQA weights are CC BY-NC-SA 4.0 (non-commercial).
- Twilio trial accounts only text verified numbers: verify every teammate's phone before the build starts.
- Keep written consent for every cloned voice.
- Record golden clips G1-G6 in the first 30 minutes; pass each through G.711 at 8 kHz after mixing.
- All backend services run on one rented GPU box sharing `DATA_DIR`; laptops run the web app and the mocks.
- Public tunnel (ngrok or cloudflared) needed for Twilio webhooks.
- If a model will not load within 20 minutes, drop it and continue with the rest (v0.2 guardrail).

## Subagent prompt template
- source: /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md
```text
You are implementing <MODULE> for CallGuard.
Read first: CLAUDE.md, contracts/models.py, <module>/README.md, and the spec section below.
Build exactly the tasks in the section. Develop against MOCK_*=1 and contracts/fixtures.
Done when every acceptance check in the section passes via `make test-<module>`.
Do not touch anything outside <module>/.
Hand back: a 5-line summary, the run command, what is mocked, known gaps.

<SECTION>
```
