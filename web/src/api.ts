import type {
  AnalysisResult, CaseEvent, CaseState, CaseView, ChainStatus, ClipMeta, GoldenClip, Mode,
  Packet, TraceEvent, Transfer, Action, TranscriptLine,
} from './types'
import g3Trace from './fixtures/g3_trace.json'
import g3Case from './fixtures/g3_case.json'
import evalFixture from './fixtures/eval.json'
import { asObj } from './lib/trace'

export const API_BASE: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export const isFixtures = (): boolean =>
  new URLSearchParams(window.location.search).get('fixtures') === '1'

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API_BASE + path, init)
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(`${r.status} ${r.statusText}${body ? ': ' + body.slice(0, 200) : ''}`)
  }
  return (await r.json()) as T
}

function post<T>(path: string, body: unknown): Promise<T> {
  return http<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms))

// ---- fixture state (in memory, console demo without the API) ----
const fxTrace = g3Trace as unknown as TraceEvent[]
const fxCase = g3Case as unknown as { case: CaseView; packet: Packet }
const fx = {
  caseState: 'OPEN' as CaseState,
  transfers: new Map<string, Transfer>(),
  n: 0,
  tampered: false,
}

// ---- clips ----
export async function listGolden(): Promise<GoldenClip[]> {
  if (isFixtures()) {
    const titles: [string, string][] = [
      ['G1', 'Normal call'],
      ['G2', 'Fully cloned call'],
      ['G3', 'Grandparent scam'],
      ['G4', 'Two real people'],
      ['G5', 'Hidden clone insert'],
      ['G6', 'Scam call with music'],
    ]
    return titles.map(([name, title]) => ({ name, title, clip_id: name.toLowerCase() }))
  }
  return http<GoldenClip[]>('/clips/golden')
}

/** URL of the playable audio for a clip (null in fixtures mode, which has no audio). */
export function clipAudioUrl(clipId: string): string | null {
  return isFixtures() ? null : `${API_BASE}/clips/${clipId}/audio`
}

const FX_TRANSCRIPT: TranscriptLine[] = [
  { start: 0, end: 3, speaker: 'S1', who: "Caller says they're Jake", text: "Grandma, it's Jake, I'm in trouble." },
  { start: 3, end: 7, speaker: 'S2', who: "Second voice: 'Lawyer'", text: "I'm his attorney. I need a $9,500 wire to post bail, right away." },
]

export async function getTranscript(clipId: string): Promise<TranscriptLine[]> {
  if (isFixtures()) return FX_TRANSCRIPT
  return http<TranscriptLine[]>(`/clips/${clipId}/transcript`)
}

export async function uploadClip(file: File): Promise<ClipMeta> {
  if (isFixtures()) {
    await sleep(300)
    return { clip_id: 'g3', duration_s: 7, orig_sr: 16000, paths: {} }
  }
  const fd = new FormData()
  fd.append('file', file, file.name)
  return http<ClipMeta>('/clips', { method: 'POST', body: fd })
}

// ---- analysis ----
export async function startAnalysis(clipId: string, mode: Mode, model: string | null): Promise<string> {
  if (isFixtures()) return `fx-job-${mode}`
  const r = await post<{ job_id: string }>('/analyze', { clip_id: clipId, mode, model })
  return r.job_id
}

export async function getAnalysis(jobId: string): Promise<AnalysisResult> {
  if (isFixtures()) {
    const fin = fxTrace[fxTrace.length - 1]
    return fin.payload as unknown as AnalysisResult
  }
  return http<AnalysisResult>(`/analyze/${jobId}`)
}

/** Subscribes to the trace. Returns an unsubscribe function. Stops on `final` (or `error`). */
export function streamAnalysis(
  jobId: string,
  onEvent: (e: TraceEvent) => void,
  onEnd: (err?: string) => void,
): () => void {
  if (isFixtures()) {
    let cancelled = false
    void (async () => {
      const mode = jobId.replace('fx-job-', '') as Mode
      for (const e of fxTrace) {
        await sleep(e.kind === 'tool_result' ? 900 : 450)
        if (cancelled) return
        const ev = e.kind === 'final' ? { ...e, payload: { ...e.payload, system: mode } } : e
        onEvent(ev)
      }
      if (!cancelled) onEnd()
    })()
    return () => {
      cancelled = true
    }
  }
  const es = new EventSource(`${API_BASE}/analyze/${jobId}/stream`)
  let done = false
  es.onmessage = (m: MessageEvent<string>) => {
    try {
      const ev = JSON.parse(m.data) as TraceEvent
      onEvent(ev)
      if (ev.kind === 'final' || ev.kind === 'error') {
        done = true
        es.close()
        onEnd(ev.kind === 'error' ? 'The analysis reported an error.' : undefined)
      }
    } catch {
      /* ignore malformed keep-alive lines */
    }
  }
  es.onerror = () => {
    if (done) return
    done = true
    es.close()
    onEnd('Lost connection to the trace stream.')
  }
  return () => {
    done = true
    es.close()
  }
}

