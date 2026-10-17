import { useEffect, useMemo, useRef } from 'react'
import type { TraceEvent } from '../types'
import { buildRows } from '../lib/trace'
import { buildProgress } from '../home/lib'
import { Icon } from '../home/Icons'
import { Spinner } from '../home/bits'
import { Card, Disclosure, Empty, Pill } from './ui'

const KIND_LABEL: Record<TraceEvent['kind'], string> = {
  tool_call: 'call',
  tool_result: 'result',
  llm: 'llm',
  final: 'final',
  error: 'error',
}

export function TraceFeed({ events, running }: { events: TraceEvent[]; running: boolean }) {
  const rows = useMemo(() => buildRows(events), [events])
  const steps = useMemo(() => buildProgress(events), [events])
  const box = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [rows.length])

  return (
    <Card
      title="What CallGuard is doing"
      desc="Each check the agent runs, in plain words."
      right={running ? <Pill tone="accent">Working…</Pill> : <Pill tone="neutral">{rows.length} steps</Pill>}
    >
      {rows.length === 0 ? (
        <Empty>Steps appear here once you run a check.</Empty>
      ) : (
        <>
          {steps.length > 0 && (
            <ul className="space-y-2.5" aria-live="polite">
              {steps.map((l, i) => {
                const active = running && i === steps.length - 1
                return (
                  <li key={l.id} className="flex items-start gap-3 text-[17px] leading-snug">
                    <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center ${active ? 'text-accent' : l.tone === 'warn' ? 'text-part' : 'text-mute'}`}>
                      {active ? <Spinner className="h-5 w-5" /> : <Icon name={l.tone === 'warn' ? 'alert' : 'check'} className="h-5 w-5" />}
                    </span>
                    <span className={active ? 'font-bold text-ink' : l.tone === 'warn' ? 'text-part' : 'text-mute'}>{l.text}</span>
                  </li>
                )
              })}
            </ul>
          )}
          <Disclosure className={steps.length > 0 ? 'mt-4' : ''} label="Show details" openLabel="Hide details">
            <ol ref={box} className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {rows.map((r) => (
                <li
                  key={r.seq}
                  className={`rounded-2xl border px-3 py-2 text-[15px] ${
                    r.failed ? 'border-part/50 bg-part/10' : r.kind === 'final' ? 'border-accent/40 bg-accent/10' : 'border-line bg-card2'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="w-5 text-xs tabular-nums text-mute">{r.seq}</span>
                    <span className={`rounded-full px-2 text-xs font-semibold ${r.failed ? 'bg-part/20 text-part' : 'bg-card text-mute'}`}>
                      {KIND_LABEL[r.kind]}
                    </span>
                    <span className="font-mono text-[13px] font-semibold text-ink">{r.tool}</span>
                    {r.detector && <span className="rounded-full bg-accent/15 px-2 text-xs font-semibold text-accent">{r.detector}</span>}
                    {r.ms !== null && <span className="ml-auto text-xs tabular-nums text-mute">{r.ms} ms</span>}
                  </div>
                  {(r.args || r.result) && (
                    <p className={`mt-1 break-words pl-7 font-mono text-xs ${r.failed ? 'text-part' : 'text-mute'}`}>{r.args || r.result}</p>
                  )}
                </li>
              ))}
            </ol>
          </Disclosure>
        </>
      )}
    </Card>
  )
}
