import { useEffect, useRef, useState } from 'react'
import { clipAudioUrl } from '../api'
import type { AnalysisResult, CallSource, Label, TranscriptLine } from '../types'
import { Icon } from './Icons'
import { Spinner } from './bits'
import {
  aiAtText, groupVoices, linesForVoice, mmss, overallVerdict, pct, VERDICT, type Detectors, type Tone, type Voice, type VoiceKind,
} from './lib'

const BAR: Record<Label, string> = {
  synthetic: 'bg-ai text-bg',
  bona_fide: 'bg-human text-bg',
  uncertain: 'bg-unsure text-bg',
}
const HEAD: Record<Tone, string> = {
  danger: 'text-ai',
  ok: 'text-human',
  warn: 'text-part',
  neutral: 'text-unsure',
}
const CARD: Record<VoiceKind, string> = {
  ai: 'border-ai/40 bg-ai/10',
  human: 'border-human/40 bg-human/10',
  part: 'border-part/50 bg-part/10',
  unsure: 'border-line bg-card2',
}

function Player({ clipId, result, durationS, voices }: { clipId: string; result: AnalysisResult; durationS: number; voices: Voice[] }) {
  const url = clipAudioUrl(clipId)
  const audio = useRef<HTMLAudioElement>(null)
  const [t, setT] = useState(0)
  const [len, setLen] = useState(0)
  const [playing, setPlaying] = useState(false)
  const nameAt: string[] = []
  voices.forEach((v) => v.idx.forEach((i) => { nameAt[i] = v.name }))
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
          ref={audio} src={url} controls preload="metadata" className="w-full [color-scheme:dark]"
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setLen(e.currentTarget.duration)}
          onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        />
      )}
      <div
        className="relative mt-3 h-14 cursor-pointer overflow-hidden rounded-2xl bg-card2"
        onClick={(e) => url && seek(e.clientX, e.currentTarget)}
        role="img"
        aria-label={result.segments.map((s, i) => `${nameAt[i]}, ${mmss(s.start)} to ${mmss(s.end)}: ${VERDICT[s.label].headline}`).join('. ')}
      >
        {result.segments.map((s, i) => (
          <div
            key={i}
            title={`${nameAt[i]} · ${mmss(s.start)}–${mmss(s.end)} · ${VERDICT[s.label].headline}`}
            className={`absolute inset-y-0 flex items-center justify-center overflow-hidden border-r-2 border-bg px-2 text-[17px] font-bold last:border-r-0 ${BAR[s.label]}`}
            style={{ left: `${(s.start / total) * 100}%`, width: `${((s.end - s.start) / total) * 100}%` }}
          >
            <span className="truncate">{nameAt[i]}</span>
          </div>
        ))}
        {url && <div className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.7),0_0_10px_rgba(255,255,255,0.8)]" style={{ left: `${Math.min(100, (t / total) * 100)}%` }} />}
      </div>
      <div className="mt-1.5 flex justify-between text-[17px] text-mute tabular-nums">
        <span>{mmss(url ? t : 0)}</span>
        <span>{mmss(total)}</span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[17px] text-mute" aria-label="Colour key">
        <li className="flex items-center gap-2"><span className="h-3.5 w-3.5 rounded-sm bg-ai" />AI-generated</li>
        <li className="flex items-center gap-2"><span className="h-3.5 w-3.5 rounded-sm bg-human" />Real person</li>
        <li className="flex items-center gap-2"><span className="h-3.5 w-3.5 rounded-sm bg-unsure" />Couldn't tell</li>
      </ul>
    </div>
  )
}

function DetectorLine({ d, fallback }: { d: Detectors | null; fallback: number | null }) {
  const parts = d ? (['A', 'B', 'C'] as const).filter((k) => d[k] !== null).map((k) => `${k} ${pct(d[k] as number)}`) : []
  if (parts.length) {
    return <p className="mt-2 text-[18px] leading-snug text-ink tabular-nums">Detectors: {parts.join(' · ')} AI</p>
  }
  if (fallback !== null) return <p className="mt-2 text-[18px] leading-snug text-ink">{pct(fallback)} likely AI</p>
  return null
}

function VoiceCard({
  voice, lines, transcribing,
}: {
  voice: Voice
  lines: TranscriptLine[]
  transcribing: boolean
}) {
  const src: CallSource | null = voice.source
  const scores = voice.segments.map((s) => s.tool_score).filter((x): x is number => x !== null)
  const fallback = scores.length ? Math.max(...scores) : null
  return (
    <article className={`rounded-3xl border p-5 sm:p-6 ${CARD[voice.kind]}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[17px] text-mute">
        <span className="font-bold text-ink">{voice.name}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{mmss(voice.start)}–{mmss(voice.end)}</span>
        {src && (
          <>
            <span aria-hidden="true">·</span>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Icon name="file" className="h-4 w-4 shrink-0" />
              <span className="truncate">{src.name}</span>
            </span>
          </>
        )}
      </div>
      <h3 className={`mt-2 text-[34px] font-black leading-[1.05] tracking-tight ${HEAD[voice.tone]}`}>{voice.headline}</h3>
      {voice.kind === 'part' && voice.aiRanges.length > 0 && (
        <p className="mt-2 text-[20px] font-bold leading-snug text-ink tabular-nums">{aiAtText(voice.aiRanges)}</p>
      )}
      <DetectorLine d={voice.detectors} fallback={fallback} />
      {lines.length > 0 ? (
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="text-[17px] font-semibold text-mute">What this voice said</div>
          <ul className="mt-1.5 space-y-1.5">
            {lines.map((l, i) => (
              <li key={i} className="text-[18px] leading-snug text-ink">“{l.text}”</li>
            ))}
          </ul>
        </div>
      ) : transcribing ? (
        <p className="mt-4 flex items-center gap-2 border-t border-white/10 pt-4 text-[17px] text-mute">
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
  const voices = groupVoices(result.segments, sources)
  const verdict = overallVerdict(result.segments, voices)
  return (
    <section className="rise rounded-3xl border border-line bg-card p-5 shadow-[0_0_80px_rgba(209,254,23,0.04)] sm:p-8" aria-labelledby="result-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="result-title" className="text-[17px] font-bold uppercase tracking-[0.12em] text-accent">Result</h2>
        <button
          type="button" onClick={onReset}
          className="rounded-full border border-line bg-card2 px-5 py-2.5 text-[17px] font-semibold text-ink hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
        >
          Check another call
        </button>
      </div>
      <p className={`mt-3 text-[40px] font-black leading-[1.02] tracking-tight sm:text-[52px] ${HEAD[verdict.tone]}`}>{verdict.text}</p>
      {verdict.sub && <p className="mt-3 text-[22px] font-semibold leading-snug text-ink">{verdict.sub}</p>}
      <p className="mt-2 text-[17px] leading-snug text-mute">A voice is marked AI only when all three detectors agree.</p>

      {result.segments.length > 0 && (
        <div className="mt-6">
          <Player clipId={clipId} result={result} durationS={durationS} voices={voices} />
        </div>
      )}

      <div className="mt-6 space-y-4">
        {voices.map((v, i) => (
          <VoiceCard
            key={v.name} voice={v}
            lines={linesForVoice(i, voices, lines)} transcribing={transcribing && lines === null}
          />
        ))}
      </div>
    </section>
  )
}
