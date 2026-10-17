import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { createCall, getHealth, getSources, getTranscript, startAnalysis, streamAnalysis } from '../api'
import type { AnalysisResult, CallInfo, CallSource, Health, TraceEvent, TranscriptLine } from '../types'
import AddCall, { type CallItem } from '../home/AddCall'
import { Icon } from '../home/Icons'
import { Spinner } from '../home/bits'
import { buildProgress, errMsg } from '../home/lib'
import Results from '../home/Results'
import WhatNext from '../home/WhatNext'

type HealthState = { kind: 'loading' } | { kind: 'ok'; health: Health } | { kind: 'unknown' } | { kind: 'down' }

function StatusChip({ state }: { state: HealthState }) {
  let text: string | null = null
  let live = false
  if (state.kind === 'ok') {
    live = state.health.detection === 'live'
    const n = state.health.detectors.length || 2
    text = live ? `Live detection · ${n} independent detectors` : 'Example mode (scripted results)'
  } else if (state.kind === 'down') {
    text = "Can't reach the CallGuard server"
  }
  if (!text) return null
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-4 py-2 text-[17px] text-ink">
      <span className={`h-2.5 w-2.5 rounded-full ${live ? 'bg-accent shadow-[0_0_10px_#d1fe17]' : 'border-2 border-mute'}`} aria-hidden="true" />
      {text}
    </span>
  )
}

