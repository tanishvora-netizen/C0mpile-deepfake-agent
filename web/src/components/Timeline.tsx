import type { AnalysisResult } from '../types'
import { mmss, pct } from '../home/lib'
import { Card, Empty, LABEL_DOT, LABEL_SOLID, LABEL_TEXT } from './ui'

const SPEAKER_TINT = ['bg-card2 text-ink', 'bg-line text-ink', 'bg-card2 text-mute']

function DetectorA({ score }: { score: number | null }) {
  return (
    <div className="rounded-2xl border border-line bg-card2 p-4 lg:w-60" data-testid="detector-a">
      <p className="text-[15px] font-semibold text-mute">Whole-call check (detector A)</p>
      <p className="mt-1 text-[32px] font-black leading-none tabular-nums text-ink">{score === null ? '—' : pct(score)}</p>
      <p className="text-[15px] text-mute">{score === null ? 'not reported yet' : 'likely AI'}</p>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((score ?? 0) * 100)}%` }} />
      </div>
      <p className="mt-2 text-[15px] leading-snug text-mute">
        One number for the entire call. A mixed call can hide in this average.
      </p>
    </div>
  )
}

export function Timeline({ result, detectorA }: { result: AnalysisResult | null; detectorA: number | null }) {
  if (!result) {
    return (
      <Card title="Timeline" desc="Who spoke when, coloured by what CallGuard found.">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="flex-1"><Empty>Run a check to see a verdict for each stretch of the call.</Empty></div>
          <DetectorA score={detectorA} />
        </div>
      </Card>
    )
  }
  const dur = Math.max(...result.segments.map((s) => s.end), 0.001)
  const speakers = [...new Set(result.segments.map((s) => s.speaker ?? '?'))]
  const tickStep = dur > 60 ? 15 : dur > 20 ? 5 : dur > 8 ? 2 : 1
  const ticks = Array.from({ length: Math.floor(dur / tickStep) + 1 }, (_, i) => i * tickStep)
  const pos = (s: { start: number; end: number }) => ({
    left: `${(s.start / dur) * 100}%`,
    width: `${((s.end - s.start) / dur) * 100}%`,
  })
  const present = (['synthetic', 'bona_fide', 'uncertain'] as const).filter((l) => result.segments.some((s) => s.label === l))

  return (
    <Card
      title="Timeline"
      desc="Who spoke when, coloured by what CallGuard found."
      right={
        <span className="text-[15px] text-mute">
          {result.mixed ? 'Part human, part AI call' : 'One source for the whole call'}
        </span>
      }
    >
      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-[14px] text-mute sm:w-16 sm:text-[15px]">Verdict</span>
            <div className="relative h-16 flex-1 overflow-hidden rounded-2xl bg-card2">
              {result.segments.map((s, i) => (
                <div
                  key={i}
                  style={pos(s)}
                  className={`absolute top-0 flex h-full flex-col items-center justify-center overflow-hidden border-r-2 border-bg px-1 text-center last:border-r-0 ${LABEL_SOLID[s.label]}`}
                  title={`${LABEL_TEXT[s.label]} · ${mmss(s.start)}–${mmss(s.end)}${s.tool_score !== null ? ` · ${pct(s.tool_score)} likely AI` : ''}`}
                >
                  <span className="max-w-full truncate text-[14px] font-extrabold leading-tight">{LABEL_TEXT[s.label]}</span>
                  {s.tool_score !== null && <span className="text-[13px] font-semibold tabular-nums leading-tight opacity-80">{pct(s.tool_score)} AI</span>}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <span className="w-14 shrink-0 text-[14px] text-mute sm:w-16 sm:text-[15px]">Speaker</span>
            <div className="relative h-9 flex-1 overflow-hidden rounded-xl bg-card2">
              {result.segments.map((s, i) => (
                <div
                  key={i}
                  style={pos(s)}
                  className={`absolute top-0 flex h-full items-center justify-center overflow-hidden border-r-2 border-bg px-1 text-[14px] font-semibold ${SPEAKER_TINT[speakers.indexOf(s.speaker ?? '?') % SPEAKER_TINT.length]}`}
                >
                  <span className="truncate">{s.speaker ?? '?'}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <span className="w-14 shrink-0 sm:w-16" />
            <div className="relative h-5 flex-1 text-[13px] text-mute">
              {ticks.map((t) => (
                <span
                  key={t}
                  className="absolute -translate-x-1/2 tabular-nums"
                  style={{ left: `${(t / dur) * 100}%`, ...(t === 0 ? { transform: 'none' } : {}) }}
                >
                  {mmss(t)}
                </span>
              ))}
            </div>
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[15px] text-mute" aria-label="Colour key">
            {present.map((l) => (
              <li key={l} className="flex items-center gap-2"><span className={`h-3 w-3 rounded-sm ${LABEL_DOT[l]}`} />{LABEL_TEXT[l]}</li>
            ))}
          </ul>
        </div>
        <DetectorA score={detectorA} />
      </div>
    </Card>
  )
}
