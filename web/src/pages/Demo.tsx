import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  createTransfer, decide, getCase, getPacket, getTransfer, getTranscript, listGolden, openCase,
  simulateReply, startAnalysis, streamAnalysis, tamperCase,
} from '../api'
import type { CaseView, GoldenClip, Packet, TraceEvent, Transfer, TranscriptLine } from '../types'
import { detectorAClipScore } from '../lib/trace'
import { Icon } from '../demo/Icons'
import { buildPlainRows, buildVerdict, usd } from '../demo/plain'
import StepCall from '../demo/StepCall'
import StepCheck from '../demo/StepCheck'
import StepMoney, { AMOUNT, FALLBACK_SMS, PAYEE } from '../demo/StepMoney'
import StepRecord from '../demo/StepRecord'

const STEPS = [
  { label: 'The call', title: 'The call' },
  { label: 'Check every voice', title: 'CallGuard checks every voice' },
  { label: 'Stop the money', title: 'Stop the money' },
  { label: 'Tamper-proof record', title: 'Tamper-proof record' },
]

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function Progress({ step, reached, onGo }: { step: number; reached: number; onGo: (i: number) => void }) {
  return (
    <ol className="flex items-center" aria-label="Progress">
      {STEPS.map((s, i) => {
        const done = i < step
        const cur = i === step
        return (
          <li key={s.label} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              disabled={i > reached}
              onClick={() => onGo(i)}
              className="flex items-center gap-3 disabled:cursor-default"
              aria-current={cur ? 'step' : undefined}
            >
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg font-bold transition-colors duration-300 ${
                  cur ? 'bg-accent text-white' : done ? 'bg-accent-soft text-accent' : 'bg-slate-200 text-slate-500'
                }`}
              >
                {done ? <Icon name="check" className="h-5 w-5" /> : i + 1}
              </span>
              <span className={`${cur ? 'inline' : 'hidden sm:inline'} text-lg font-semibold ${cur ? 'text-slate-900' : 'text-slate-500'}`}>
                {s.label}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <span className="mx-3 h-1 flex-1 overflow-hidden rounded-full bg-slate-200 sm:mx-4">
                <span className={`block h-full bg-accent transition-all duration-500 ${done ? 'w-full' : 'w-0'}`} />
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

interface Primary { label: string; onClick: () => void; disabled?: boolean }

function Run({ clip, onRestart, search }: { clip: GoldenClip; onRestart: () => void; search: string }) {
  const [step, setStep] = useState(0)
  const [reached, setReached] = useState(0)
  const [busy, setBusy] = useState(false)

  // step 1
  const [lines, setLines] = useState<TranscriptLine[] | null>(null)
  // step 2
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [anaErr, setAnaErr] = useState<string | null>(null)
  const [shown, setShown] = useState(0)
  const [jobId, setJobId] = useState<string | null>(null)
  // step 3
  const [caseView, setCaseView] = useState<CaseView | null>(null)
  const [caseErr, setCaseErr] = useState<string | null>(null)
  const [reply, setReply] = useState<'YES' | 'NO' | null>(null)
  const [transfer, setTransfer] = useState<Transfer | null>(null)
  // step 4
  const [record, setRecord] = useState<{ view: CaseView; packet: Packet | null } | null>(null)

  const unsub = useRef<(() => void) | null>(null)
  const started = useRef({ ana: false, kase: false })
  useEffect(() => () => unsub.current?.(), [])

  useEffect(() => {
    getTranscript(clip.clip_id).then(setLines).catch(() => setLines([]))
  }, [clip.clip_id])

  // ---- step 2: analysis, revealed at a readable pace ----
  const runAnalysis = async () => {
    if (started.current.ana) return
    started.current.ana = true
    try {
      const id = await startAnalysis(clip.clip_id, 'adaptive', null)
      setJobId(id)
      unsub.current = streamAnalysis(
        id,
        (ev) => setEvents((prev) => (prev.some((p) => p.seq === ev.seq) ? prev : [...prev, ev])),
        (err) => {
          if (err) setAnaErr(err)
        },
      )
    } catch (e) {
      setAnaErr(errMsg(e))
    }
  }

  useEffect(() => {
    if (shown >= events.length) return
    const kind = events[shown].kind
    const t = setTimeout(() => setShown((s) => s + 1), kind === 'tool_result' ? 800 : kind === 'final' ? 1100 : 120)
    return () => clearTimeout(t)
  }, [shown, events])

  const visible = useMemo(() => events.slice(0, shown), [events, shown])
  const { rows, llmSteps } = useMemo(() => buildPlainRows(visible), [visible])
  const finalEv = visible.find((e) => e.kind === 'final')
  const verdict = useMemo(
    () => (finalEv ? buildVerdict(finalEv.payload, lines) : null),
    [finalEv, lines],
  )
  const clipScore = useMemo(() => detectorAClipScore(events), [events])
  const working = !finalEv && !anaErr

  // ---- step 3: case, Jake's reply, transfer, Maria ----
  const openCaseNow = async () => {
    if (started.current.kase || !jobId) return
    started.current.kase = true
    try {
      setCaseView(await openCase(jobId, 'grandma'))
    } catch (e) {
      started.current.kase = false
      setCaseErr(errMsg(e))
    }
  }

  const smsEv = useMemo(
    () => caseView?.events.find((e) => e.type === 'verification' && typeof e.payload.body === 'string'),
    [caseView],
  )
  const smsBody = smsEv ? String(smsEv.payload.body) : FALLBACK_SMS
  const smsSent = !!smsEv

  const guarded = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setCaseErr(null)
    try {
      await fn()
    } catch (e) {
      setCaseErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const sendReply = (r: 'YES' | 'NO') => guarded(async () => {
    if (!caseView) return
    await simulateReply(caseView.case_id, r)
    setReply(r)
    setCaseView(await getCase(caseView.case_id))
  })

  const sendTransfer = () => guarded(async () => {
    setTransfer(await createTransfer(PAYEE, AMOUNT, true, 'grandma'))
  })

  const decideNow = (verb: 'approve' | 'decline') => guarded(async () => {
    if (!transfer?.token) throw new Error('Missing approval token for this transfer')
    await decide(transfer.id, transfer.token, verb)
    setTransfer((t) => (t ? { ...t, state: verb === 'approve' ? 'RELEASED' : 'DECLINED' } : t))
  })

  // Poll the transfer; keep the token from the create response (GET omits it).
  const tId = transfer?.id
  const tState = transfer?.state
  useEffect(() => {
    if (!tId || tState !== 'HELD') return
    const iv = setInterval(() => {
      getTransfer(tId)
        .then((t) => setTransfer((prev) => (prev && prev.id === t.id ? { ...prev, ...t, token: prev.token ?? t.token } : prev)))
        .catch(() => undefined)
    }, 1500)
    return () => clearInterval(iv)
  }, [tId, tState])

  // ---- step 4 ----
  const loadRecord = useCallback(async (caseId: string) => {
    const [view, packet] = await Promise.all([getCase(caseId), getPacket(caseId).catch(() => null)])
    setRecord({ view, packet })
  }, [])

  const tamper = () => guarded(async () => {
    if (!caseView) return
    await tamperCase(caseView.case_id)
    await loadRecord(caseView.case_id)
  })

  // ---- navigation ----
  const goTo = (n: number) => {
    setStep(n)
    setReached((r) => Math.max(r, n))
    window.scrollTo({ top: 0 })
  }
  const goNext = () => {
    const n = step + 1
    if (n > 3) return
    goTo(n)
    if (n === 1) void runAnalysis()
    if (n === 2) void openCaseNow()
    if (n === 3 && caseView) void loadRecord(caseView.case_id).catch((e) => setCaseErr(errMsg(e)))
  }

  const tamperedNow = record?.view.chain ? !record.view.chain.ok : false
  let primary: Primary
  if (step === 0) primary = { label: 'Next →', onClick: goNext }
  else if (step === 1) {
    primary = anaErr ? { label: 'Try again', onClick: onRestart }
      : !verdict ? { label: 'Checking…', onClick: () => undefined, disabled: true }
      : { label: 'Next →', onClick: goNext }
  } else if (step === 2) {
    if (caseErr && !caseView) primary = { label: 'Try again', onClick: onRestart }
    else if (!caseView) primary = { label: 'Opening case…', onClick: () => undefined, disabled: true }
    else if (smsSent && !reply) primary = { label: 'Jake replies NO', onClick: () => void sendReply('NO') }
    else if (!transfer) primary = { label: `Grandma sends ${usd(AMOUNT)}`, onClick: () => void sendTransfer() }
    else if (transfer.state === 'HELD') primary = { label: 'Maria declines', onClick: () => void decideNow('decline') }
    else primary = { label: 'Next →', onClick: goNext }
  } else {
    primary = !record ? { label: 'Loading…', onClick: () => undefined, disabled: true }
      : !tamperedNow ? { label: 'Try to tamper with the record', onClick: () => void tamper() }
      : { label: 'Start over', onClick: onRestart }
  }

  // → and Space drive the primary button.
  const primaryRef = useRef(primary)
  primaryRef.current = primary
  const busyRef = useRef(busy)
  busyRef.current = busy
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowRight' && e.key !== ' ') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      e.preventDefault()
      if (el && el.tagName === 'BUTTON') el.blur()
      const p = primaryRef.current
      if (!p.disabled && !busyRef.current) p.onClick()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const sub = [
    clip.name === 'G3'
      ? "Grandma answers. The voice sounds just like her grandson Jake."
      : clip.description ?? 'Listen to the call the way Grandma heard it.',
    'CallGuard listens to each speaker on their own, using two independent AI-voice detectors.',
    'The credit union texts the real Jake, and pauses the transfer until a trusted person decides.',
    'Every step is written to a record that cannot be quietly changed.',
  ]

  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-1 flex-col px-5 pb-4 sm:px-8">
      <Progress step={step} reached={reached} onGo={goTo} />

      <section className="mt-4 flex-1 rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_10px_40px_rgba(15,23,42,0.07)] sm:px-7 sm:py-6">
        <div className="mb-4">
          <h1 className="text-[34px] font-extrabold leading-tight tracking-tight text-slate-900 sm:text-[40px]">{STEPS[step].title}</h1>
          <p className="mt-1 text-[19px] text-slate-600">{sub[step]}</p>
        </div>

        <div className={step === 0 ? '' : 'hidden'}>
          <StepCall clip={clip} lines={lines} active={step === 0} />
        </div>
        {reached >= 1 && (
          <div className={step === 1 ? '' : 'hidden'}>
            <StepCheck
              rows={rows} llmSteps={llmSteps} working={working} error={anaErr}
              verdict={verdict} clipScore={clipScore} events={visible}
            />
          </div>
        )}
        {reached >= 2 && (
          <div className={step === 2 ? '' : 'hidden'}>
            <StepMoney
              ready={!!caseView} error={caseErr} smsBody={smsBody} smsSent={smsSent} reply={reply}
              caseState={caseView?.state ?? null} transfer={transfer} busy={busy}
              onReply={(r) => void sendReply(r)} onSend={() => void sendTransfer()}
              onDecide={(v) => void decideNow(v)}
            />
          </div>
        )}
        {reached >= 3 && (
          <div className={step === 3 ? '' : 'hidden'}>
            <StepRecord view={record?.view ?? null} packet={record?.packet ?? null} busy={busy} onTamper={() => void tamper()} />
          </div>
        )}
      </section>

      <footer className="sticky bottom-0 -mx-5 mt-3 flex items-center justify-between gap-4 bg-slate-50/90 px-5 py-2.5 backdrop-blur sm:-mx-8 sm:px-8">
        <div className="flex items-center gap-5 text-base text-slate-500">
          <button type="button" onClick={onRestart} className="underline decoration-slate-300 underline-offset-4 hover:text-slate-900">Restart</button>
          <Link to={{ pathname: '/console', search }} className="text-sm text-slate-400 hover:text-slate-700">Analyst view</Link>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-base text-slate-400 md:inline">Press → or Space</span>
          <button
            type="button"
            disabled={primary.disabled || busy}
            onClick={primary.onClick}
            className="rounded-2xl bg-accent px-9 py-4 text-2xl font-bold text-white shadow-[0_8px_24px_rgba(67,56,202,0.35)] transition hover:bg-indigo-800 active:scale-[0.98] disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none"
          >
            {primary.label}
          </button>
        </div>
      </footer>
    </div>
  )
}

export default function Demo() {
  const { search } = useLocation()
  const [clips, setClips] = useState<GoldenClip[] | null>(null)
  const [name, setName] = useState('G3')
  const [runKey, setRunKey] = useState(0)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    listGolden().then(setClips).catch((e) => setErr(errMsg(e)))
  }, [])

  const clip = clips?.find((c) => c.name === name) ?? clips?.[0] ?? null

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="mx-auto flex w-full max-w-[1320px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 pb-3 pt-4 sm:px-8">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent text-white shadow-md">
            <Icon name="shieldCheck" className="h-7 w-7" />
          </span>
          <div>
            <div className="text-[32px] font-extrabold leading-none tracking-tight">CallGuard</div>
            <p className="mt-1 text-lg text-slate-600">Catches cloned voices on a call — and stops the money before it leaves.</p>
          </div>
        </div>
        {clips && clips.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-slate-500">
            Scenario
            <select
              value={clip?.name ?? ''}
              onChange={(e) => { setName(e.target.value); setRunKey((k) => k + 1) }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-base text-slate-800"
            >
              {clips.map((c) => <option key={c.name} value={c.name}>{c.title ?? c.name}</option>)}
            </select>
          </label>
        )}
      </header>
      {clip ? (
        <Run key={`${clip.clip_id}-${runKey}`} clip={clip} search={search} onRestart={() => setRunKey((k) => k + 1)} />
      ) : (
        <p className="mx-auto mt-10 max-w-xl px-5 text-center text-xl text-slate-500">
          {err ? `Can't reach the CallGuard server. (${err})` : 'Loading scenarios…'}
        </p>
      )}
    </div>
  )
}
