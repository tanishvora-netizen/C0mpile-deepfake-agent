"""API gateway (SPEC M8): one FastAPI app wiring intake, orchestrator, policy, cases and the mock bank.

Agent A's modules (intake, orchestrator) are imported lazily inside handlers so this app imports
even before they exist. Jobs run in daemon threads; trace events are buffered per job so the SSE
stream replays from seq 0 in order and ends after ``final``.
"""
import asyncio
import contextlib
import importlib
import json
import os
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

from cases import store, writer
from cases.logutil import jlog
from contracts.models import AnalysisResult, TraceEvent
from policy_actions import bank, engine, verifier

ROOT = Path(__file__).resolve().parents[1]
GOLDEN: dict[str, str] = {}  # name -> clip_id
JOBS: dict[str, "Job"] = {}


class Job:
    def __init__(self, clip_id: str, mode: str, model: str | None):
        self.id = "job_" + uuid.uuid4().hex[:12]
        self.clip_id, self.mode, self.model = clip_id, mode, model
        self.events: list[dict] = []
        self.result: dict | None = None
        self.error: str | None = None
        self.done = False
        self.lock = threading.Lock()

    def emit(self, ev: TraceEvent | dict) -> None:
        d = ev.model_dump() if isinstance(ev, TraceEvent) else dict(ev)
        with self.lock:
            self.events.append(d)


def _lazy(name: str):
    try:
        return importlib.import_module(name)
    except ImportError as exc:
        raise HTTPException(503, f"{name} is not available yet: {exc}") from exc


def _run_job(job: Job) -> None:
    trace_id = job.id
    try:
        run = importlib.import_module("orchestrator.run")
        result = run.analyze(job.clip_id, job.mode, model=job.model, on_event=job.emit)
        res = result.model_dump() if hasattr(result, "model_dump") else dict(result)
        trace_id = res.get("trace_id", trace_id)
        job.result = res
        if not any(e.get("kind") == "final" for e in job.events):
            seq = (job.events[-1]["seq"] + 1) if job.events else 0
            job.emit(TraceEvent(trace_id=trace_id, seq=seq, kind="final", payload=res))
    except Exception as exc:  # noqa: BLE001
        job.error = f"{type(exc).__name__}: {exc}"
        jlog("job_failed", trace_id=trace_id, error=job.error[:300])
        seq = (job.events[-1]["seq"] + 1) if job.events else 0
        job.emit(TraceEvent(trace_id=trace_id, seq=seq, kind="error", payload={"error": job.error}))
    finally:
        job.done = True


def _load_golden() -> None:
    gdir = ROOT / "data" / "golden"
    if not gdir.exists():
        return
    try:
        intake = importlib.import_module("intake.store")
    except ImportError:
        return
    for wav in sorted(gdir.glob("*.wav")):
        if wav.stem in GOLDEN:
            continue
        try:
            GOLDEN[wav.stem] = intake.ingest(wav.read_bytes(), wav.name).clip_id
        except Exception as exc:  # noqa: BLE001
            jlog("golden_ingest_failed", case_id=wav.stem, error=str(exc)[:200])


@asynccontextmanager
async def lifespan(_: FastAPI):
    await asyncio.to_thread(_load_golden)
    yield


app = FastAPI(title="CallGuard API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"],
                   allow_headers=["*"])


# ---- clips -----------------------------------------------------------------------------------

@app.post("/clips")
async def post_clip(file: UploadFile):
    intake = _lazy("intake.store")
    data = await file.read()
    try:
        meta = await asyncio.to_thread(intake.ingest, data, file.filename or "upload.wav")
    except ValueError as exc:  # IntakeError subclasses ValueError
        raise HTTPException(422, str(exc)) from exc
    return meta.model_dump()


GOLDEN_INFO = {
    "G1": ("Normal call", "Grandma's real grandson Jake calls to say hi."),
    "G2": ("Fully cloned call", "Every word is an AI clone of Jake asking for money."),
    "G3": ("Grandparent scam", "A cloned 'Jake' opens the call, then a real 'lawyer' asks for $9,500."),
    "G4": ("Two real people", "Jake hands the phone to his real friend. Nothing should be flagged."),
    "G5": ("Hidden clone insert", "A 3-second cloned sentence is spliced into a real call."),
    "G6": ("Scam call with music", "The grandparent scam with background music on the line."),
}


