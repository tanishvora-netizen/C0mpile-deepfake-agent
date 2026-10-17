# CallGuard

CallGuard finds the AI-cloned speaker turns in a call or voicemail, texts the person the caller claims to be at their saved number, and holds new-payee transfers until a trusted contact approves them. The full design is in `SPEC-deepfake-agent.md`, and the module interfaces for this build are in `INTERFACES.md`.

## Run the demo (mocks only: no GPU, no network)

```bash
uv sync                 # Python 3.11 env
make golden             # placeholder golden clips G1–G6 + fixtures
make test               # all module tests
make smoke              # full G3 flow: upload → adaptive analysis → case → $9,500 HELD → NO reply → CONTRADICTED → packet
make api                # API on :8000   (terminal 1)
cd web && npm install && npm run dev   # console on :5173 (terminal 2)
make eval               # results/table.md: baseline vs fixed vs adaptive (mock provenance)
```

Open the console at http://localhost:5173/console and pick **G3**. Choose **adaptive** mode, click **Run**, then **Open case**, then the mock **NO** reply.

Other screens:
- `/bank` shows the member's view, including the $9,500 transfer held with its plain-words message.
- `/approve/:token` is the trusted contact's page.
- `/eval` shows the comparison table.

Add `?fixtures=1` to any URL to render without the API.

## Mock vs real

| Piece | This build |
| --- | --- |
| Detectors, context, boundaries | Served from `contracts/fixtures` (`MOCK_TOOLS=1`). GPU workers are not built. |
| Orchestrator LLM | A deterministic mock (`MOCK_LLM=1`). Setting `MOCK_LLM=0` and `ANTHROPIC_API_KEY` switches it to `claude-sonnet-5-5` (adaptive) and `claude-haiku-5-5` (fixed). This path has not been tested. |
| Twilio | Mock sends plus `/dev/simulate-reply` (`MOCK_TWILIO=1`). `/twilio/sms` checks the request signature when mocks are off. |
| Golden clips | Synthetic placeholder tones. Real consented clips go in `data/golden/`. |
| Eval table | Mock provenance only, so it is not evidence for the H2 claim. |