function Progress({ stage, events, finished, error, onRetry }: {
  stage: string
  events: TraceEvent[]
  finished: boolean
  error: string | null
  onRetry: () => void
}) {
  const lines = useMemo(() => buildProgress(events), [events])
  const all = [
    ...(events.length || finished ? [] : [{ id: 'stage', text: stage, tone: 'neutral' as const }]),
    ...lines,
  ]
  return (
    <section className="rounded-3xl border border-line bg-card p-5 shadow-[0_0_80px_rgba(209,254,23,0.04)] sm:p-8" aria-labelledby="run-title" aria-live="polite">
      <h2 id="run-title" className="text-[30px] font-extrabold leading-tight tracking-tight text-ink">
        {error ? "We couldn't check this call" : 'Checking your call'}
      </h2>
      {error ? (
        <>
          <p className="mt-3 rounded-2xl border border-line bg-card2 px-4 py-3 text-[18px] text-ink" role="alert">{error}</p>
          <button
            type="button" onClick={onRetry}
            className="mt-5 rounded-full bg-accent px-8 py-3.5 text-lg font-bold text-accent-ink hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Go back and try again
          </button>
        </>
      ) : (
        <ul className="mt-5 space-y-3">
          {all.map((l, i) => {
            const active = i === all.length - 1 && !finished
            return (
              <li key={l.id} className="rise flex items-start gap-3 text-[18px] leading-snug text-ink">
                <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center ${active ? 'text-accent' : l.tone === 'warn' ? 'text-part' : 'text-mute'}`}>
                  {active ? <Spinner className="h-5 w-5" /> : <Icon name={l.tone === 'warn' ? 'alert' : 'check'} className="h-5 w-5" />}
                </span>
                <span className={active ? 'font-bold' : l.tone === 'warn' ? 'text-part' : 'text-mute'}>{l.text}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default function Home() {
  const { search } = useLocation()
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' })
  const [items, setItems] = useState<CallItem[]>([])
  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [shown, setShown] = useState(0)
  const [call, setCall] = useState<CallInfo | null>(null)
  const [sources, setSources] = useState<CallSource[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const [lines, setLines] = useState<TranscriptLine[] | null>(null)

  const unsub = useRef<(() => void) | null>(null)
  const runId = useRef(0)
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    getHealth()
      .then((h) => setHealth({ kind: 'ok', health: h }))
      .catch((e) => setHealth(errMsg(e).startsWith('404') ? { kind: 'unknown' } : { kind: 'down' }))
  }, [])

  useEffect(() => () => {
    unsub.current?.()
    itemsRef.current.forEach((i) => i.file && i.url && URL.revokeObjectURL(i.url))
  }, [])

  // Reveal trace events at a readable pace (a quick run should not flash by).
  useEffect(() => {
    if (shown >= events.length) return
    const kind = events[shown].kind
    const t = setTimeout(() => setShown((s) => s + 1), kind === 'final' ? 500 : 350)
    return () => clearTimeout(t)
  }, [shown, events])

  const visible = useMemo(() => events.slice(0, shown), [events, shown])
  const finalEv = visible.find((e) => e.kind === 'final')
  const result = finalEv ? (finalEv.payload as unknown as AnalysisResult) : null

  const submit = async () => {
    if (running || !items.length) return
    const id = ++runId.current
    setRunning(true)
    setError(null)
    setEvents([])
    setShown(0)
    setLines(null)
    setCall(null)
    setJobId(null)
    setSources([])
    try {
      let info: CallInfo
      const example = items[0].clipId ? items[0] : null
      if (example?.clipId) {
        setStage('Opening the example call…')
        info = { clip_id: example.clipId, duration_s: example.duration ?? 0, sources: await getSources(example.clipId) }
      } else {
        setStage(items.length > 1 ? 'Joining your files into one call…' : 'Uploading your audio…')
        info = await createCall(items.map((i) => i.file as File))
      }
      if (id !== runId.current) return
      setCall(info)
      setSources(info.sources ?? [])
      getTranscript(info.clip_id).then((l) => id === runId.current && setLines(l)).catch(() => id === runId.current && setLines([]))
      setStage('Getting the detectors ready…')
      const job = await startAnalysis(info.clip_id, 'adaptive', null)
      if (id !== runId.current) return
      setJobId(job)
      unsub.current = streamAnalysis(
        job,
        (ev) => id === runId.current && setEvents((prev) => (prev.some((p) => p.seq === ev.seq) ? prev : [...prev, ev])),
        (err) => {
          if (err && id === runId.current) setError(`${err} Please try again.`)
        },
      )
    } catch (e) {
      if (id === runId.current) setError(errMsg(e))
    }
  }

  const backToCompose = () => {
    unsub.current?.()
    runId.current++
    setRunning(false)
    setError(null)
    setEvents([])
    setShown(0)
  }

  const reset = () => {
    backToCompose()
    items.forEach((i) => i.file && i.url && URL.revokeObjectURL(i.url))
    setItems([])
    setCall(null)
    setJobId(null)
    setLines(null)
    setSources([])
    window.scrollTo({ top: 0 })
  }

  const aiFound = !!result && result.segments.some((s) => s.label === 'synthetic')

  return (
    <div className="min-h-screen text-[17px] text-ink">
      <div className="mx-auto w-full max-w-[1100px] px-4 pb-10 sm:px-6">
        <header className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-x-6 gap-y-3 pb-6 pt-8 sm:pt-10">
          <div className="flex items-center gap-3.5">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-accent text-accent-ink">
              <Icon name="shieldCheck" className="h-6 w-6" />
            </span>
            <div>
              <h1 className="text-[28px] font-black leading-none tracking-tight">CallGuard</h1>
              <p className="mt-1.5 text-[17px] text-mute">Check a phone call for AI-cloned voices.</p>
            </div>
          </div>
          <StatusChip state={health} />
        </header>

        <main className="space-y-6">
          <div className="mx-auto w-full max-w-3xl space-y-6">
            {!running && !result && (
              <p className="pb-2 text-[44px] font-black leading-[1.02] tracking-tight sm:text-[60px]">
                Is that voice <span className="text-accent">real?</span>
              </p>
            )}
            {!running && (
              <AddCall items={items} setItems={setItems} onSubmit={() => void submit()} />
            )}
            {running && !result && (
              <Progress stage={stage} events={visible} finished={false} error={error} onRetry={backToCompose} />
            )}
            {result && call && (
              <Results
                clipId={call.clip_id} durationS={call.duration_s} result={result} sources={sources}
                lines={lines} transcribing={lines === null && health.kind === 'ok' && health.health.transcription}
                onReset={reset}
              />
            )}
          </div>
          {result && aiFound && jobId && <WhatNext key={jobId} jobId={jobId} />}
          {result && (
            <div className="mx-auto max-w-3xl">
              <button
                type="button" onClick={reset}
                className="rounded-full border border-line bg-card2 px-6 py-3 text-[17px] font-semibold text-ink hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
              >
                Check another call
              </button>
            </div>
          )}
        </main>

        <footer className="mx-auto mt-12 max-w-3xl border-t border-line pt-4 text-[17px] text-mute">
          <Link to={{ pathname: '/console', search }} className="underline decoration-line underline-offset-4 hover:text-accent">
            Analyst view
          </Link>
        </footer>
      </div>
    </div>
  )
}