@app.get("/clips/golden")
def get_golden():
    if not GOLDEN:
        _load_golden()
    intake = _lazy("intake.store")
    out = []
    for n, c in sorted(GOLDEN.items()):
        title, desc = GOLDEN_INFO.get(n, (n, ""))
        try:
            duration = intake.get(c).duration_s
        except Exception:  # noqa: BLE001
            duration = None
        out.append({"name": n, "clip_id": c, "title": title, "description": desc, "duration_s": duration})
    return out


@app.get("/clips/{clip_id}/audio")
def get_clip_audio(clip_id: str):
    intake = _lazy("intake.store")
    try:
        path = Path(intake.get(clip_id).paths["orig"])
    except KeyError as exc:
        raise HTTPException(404, f"unknown clip {clip_id}") from exc
    return FileResponse(path, media_type="audio/wav")


@app.get("/clips/{clip_id}/transcript")
def get_clip_transcript(clip_id: str):
    name = next((n for n, c in GOLDEN.items() if c == clip_id), None)
    fx = ROOT / "contracts" / "fixtures" / "transcripts" / f"{name}.json" if name else None
    if fx is None or not fx.exists():
        return []
    return json.loads(fx.read_text())


# ---- analysis jobs ---------------------------------------------------------------------------

class AnalyzeReq(BaseModel):
    clip_id: str
    mode: Literal["baseline", "fixed", "adaptive"] = "adaptive"
    model: str | None = None


@app.post("/analyze")
def post_analyze(req: AnalyzeReq):
    try:
        intake = importlib.import_module("intake.store")
    except ImportError:
        intake = None
    if intake is not None:
        try:
            intake.get(req.clip_id)
        except KeyError as exc:
            raise HTTPException(404, f"unknown clip {req.clip_id}") from exc
    job = Job(req.clip_id, req.mode, req.model)
    JOBS[job.id] = job
    threading.Thread(target=_run_job, args=(job,), daemon=True).start()
    return {"job_id": job.id}


def _job(job_id: str) -> Job:
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, f"unknown job {job_id}")
    return job


@app.get("/analyze/{job_id}/stream")
async def stream(job_id: str):
    job = _job(job_id)

    async def gen():
        i = 0
        while True:
            while i < len(job.events):
                ev = job.events[i]
                i += 1
                yield f"data: {json.dumps(ev)}\n\n"
                if ev.get("kind") in ("final", "error"):
                    return
            if job.done and i >= len(job.events):
                return
            await asyncio.sleep(0.05)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/analyze/{job_id}")
def get_analysis(job_id: str):
    job = _job(job_id)
    if job.error:
        return JSONResponse({"status": "error", "error": job.error}, status_code=500)
    if job.result is None:
        return JSONResponse({"status": "running"}, status_code=202)
    return job.result


# ---- cases -----------------------------------------------------------------------------------

class FromAnalysisReq(BaseModel):
    job_id: str
    member_id: str


def _case_view(case_id: str) -> dict:
    try:
        row = store.get_case_row(case_id)
    except KeyError as exc:
        raise HTTPException(404, f"unknown case {case_id}") from exc
    return {"case_id": case_id, "member_id": row["member_id"], "clip_id": row["clip_id"],
            "state": row["state"], "created_at": row["created_at"],
            "events": [e.model_dump() for e in store.events(case_id)],
            "chain": store.verify_chain(case_id)}


@app.post("/cases/from-analysis")
def from_analysis(req: FromAnalysisReq):
    job = _job(req.job_id)
    if job.result is None:
        raise HTTPException(409, "analysis not finished")
    result = AnalysisResult.model_validate(job.result)
    case_id = store.open_case(result.clip_id, req.member_id)
    clip: dict = {"clip_id": result.clip_id}
    with contextlib.suppress(Exception):
        meta = importlib.import_module("intake.store").get(result.clip_id)
        clip = {"clip_id": meta.clip_id, "duration_s": meta.duration_s, "orig_sr": meta.orig_sr}
    store.append(case_id, "clip_ingested", clip)
    store.append(case_id, "analysis_done", {**result.model_dump(), "job_id": job.id})
    actions = engine.decide(result, case_id)
    executed = engine.execute(actions)
    return {**_case_view(case_id), "actions": executed}


