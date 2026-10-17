import { useEffect, useRef, useState } from 'react'
import { clipAudioUrl } from '../api'
import type { AnalysisResult, CallSource, Label, TranscriptLine } from '../types'
import { Icon } from './Icons'
import { Spinner } from './bits'
import {
  closerLook, detectorScores, detectorsDisagree, linesFor, mmss, overallVerdict, pct, sourceFor, VERDICT,
  voiceNames, type Tone,
} from './lib'

const BAR: Record<Label, string> = {
  synthetic: 'bg-red-500 text-white',
  bona_fide: 'bg-green-600 text-white',
  uncertain: 'bg-amber-400 text-amber-950',
}
const HEAD: Record<Tone, string> = {
  danger: 'text-red-700',
  ok: 'text-green-700',
  warn: 'text-amber-700',
  neutral: 'text-slate-900',
}
const CARD: Record<Label, string> = {
  synthetic: 'border-red-200 bg-red-50/60',
  bona_fide: 'border-green-200 bg-green-50/60',
  uncertain: 'border-amber-200 bg-amber-50/60',
}

function Player({ clipId, result, durationS }: { clipId: string; result: AnalysisResult; durationS: number }) {
  const url = clipAudioUrl(clipId)
  const audio = useRef<HTMLAudioElement>(null)
  const [t, setT] = useState(0)
  const [len, setLen] = useState(0)
  const [playing, setPlaying] = useState(false)
  const names = voiceNames(result.segments)
  const lastEnd = result.segments.reduce((m, s) => Math.max(m, s.end), 0)
  const total = Math.max(len, durationS, lastEnd, 0.1)

  // Smooth playhead while playing.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      if (audio.current) setT(audio.current.currentTime)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const seek = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const at = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * total
    setT(at)
    if (audio.current) audio.current.currentTime = at
  }

  return (
    <div>
      {url && (
        <audio
          ref={audio} src={url} controls preload="metadata" className="w-full"
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setLen(e.currentTarget.duration)}
          onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        />
      )}
      <div
        className="relative mt-3 h-14 cursor-pointer overflow-hidden rounded-xl bg-slate-200"
        onClick={(e) => url && seek(e.clientX, e.currentTarget)}
        role="img"
        aria-label={result.segments.map((s, i) => `${names[i]}, ${mmss(s.start)} to ${mmss(s.end)}: ${VERDICT[s.label].headline}`).join('. ')}
      >
        {result.segments.map((s, i) => (
          <div
            key={i}
            className={`absolute inset-y-0 flex items-center justify-center overflow-hidden border-r-2 border-white px-2 text-[17px] font-semibold last:border-r-0 ${BAR[s.label]}`}
            style={{ left: `${(s.start / total) * 100}%`, width: `${((s.end - s.start) / total) * 100}%` }}
          >
            <span className="truncate">{names[i]}</span>
          </div>
        ))}
        {url && <div className="absolute inset-y-0 w-0.5 bg-slate-900 shadow-[0_0_0_1px_rgba(255,255,255,0.8)]" style={{ left: `${Math.min(100, (t / total) * 100)}%` }} />}
      </div>
      <div className="mt-1.5 flex justify-between text-[17px] text-slate-500 tabular-nums">
        <span>{mmss(url ? t : 0)}</span>
        <span>{mmss(total)}</span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[17px] text-slate-600" aria-label="Colour key">
        <li className="flex items-center gap-2"><span className="h-3.5 w-3.5 rounded-sm bg-red-500" />AI-generated</li>
        <li className="flex items-center gap-2"><span className="h-3.5 w-3.5 rounded-sm bg-green-600" />Real person</li>
        <li className="flex items-center gap-2"><span className="h-3.5 w-3.5 rounded-sm bg-amber-400" />Not sure</li>
      </ul>
    </div>
  )
}