// ---- cases ----
function toCaseView(raw: unknown, fallbackId: string): CaseView {
  const r = asObj(raw)
  const events = (Array.isArray(r.events) ? r.events : []) as CaseEvent[]
  const actions: Action[] = (Array.isArray(r.actions) ? r.actions : []) as Action[]
  if (!actions.length) {
    for (const ev of events) {
      if (ev.type === 'action') {
        const p = asObj(ev.payload)
        if (typeof p.type === 'string') {
          actions.push({
            type: p.type as Action['type'], case_id: ev.case_id,
            target: typeof p.target === 'string' ? p.target : null,
            reason: typeof p.reason === 'string' ? p.reason : '',
          })
        }
      }
    }
  }
  const chainRaw = r.chain ?? r.chain_status
  const chain = chainRaw ? (chainRaw as ChainStatus) : null
  return {
    case_id: String(r.case_id ?? r.id ?? fallbackId),
    state: (r.state as CaseState) ?? 'OPEN',
    events, actions, chain,
  }
}

export async function openCase(jobId: string, memberId = 'grandma'): Promise<CaseView> {
  if (isFixtures()) {
    await sleep(400)
    fx.caseState = 'VERIFYING'
    return { ...fxCase.case, state: fx.caseState }
  }
  const r = await post<unknown>('/cases/from-analysis', { job_id: jobId, member_id: memberId })
  const first = toCaseView(r, '')
  if (!first.case_id) throw new Error('API did not return a case_id')
  try {
    const full = await getCase(first.case_id)
    return { ...full, actions: full.actions.length ? full.actions : first.actions }
  } catch {
    return first
  }
}

export async function getCase(caseId: string): Promise<CaseView> {
  if (isFixtures()) {
    return {
      ...fxCase.case, state: fx.caseState,
      chain: fx.tampered ? { ok: false, bad_seq: 3 } : fxCase.case.chain,
    }
  }
  return toCaseView(await http<unknown>(`/cases/${caseId}`), caseId)
}

export async function getPacket(caseId: string): Promise<Packet> {
  if (isFixtures()) return fx.tampered ? { ...fxCase.packet, chain: { ok: false, bad_seq: 3 } } : fxCase.packet
  const r = asObj(await http<unknown>(`/cases/${caseId}/packet`))
  const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v, null, 2))
  return {
    summary: str(r.summary),
    sar_draft: str(r.sar_draft),
    chain: r.chain ? (r.chain as ChainStatus) : null,
  }
}

/** Demo only: alters a stored audit entry so the hash chain breaks. */
export async function tamperCase(caseId: string): Promise<void> {
  if (isFixtures()) {
    await sleep(300)
    fx.tampered = true
    return
  }
  await post<unknown>('/dev/tamper', { case_id: caseId })
}

export async function simulateReply(caseId: string, reply: 'YES' | 'NO'): Promise<void> {
  if (isFixtures()) {
    await sleep(250)
    fx.caseState = reply === 'NO' ? 'CONTRADICTED' : 'VERIFIED'
    return
  }
  await post<unknown>('/dev/simulate-reply', { case_id: caseId, reply })
}

// ---- bank ----
export async function createTransfer(
  payee: string, amount: number, newPayee: boolean, memberId = 'grandma',
): Promise<Transfer> {
  if (isFixtures()) {
    await sleep(400)
    const id = `fx-t-${++fx.n}`
    const held = newPayee && fx.caseState !== 'VERIFIED'
    const t: Transfer = {
      id, state: held ? 'HELD' : 'RELEASED', amount, payee, token: `fx-token-${id}`,
      reason: held ? 'New payee while the caller could not be verified as Jake.' : null,
    }
    fx.transfers.set(id, t)
    return t
  }
  const r = await post<Record<string, unknown>>('/bank/transfers', {
    member_id: memberId, payee, amount, new_payee: newPayee,
  })
  return {
    id: String(r.id), state: r.state as Transfer['state'], amount: Number(r.amount ?? amount),
    payee: String(r.payee ?? payee), reason: (r.reason as string | null) ?? null,
    token: typeof r.token === 'string' ? r.token : undefined,
  }
}

export async function getTransfer(id: string): Promise<Transfer> {
  if (isFixtures()) {
    const t = fx.transfers.get(id)
    if (!t) throw new Error('Transfer not found')
    return t
  }
  return http<Transfer>(`/transfers/${id}`)
}

export async function getApproval(token: string): Promise<Transfer> {
  if (isFixtures()) {
    const t = [...fx.transfers.values()].find((x) => x.token === token)
    if (!t) throw new Error('This approval link is not valid.')
    return t
  }
  return http<Transfer>(`/approve/${token}`)
}

export async function decide(id: string, token: string, verb: 'approve' | 'decline'): Promise<void> {
  if (isFixtures()) {
    await sleep(300)
    const t = fx.transfers.get(id)
    if (t) t.state = verb === 'approve' ? 'RELEASED' : 'DECLINED'
    return
  }
  await post<unknown>(`/bank/transfers/${id}/${verb}`, { token })
}

// ---- eval ----
export async function getEval(): Promise<unknown> {
  if (isFixtures()) return evalFixture
  return http<unknown>('/eval/results')
}