@app.get("/cases/{case_id}")
def get_case(case_id: str):
    return _case_view(case_id)


@app.get("/cases/{case_id}/packet")
def get_packet(case_id: str):
    try:
        return writer.write_packet(case_id)
    except KeyError as exc:
        raise HTTPException(404, f"unknown case {case_id}") from exc


# ---- mock bank -------------------------------------------------------------------------------

class TransferReq(BaseModel):
    member_id: str
    payee: str
    amount: float
    new_payee: bool = True


class TokenReq(BaseModel):
    token: str


@app.post("/bank/transfers")
def post_transfer(req: TransferReq):
    return bank.create_transfer(req.member_id, req.payee, req.amount, req.new_payee)


def _bank_call(fn, transfer_id: str, token: str):
    try:
        return fn(transfer_id, token)
    except bank.BankError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@app.post("/bank/transfers/{transfer_id}/approve")
def approve_transfer(transfer_id: str, req: TokenReq):
    return _bank_call(bank.approve, transfer_id, req.token)


@app.post("/bank/transfers/{transfer_id}/decline")
def decline_transfer(transfer_id: str, req: TokenReq):
    return _bank_call(bank.decline, transfer_id, req.token)


@app.get("/transfers/{transfer_id}")
def get_transfer(transfer_id: str):
    t = bank.get_transfer(transfer_id)
    if t is None:
        raise HTTPException(404, "unknown transfer")
    return {k: t[k] for k in ("id", "state", "amount", "payee", "reason")}


@app.get("/approve/{token}")
def get_approve(token: str):
    t = bank.get_by_token(token)
    if t is None:
        raise HTTPException(404, "unknown or expired approval link")
    return t


# ---- Twilio and dev ---------------------------------------------------------------------------

@app.post("/twilio/sms")
async def twilio_sms(request: Request):
    form = dict((await request.form()).items())
    if os.environ.get("MOCK_TWILIO", "1") == "0":
        sig = request.headers.get("X-Twilio-Signature", "")
        if not verifier.validate_twilio_signature(str(request.url), form, sig):
            raise HTTPException(403, "bad Twilio signature")
    case_id = verifier.case_for_phone(str(form.get("From", "")))
    if case_id:
        verifier.handle_reply(case_id, str(form.get("Body", "")))
    return Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>", media_type="application/xml")


@app.post("/twilio/recording")
def twilio_recording():
    raise HTTPException(501, "stretch goal: forwarded-call recordings are not implemented")


class ReplyReq(BaseModel):
    case_id: str
    reply: str


@app.post("/dev/simulate-reply")
def simulate_reply(req: ReplyReq):
    if os.environ.get("MOCK_TWILIO", "1") == "0":
        raise HTTPException(404, "mock only")
    try:
        state = verifier.handle_reply(req.case_id, req.reply)
    except KeyError as exc:
        raise HTTPException(404, f"unknown case {req.case_id}") from exc
    return {"case_id": req.case_id, "state": state}


class TamperReq(BaseModel):
    case_id: str


@app.post("/dev/tamper")
def tamper(req: TamperReq):
    """Mock only: alter one stored case event so the console can show the chain check failing."""
    if os.environ.get("MOCK_TWILIO", "1") == "0":
        raise HTTPException(404, "mock only")
    try:
        seq = store.tamper_for_demo(req.case_id)
    except KeyError as exc:
        raise HTTPException(404, f"unknown case {req.case_id}") from exc
    return {"ok": True, "seq": seq}


# ---- eval ------------------------------------------------------------------------------------

@app.get("/eval/results")
def eval_results():
    p = ROOT / "results" / "results.json"
    if not p.exists():
        raise HTTPException(404, "results/results.json not found; run `make eval`")
    return json.loads(p.read_text())
