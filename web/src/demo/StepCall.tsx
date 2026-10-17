import { useEffect, useMemo, useRef, useState } from 'react'
import { clipAudioUrl } from '../api'
import type { GoldenClip, TranscriptLine } from '../types'
import { Icon } from './Icons'
import { mmss, voiceName } from './plain'

interface Block { start: number; end: number; voice: number; name: string; who: string }

function buildBlocks(lines: TranscriptLine[]): Block[] {
  const voices: string[] = []
  const blocks: Block[] = []
  for (const l of lines) {
    let v = voices.indexOf(l.speaker)
    if (v < 0) v = voices.push(l.speaker) - 1
    const last = blocks[blocks.length - 1]
    if (last && last.voice === v && l.start - last.end < 0.5) {
      last.end = l.end
      continue
    }
    const name = voiceName(l.start, l.end, lines, v)
    const who = l.who ?? (v === 0 ? `Caller says they're ${name}` : `Voice ${v + 1}: '${name}'`)
    blocks.push({ start: l.start, end: l.end, voice: v, name, who })
  }
  return blocks
}

const VOICE_BG = ['bg-indigo-400', 'bg-slate-400', 'bg-sky-300']

export default function StepCall({ clip, lines, active }: {
  clip: GoldenClip
  lines: TranscriptLine[] | null
  active: boolean
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [audioFailed, setAudioFailed] = useState(false)
  const [played, setPlayed] = useState(false)
  const src = clipAudioUrl(clip.clip_id)

  const blocks = useMemo(() => buildBlocks(lines ?? []), [lines])
  const total = Math.max(dur, clip.duration_s ?? 0, ...(lines ?? []).map((l) => l.end), 1)

  // Smooth playhead: read currentTime every frame while playing.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      if (audioRef.current) setT(audioRef.current.currentTime)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // Leaving this step stops the audio.
  useEffect(() => {
    if (!active) audioRef.current?.pause()
  }, [active])

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) {
      if (a.ended || a.currentTime >= total - 0.05) a.currentTime = 0
      void a.play().catch(() => undefined)
    } else a.pause()
  }

  const idle = !played && !playing
  const line = idle
    ? undefined
    : (lines ?? []).find((l) => t >= l.start && t < l.end)
      ?? [...(lines ?? [])].reverse().find((l) => l.start <= t)
  const block = line ? blocks.find((b) => line.start >= b.start && line.end <= b.end) : undefined

  return (
    <div className="rise overflow-hidden rounded-[28px] bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 text-white shadow-xl">
      <div className="flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-center lg:gap-10">
        {/* the "phone call" side */}
        <div className="flex shrink-0 items-center gap-5 lg:w-[330px] lg:flex-col lg:items-start lg:gap-6">
          <div className="relative grid h-20 w-20 shrink-0 place-items-center rounded-full bg-white/10 text-white/90">
            {idle && <span className="ripple absolute inset-0 rounded-full border-2 border-white/40" />}
            <Icon name="phone" className="h-9 w-9" />
          </div>
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-200">Incoming call</div>
            <div className="text-[32px] font-bold leading-tight">Unknown number</div>
            <div className="text-lg text-slate-300">To: Grandma</div>
          </div>
        </div>

        {/* captions + play */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="min-h-[170px]">
            {line ? (
              <div key={line.start} className="rise">
                <span className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-lg font-bold text-slate-900 ${VOICE_BG[(block?.voice ?? 0) % 3]}`}>
                  <Icon name="user" className="h-5 w-5" />
                  {line.who ?? block?.who ?? 'Caller'}
                </span>
                <p className="mt-3 text-[34px] font-semibold leading-tight sm:text-[40px]">“{line.text}”</p>
              </div>
            ) : (
              <p className="pt-6 text-[30px] font-medium leading-tight text-slate-300">
                {audioFailed || !src
                  ? 'Audio is not available for this scenario. Press Next to continue.'
                  : lines && !lines.length
                    ? 'Press play to hear the call.'
                    : 'Press play to hear what Grandma hears.'}
              </p>
            )}
          </div>
          {src && !audioFailed && (
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={toggle}
                className={`flex items-center gap-3 rounded-full bg-white py-3 pl-4 pr-7 text-2xl font-bold text-slate-900 shadow-lg transition hover:scale-[1.02] ${idle && active ? 'pulse-ring' : ''}`}
              >
                <span className="grid h-12 w-12 place-items-center rounded-full bg-accent text-white">
                  <Icon name={playing ? 'pause' : 'play'} className="h-6 w-6" fill />
                </span>
                {playing ? 'Pause' : played ? 'Play again' : 'Play the call'}
              </button>
              <span className="text-lg tabular-nums text-slate-300">{mmss(t)} / {mmss(total)}</span>
            </div>
          )}
          {src && (
            <audio
              ref={audioRef}
              src={src}
              preload="auto"
              onPlay={() => { setPlaying(true); setPlayed(true) }}
              onPause={() => { setPlaying(false); if (audioRef.current) setT(audioRef.current.currentTime) }}
              onEnded={() => { setPlaying(false); if (audioRef.current) setT(audioRef.current.currentTime) }}
              onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
              onError={() => setAudioFailed(true)}
            />
          )}
        </div>
      </div>

      {/* speaker bar */}
      {blocks.length > 0 && (
        <div className="px-6 pb-6 sm:px-8 sm:pb-8">
          <div className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Who is talking</div>
          <div className="relative h-16 overflow-hidden rounded-2xl bg-white/10">
            {blocks.map((b) => {
              const on = line && line.start >= b.start && line.end <= b.end
              return (
                <div
                  key={`${b.start}-${b.voice}`}
                  className={`absolute top-0 flex h-full items-center justify-center overflow-hidden px-3 text-lg font-bold text-slate-900 transition-opacity duration-300 ${VOICE_BG[b.voice % 3]} ${on || idle ? 'opacity-100' : 'opacity-55'}`}
                  style={{ left: `${(b.start / total) * 100}%`, width: `${((b.end - b.start) / total) * 100}%` }}
                >
                  <span className="truncate">{b.who}</span>
                </div>
              )
            })}
            <div
              className="absolute top-0 h-full w-[3px] bg-white shadow-[0_0_12px_rgba(255,255,255,0.9)]"
              style={{ left: `${Math.min(100, (t / total) * 100)}%` }}
            />
          </div>
          <div className="relative mt-1 h-5 text-sm tabular-nums text-slate-400">
            <span className="absolute left-0">0:00</span>
            {blocks.slice(1).map((b) => (
              <span key={b.start} className="absolute -translate-x-1/2" style={{ left: `${(b.start / total) * 100}%` }}>{mmss(b.start)}</span>
            ))}
            <span className="absolute right-0">{mmss(total)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
