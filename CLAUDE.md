# CLAUDE.md

Full build spec: `SPEC-deepfake-agent.md`. Find your module's section there (M0 to M9) before starting.

## Rules for every coding subagent

1. Read contracts/models.py, this module's README and its spec section before writing code.
2. Edit only files inside your module directory. Need a contract change? Write it in CONTRACT_CHANGE.md and stop.
3. Ship a mock: the module must run with MOCK_*=1 from contracts/fixtures, with no GPU and no network.
4. Never raise across a module boundary. Return ToolRecord(status="failed") or an error TraceEvent.
5. Tests live in <module>/tests and use data/golden. `make test-<module>` must pass before you hand back.
6. Typed Python, pydantic at every boundary, ruff clean. TypeScript strict in web/.
7. Log JSON lines to stdout, always with trace_id or case_id.
8. No secrets in code; read env vars.
9. Hand back: what you built, how to run it, what is still mocked, what failed.