## Conflict Detection Report

Scope: 1 document ingested (SPEC-deepfake-agent.md, type SPEC, confidence high, locked false). Mode: new. No existing context to compare against. No ADRs, no PRDs, no UNKNOWN classifications, no cross-ref cycles (cross_refs CLAUDE.md and CONTRACT_CHANGE.md are not part of the ingest set, so the ref graph has no edges to traverse).

### BLOCKERS (0)

None.

### WARNINGS (0)

None.

### INFO (6)

[INFO] Single-source corpus: no precedence resolution needed
  Note: only /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md was ingested. No LOCKED ADRs, no competing PRD acceptance variants, no SPEC-vs-ADR contradictions are possible. decisions.md and requirements.md are intentionally empty of entries; spec content is in constraints.md and context.md.

[INFO] Internal count mismatch: "four integration checkpoints" vs six milestones
  Note: SPEC section "How we code fast" says "four integration checkpoints", while the checkpoint list in /Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md has six entries (foundations, I1, I2, I3, I4, ship). Synthesis records all six as phase gates, with I1-I4 as the four named integration checkpoints.

[INFO] Timing and dependency text absent for several modules
  Note: the SPEC gives time estimates only for M0 (first 30 minutes), M1 (about 45 minutes) and M3 (about 90 minutes). For M2, M4, M5, M6, M7, M8 and M9 the estimate and dependency sentence is blank or truncated in the source (for example "Owns `orchestrator/`.  develops entirely against ..."). Marked absent in context.md, not inferred. Checkpoint times (H+0:30 to H+8:00) are the only schedule data for these modules.

[INFO] Repo layout root name differs from actual repo directory
  Note: SPEC layout is rooted at `callguard/`, while the working repository directory is `deepfake-agent`. Synthesis treats `callguard/` as the repository root (module directories contracts/, intake/, workers/, tools_manager/, orchestrator/, baseline_eval/, policy_actions/, cases/, api/, web/, data/golden/, scripts/). The repo also already has a CLAUDE.md per git history; its content was not reviewed by this synthesizer.

[INFO] Configuration gaps in env var list
  Note: SPEC lists nine env vars (`ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `TOOLS_URL`, `DATA_DIR`, `MOCK_TOOLS`, `MOCK_LLM`, `MOCK_TWILIO`) but specifies no variable for the OpenAI-compatible/vLLM/Ollama endpoint and model, the public webhook base URL, or the Hugging Face token for gated pyannote weights. These are not defined in the source and were not invented; plan owners may need to add them via CONTRACT_CHANGE.md or module README.

[INFO] Demo script step vs adaptive-mode behavior
  Note: demo step 0:15 expects the adaptive trace to show `rescore_region`, but the M4 prompt only calls `rescore_region` when detectors A and B disagree on a turn; demo step 0:40 shows "detector A's whole-clip score", but `score_turns` returns per-turn scores and the eval harness reports A alone at clip level. Neither is a contradiction of a locked source, but the G3 demo flow (never cut) depends on both behaviors being producible on G3 (possibly via fixtures or a clip-level view in M9/M5). Flagged for the roadmapper when planning M4, M5 and M9 acceptance.
