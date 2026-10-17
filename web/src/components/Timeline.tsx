import type { AnalysisResult, Label } from '../types'
import { fmt } from '../lib/trace'
import { Card } from './ui'

const REGION: Record<Label, string> = {
  synthetic: 'bg-critical text-white border-red-700',
  uncertain: 'bg-amber-400 text-amber-950 border-amber-500',
  bona_fide: 'bg-slate-200 text-slate-700 border-slate-300',
}

const SPEAKER_TINT = ['bg-indigo-100 text-indigo-900', 'bg-sky-100 text-sky-900', 'bg-violet-100 text-violet-900']

function DetectorA({ score }: { score: number | null }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 sm:w-48" data-testid="detector-a">
      <p className="text-xs font-medium text-slate-600">Detector A whole-clip score</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{fmt(score)}</p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-slate-200" aria-hidden>
        <div className="h-full bg-accent" style={{ width: `${Math.round((score ?? 0) * 100)}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        One number for the entire call. A mixed call can hide in this average.
      </p>
    </div>
  )
}

export function Timeline({ result, detectorA }: { result: AnalysisResult | null; detectorA: number | null }) {
  if (!result) {
    return (
      <Card title="Timeline">
        <div className="flex flex-col gap-3 sm:flex-row">
          <p className="flex-1 text-sm text-slate-500">Run an analysis to see per-segment verdicts here.</p>
          <DetectorA score={detectorA} />
        </div>
      </Card>
    )
  }
  const dur = Math.max(...result.segments.map((s) => s.end), 0.001)
  const speakers = [...new Set(result.segments.map((s) => s.speaker ?? '?'))]
  const ticks = Array.from({ length: Math.floor(dur) + 1 }, (_, i) => i)
  const pos = (s: { start: number; end: number }) => ({
    left: `${(s.start / dur) * 100}%`,
    width: `${((s.end - s.start) / dur) * 100}%`,
  })

  return (
    <Card
      title="Timeline"
      right={
        <span className="text-xs text-slate-500">
          {result.mixed ? `Mixed clip: ${result.composition.replace('_', ' ')}` : 'Single-source clip'}
        </span>
      }
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-xs text-slate-500">Verdict</span>
            <div className="relative h-14 flex-1 rounded bg-slate-100">
              {result.segments.map((s, i) => (
                <div
                  key={i}
                  style={pos(s)}
                  className={`absolute top-0 flex h-full flex-col items-center justify-center overflow-hidden border text-center ${REGION[s.label]}`}
                  title={`${s.label} ${s.start}–${s.end}s`}
                >
                  <span className="text-xs font-bold leading-tight">{s.label.replace('_', ' ')}</span>
                  <span className="text-[11px] tabular-nums leading-tight opacity-90">{fmt(s.tool_score)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="w-14 shrink-0 text-xs text-slate-500">Speaker</span>
            <div className="relative h-7 flex-1 rounded bg-slate-50">
              {result.segments.map((s, i) => (
                <div
                  key={i}
                  style={pos(s)}
                  className={`absolute top-0 flex h-full items-center justify-center border border-white text-xs font-semibold ${SPEAKER_TINT[speakers.indexOf(s.speaker ?? '?') % SPEAKER_TINT.length]}`}
                >
                  {s.speaker ?? '?'}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="w-14 shrink-0" />
            <div className="relative h-5 flex-1 text-[11px] text-slate-500">
              {ticks.map((t) => (
                <span
                  key={t}
                  className="absolute -translate-x-1/2 tabular-nums"
                  style={{ left: `${(t / dur) * 100}%`, ...(t === 0 ? { transform: 'none' } : {}) }}
                >
                  {t}s
                </span>
              ))}
            </div>
          </div>
        </div>
        <DetectorA score={detectorA} />
      </div>
    </Card>
  )
}