function VoiceCard({
  name, seg, source, lines, transcribing,
}: {
  name: string
  seg: AnalysisResult['segments'][number]
  source: CallSource | null
  lines: TranscriptLine[]
  transcribing: boolean
}) {
  const v = VERDICT[seg.label]
  const d = detectorScores(seg)
  const hasBoth = d.A !== null && d.B !== null
  const disagree = detectorsDisagree(d)
  const look = closerLook(seg)
  const score = (x: number | null) => (x === null ? 'n/a' : `${pct(x)} AI`)
  return (
    <article className={`rounded-2xl border p-5 sm:p-6 ${CARD[seg.label]}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[17px] text-slate-600">
        <span className="font-semibold text-slate-900">{name}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{mmss(seg.start)}–{mmss(seg.end)}</span>
        {source && (
          <>
            <span aria-hidden="true">·</span>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Icon name="file" className="h-4 w-4 shrink-0" />
              <span className="truncate">{source.name}</span>
            </span>
          </>
        )}
      </div>
      <h3 className={`mt-2 text-[32px] font-extrabold leading-tight tracking-tight ${HEAD[v.tone]}`}>{v.headline}</h3>
      <p className="mt-2 text-[18px] leading-snug text-slate-800">
        {hasBoth || d.A !== null || d.B !== null
          ? `Detector A: ${score(d.A)} · Detector B: ${score(d.B)}`
          : seg.tool_score !== null
            ? `${pct(seg.tool_score)} likely AI`
            : 'No detector score available.'}
      </p>
      {disagree && seg.label !== 'synthetic' && (
        <p className="mt-1.5 text-[18px] leading-snug text-slate-800">The detectors disagreed, so CallGuard did not flag this voice.</p>
      )}
      {disagree && seg.label === 'synthetic' && look !== null && (
        <p className="mt-1.5 text-[18px] leading-snug text-slate-800">
          The detectors first disagreed. A closer look at this part found it {pct(look)} likely AI.
        </p>
      )}
      {lines.length > 0 ? (
        <div className="mt-4 border-t border-black/10 pt-4">
          <div className="text-[17px] font-semibold text-slate-500">What this voice said</div>
          <ul className="mt-1.5 space-y-1.5">
            {lines.map((l, i) => (
              <li key={i} className="text-[18px] leading-snug text-slate-900">“{l.text}”</li>
            ))}
          </ul>
        </div>
      ) : transcribing ? (
        <p className="mt-4 flex items-center gap-2 border-t border-black/10 pt-4 text-[17px] text-slate-500">
          <Spinner className="h-4 w-4" /> Writing down what was said…
        </p>
      ) : null}
    </article>
  )
}

export default function Results({
  clipId, durationS, result, sources, lines, transcribing, onReset,
}: {
  clipId: string
  durationS: number
  result: AnalysisResult
  sources: CallSource[]
  lines: TranscriptLine[] | null
  transcribing: boolean
  onReset: () => void
}) {
  const verdict = overallVerdict(result.segments)
  const names = voiceNames(result.segments)
  return (
    <section className="rise rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8" aria-labelledby="result-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="result-title" className="text-[28px] font-bold leading-tight tracking-tight text-slate-900">Result</h2>
        <button
          type="button" onClick={onReset}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-[17px] font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-accent"
        >
          Check another call
        </button>
      </div>
      <p className={`mt-3 text-[32px] font-extrabold leading-tight tracking-tight sm:text-[36px] ${HEAD[verdict.tone]}`}>{verdict.text}</p>
      {verdict.sub && <p className="mt-1 text-[18px] text-slate-600">{verdict.sub}</p>}

      {result.segments.length > 0 && (
        <div className="mt-6">
          <Player clipId={clipId} result={result} durationS={durationS} />
        </div>
      )}

      <div className="mt-6 space-y-4">
        {result.segments.map((seg, i) => (
          <VoiceCard
            key={i} name={names[i]} seg={seg} source={sourceFor(seg, sources)}
            lines={linesFor(i, result.segments, lines)} transcribing={transcribing && lines === null}
          />
        ))}
      </div>
    </section>
  )
}
