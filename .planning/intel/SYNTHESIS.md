# Synthesis Summary

Entry point for gsd-roadmapper. Mode: new. Precedence: ADR > SPEC > PRD > DOC.

## Doc counts by type
- SPEC: 1 (/Users/tanishvora/Coding/deepfake-agent/SPEC-deepfake-agent.md, confidence high, locked false)
- ADR: 0, PRD: 0, DOC: 0, UNKNOWN: 0

## Decisions locked
- 0. No ADRs in the ingest set. See decisions.md.

## Requirements extracted
- 0 REQ-* entries (no PRDs; none fabricated). Derive requirements from (a) the four demo must-show outcomes in context.md and (b) the per-module acceptance checklists in constraints.md. See requirements.md.

## Constraints
- 21 entries in constraints.md. Breakdown by type:
  - api-contract: 12 (tool inventory, worker contract, M1, M2A, M2B, M2C, M2D, M2E, M3, M7, M8, M9)
  - schema: 1 (M0 shared contracts, models, state values, fixtures)
  - protocol: 5 (stack/ports/env vars, subagent rules, M4, M5, M6)
  - nfr: 3 (definition of done and speed rules, LLM call rules, golden clips G1-G6)

## Module map (one plan per module suggested)
- M0 contracts (lead; first 30 min) -> constraints.md "M0 Shared contracts"
- M1 intake (intake/) -> "M1 Intake and clip store"
- M2A detectors :8101/:8102, M2B context :8103, M2C boundaries :8104, M2D localizer :8105 (optional), M2E separation :8106 (optional)
- M3 tools manager :8100; M4 orchestrator; M5 baseline + eval; M6 policy/actions; M7 case store + writer; M8 API gateway :8000; M9 frontend :5173
- Cross-cutting: stack/ports/env vars, "Rules for every coding subagent", LLM call rules, golden clips, definition of done.

## Phase gates and ordering (context.md)
- Foundations (H+0:30) -> I1 mock end to end (H+2:00) -> I2 real tools (H+4:00) -> I3 full product (H+5:30) -> I4 numbers and freeze (H+6:30) -> ship (H+7:00-8:00).
- Cut order: M2E, M2D, live Twilio, open-weights comparator, PartialSpoof subset. Never cut: G3 demo flow; adaptive-vs-baseline comparison on own set.
- Demo script (2 min) and team split are in context.md.

## Context topics
- 12 topics in context.md (overview, demo outcomes, workflow, agents/LLMs, team split, checkpoints, module timing, cut order, demo script, datasets, prerequisites, subagent prompt template).

## Conflicts
- 0 blockers, 0 competing variants, 0 auto-resolved. 6 informational notes (checkpoint count wording, absent module timings, repo root name, env var gaps, demo-script vs adaptive-behavior). Detail: /Users/tanishvora/Coding/deepfake-agent/.planning/INGEST-CONFLICTS.md

## Files
- /Users/tanishvora/Coding/deepfake-agent/.planning/intel/decisions.md
- /Users/tanishvora/Coding/deepfake-agent/.planning/intel/requirements.md
- /Users/tanishvora/Coding/deepfake-agent/.planning/intel/constraints.md
- /Users/tanishvora/Coding/deepfake-agent/.planning/intel/context.md
