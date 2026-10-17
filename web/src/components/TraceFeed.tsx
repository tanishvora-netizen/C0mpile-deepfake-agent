import { useEffect, useMemo, useRef } from 'react'
import type { TraceEvent } from '../types'
import { buildRows } from '../lib/trace'
import { Card, Pill } from './ui'

const KIND_LABEL: Record<TraceEvent['kind'], string> = {
  tool_call: 'call',
  tool_result: 'result',
  llm: 'llm',
  final: 'final',
  error: 'error',
}

export function TraceFeed({ events, running }: { events: TraceEvent[]; running: boolean }) {
  const rows = useMemo(() => buildRows(events), [events])
  const box = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [rows.length])

  return (
    <Card
      title="Agent trace"
      right={running ? <Pill tone="accent">streaming…</Pill> : <Pill tone="neutral">{rows.length} events</Pill>}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Tool calls appear here as the agent works.</p>
      ) : (
        <ol ref={box} className="max-h-80 space-y-1.5 overflow-y-auto pr-1" aria-live="polite">
          {rows.map((r) => (
            <li
              key={r.seq}
              className={`rounded-md border px-2.5 py-1.5 text-sm ${
                r.failed
                  ? 'border-amber-300 bg-warn-soft'
                  : r.kind === 'final'
                    ? 'border-indigo-200 bg-accent-soft'
                    : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="w-5 text-xs tabular-nums text-slate-400">{r.seq}</span>
                <span className={`rounded px-1.5 text-xs font-medium ${r.failed ? 'bg-amber-200 text-amber-900' : 'bg-slate-100 text-slate-600'}`}>
                  {KIND_LABEL[r.kind]}
                </span>
                <span className="font-mono text-[13px] font-semibold text-slate-900">{r.tool}</span>
                {r.detector && <span className="rounded bg-accent-soft px-1.5 text-xs font-semibold text-accent">{r.detector}</span>}
                {r.ms !== null && <span className="ml-auto text-xs tabular-nums text-slate-500">{r.ms} ms</span>}
              </div>
              {(r.args || r.result) && (
                <p className={`mt-0.5 break-words pl-7 font-mono text-xs ${r.failed ? 'text-amber-900' : 'text-slate-600'}`}>
                  {r.args || r.result}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
