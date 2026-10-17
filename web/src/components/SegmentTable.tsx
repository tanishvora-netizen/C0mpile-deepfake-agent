import { useMemo } from 'react'
import type { AnalysisResult } from '../types'
import { fmt } from '../lib/trace'
import { aiAtText, groupVoices, mmss, overallVerdict, pct } from '../home/lib'
import { Card, Disclosure, Empty, LabelBadge, TONE_CARD, TONE_TEXT } from './ui'

export function SegmentTable({ result }: { result: AnalysisResult | null }) {
  const voices = useMemo(() => (result ? groupVoices(result.segments, []) : []), [result])
  const verdict = useMemo(() => (result ? overallVerdict(result.segments, voices) : null), [result, voices])

  return (
    <Card
      title="What was found"
      desc="Each stretch of the call, with the same wording as the CallGuard home page."
      right={result?.abstain ? <span className="text-[15px] font-semibold text-part">Couldn't decide: {result.abstain}</span> : null}
    >
      {!result || !verdict ? (
        <Empty>No result yet. Run a check above.</Empty>
      ) : (
        <div className="space-y-5">
          <div className={`rounded-2xl border p-4 ${TONE_CARD[verdict.tone]}`}>
            <p className={`text-[24px] font-extrabold leading-tight ${TONE_TEXT[verdict.tone]}`}>{verdict.text}</p>
            {verdict.sub && <p className="mt-1 text-[17px] text-ink">{verdict.sub}</p>}
          </div>

          {voices.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {voices.map((v) => (
                <li key={v.name} className={`rounded-2xl border p-4 ${TONE_CARD[v.tone]}`}>
                  <p className="text-[15px] font-semibold text-mute">{result.segments[v.idx[0]]?.speaker ?? v.name} · {mmss(v.start)}–{mmss(v.end)}</p>
                  <p className={`mt-0.5 text-[19px] font-extrabold leading-tight ${TONE_TEXT[v.tone]}`}>{v.headline}</p>
                  {v.aiRanges.length > 0 && v.kind !== 'ai' && <p className="mt-1 text-[16px] text-ink">{aiAtText(v.aiRanges)}</p>}
                </li>
              ))}
            </ul>
          )}

          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full text-left text-[16px]">
              <thead className="bg-card2 text-[14px] font-semibold text-mute">
                <tr>
                  <th className="px-3 py-2.5 font-semibold sm:px-4">When</th>
                  <th className="hidden px-4 py-2.5 font-semibold sm:table-cell">Speaker</th>
                  <th className="px-3 py-2.5 font-semibold sm:px-4">What we found</th>
                  <th className="px-3 py-2.5 font-semibold sm:px-4">AI chance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {result.segments.map((s, i) => (
                  <tr key={i} className="align-middle">
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums text-ink sm:px-4">{mmss(s.start)}–{mmss(s.end)}</td>
                    <td className="hidden px-4 py-3 text-ink sm:table-cell">{s.speaker ?? '—'}</td>
                    <td className="px-3 py-3 sm:px-4"><LabelBadge label={s.label} /></td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums text-ink sm:px-4">{s.tool_score === null ? '—' : pct(s.tool_score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(result.summary || result.segments.some((s) => s.evidence.length > 0)) && (
            <Disclosure label="Show details" openLabel="Hide details">
              {result.summary && <p className="mb-3 text-[16px] leading-relaxed text-mute">{result.summary}</p>}
              <ul className="space-y-3">
                {result.segments.map((s, i) => (
                  <li key={i} className="rounded-2xl border border-line bg-card2 p-3">
                    <p className="text-[15px] font-semibold text-ink">
                      {mmss(s.start)}–{mmss(s.end)} · {s.speaker ?? 'speaker unknown'} · exact start {fmt(s.start, 1)}s, end {fmt(s.end, 1)}s
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {s.evidence.map((ev, j) => (
                        <span key={j} className="rounded-full bg-card px-2.5 py-0.5 font-mono text-[12px] text-mute">
                          {ev.tool}.{ev.field}={typeof ev.value === 'number' ? ev.value.toFixed(2) : String(ev.value)}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </div>
      )}
    </Card>
  )
}
