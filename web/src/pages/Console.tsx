import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getAnalysis, getCase, getPacket, openCase, simulateReply, startAnalysis, streamAnalysis } from '../api'
import type { AnalysisResult, CaseView, Mode, Packet, TraceEvent } from '../types'
import { detectorAClipScore } from '../lib/trace'
import { ClipPicker, type PickedClip } from '../components/ClipPicker'
import { DEFAULT_MODEL, ModeSelector } from '../components/ModeSelector'
import { TraceFeed } from '../components/TraceFeed'
import { Timeline } from '../components/Timeline'
import { SegmentTable } from '../components/SegmentTable'
import { ActionsPanel } from '../components/ActionsPanel'
import { CasePacket } from '../components/CasePacket'
import { Button, ErrorNote } from '../components/ui'

export default function Console() {
  const [clip, setClip] = useState<PickedClip | null>(null)
  const [mode, setMode] = useState<Mode>('adaptive')
  const [model, setModel] = useState(DEFAULT_MODEL.adaptive)
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [running, setRunning] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [caseView, setCaseView] = useState<CaseView | null>(null)
  const [packet, setPacket] = useState<Packet | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stop = useRef<(() => void) | null>(null)

  useEffect(() => () => stop.current?.(), [])

  const detectorA = useMemo(() => detectorAClipScore(events), [events])

  function changeMode(m: Mode) {
    setMode(m)
    setModel(DEFAULT_MODEL[m])
  }

  async function run() {
    if (!clip) return
    stop.current?.()
    setError(null)
    setEvents([])
    setResult(null)
    setCaseView(null)
    setPacket(null)
    setRunning(true)
    try {
      const id = await startAnalysis(clip.clip_id, mode, mode === 'baseline' ? null : model)
      setJobId(id)
      stop.current = streamAnalysis(
        id,
        (e) => {
          setEvents((prev) => [...prev, e])
          if (e.kind === 'final') {
            const p = e.payload as unknown as AnalysisResult
            if (Array.isArray(p.segments)) setResult(p)
            else getAnalysis(id).then(setResult).catch((err: Error) => setError(err.message))
          }
        },
        (err) => {
          setRunning(false)
          if (err) setError(err)
        },
      )
    } catch (e) {
      setRunning(false)
      setError(`Could not start the analysis: ${(e as Error).message}`)
    }
  }

  const refreshCase = useCallback(async (id: string) => {
    const [v, p] = await Promise.all([getCase(id), getPacket(id)])
    setCaseView((prev) => ({ ...v, actions: v.actions.length ? v.actions : (prev?.actions ?? []) }))
    setPacket(p)
  }, [])

  async function onOpenCase() {
    if (!jobId) return
    setBusy(true)
    setError(null)
    try {
      const v = await openCase(jobId, 'grandma')
      setCaseView(v)
      await refreshCase(v.case_id)
    } catch (e) {
      setError(`Could not open the case: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  async function onReply(reply: 'YES' | 'NO') {
    if (!caseView) return
    setBusy(true)
    setError(null)
    try {
      await simulateReply(caseView.case_id, reply)
      await refreshCase(caseView.case_id)
    } catch (e) {
      setError(`Reply failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <ClipPicker picked={clip} onPick={setClip} disabled={running} />
        <ModeSelector mode={mode} model={model} onMode={changeMode} onModel={setModel} disabled={running} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void run()} disabled={!clip || running} className="w-full sm:w-auto">
          {running ? 'Analyzing…' : 'Run analysis'}
        </Button>
        {!clip && <span className="text-sm text-slate-500">Pick a clip first.</span>}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <TraceFeed events={events} running={running} />
      <Timeline result={result} detectorA={detectorA} />
      <SegmentTable result={result} />
      <div className="grid gap-4 md:grid-cols-2">
        <ActionsPanel view={caseView} busy={busy} onReply={(r) => void onReply(r)} onOpen={() => void onOpenCase()} canOpen={result !== null && jobId !== null} />
        <CasePacket packet={packet} view={caseView} />
      </div>
    </div>
  )
}
