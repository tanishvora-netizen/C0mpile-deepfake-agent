import type { AnalysisResult } from '../types'
import { fmt } from '../lib/trace'
import { Card, LabelBadge } from './ui'

export function SegmentTable({ result }: { result: AnalysisResult | null }) {
  return (
    <Card
      title="Segments"
      right={result?.abstain ? <span className="text-xs font-medium text-warn">Abstained: {result.abstain}</span> : null}
    >
      {!result ? (
        <p className="text-sm text-slate-500">No result yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Start</th>
                  <th className="py-1 pr-3 font-medium">End</th>
                  <th className="py-1 pr-3 font-medium">Speaker</th>
                  <th className="py-1 pr-3 font-medium">Label</th>
                  <th className="py-1 pr-3 font-medium">Score</th>
                  <th className="py-1 font-medium">Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.segments.map((s, i) => (
                  <tr key={i} className="align-top">
                    <td className="py-2 pr-3 tabular-nums">{fmt(s.start, 1)}s</td>
                    <td className="py-2 pr-3 tabular-nums">{fmt(s.end, 1)}s</td>
                    <td className="py-2 pr-3">{s.speaker ?? '—'}</td>
                    <td className="py-2 pr-3"><LabelBadge label={s.label} /></td>
                    <td className="py-2 pr-3 tabular-nums">{fmt(s.tool_score)}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {s.evidence.map((ev, j) => (
                          <span key={j} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                            {ev.tool}.{ev.field}={typeof ev.value === 'number' ? ev.value.toFixed(2) : String(ev.value)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-slate-700">{result.summary}</p>
        </>
      )}
    </Card>
  )
}
