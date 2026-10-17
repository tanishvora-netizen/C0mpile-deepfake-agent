# Phase 1: Foundations (M0 + repo scaffold) - Context

**Gathered:** 2026-10-17
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Every later module can be built, tested and run against shared contracts, fixtures, an LLM adapter and golden clips with no GPU, no network and no neighbouring module.

Authoritative detail: `SPEC-deepfake-agent.md` sections "M0 Shared contracts", "Stack, repo layout and ports", "How we code fast without losing quality", "Tool inventory", "Agents and LLMs". Requirements FND-01 to FND-12 in `.planning/REQUIREMENTS.md`.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — discuss phase was skipped per user setting. Use ROADMAP phase goal, success criteria, the SPEC sections above, PROJECT.md decisions, and the root `CLAUDE.md` rules to guide decisions.

</decisions>

<code_context>
## Existing Code Insights

Greenfield repo: only `SPEC-deepfake-agent.md`, `CLAUDE.md` (subagent rules, must stay byte-identical) and `README.md`. The repo root is the spec's `callguard/` root. Local toolchain: uv 0.13.1 with Python 3.11.17, node 26, ffmpeg 9, GNU Make 3.81, macOS arm64, no GPU.

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond the SPEC — discuss phase skipped. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — discuss phase skipped.

</deferred>
