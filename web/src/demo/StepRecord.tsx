import { useState } from 'react'
import type { CaseView, Packet } from '../types'
import { IconTile, Spinner } from './bits'
import { Icon } from './Icons'
import { buildTimeline } from './plain'

export default function StepRecord({ view, packet, busy, onTamper }: {
  view: CaseView | null
  packet: Packet | null
  busy: boolean
  onTamper: () => void
}) {
  const [showAll, setShowAll] = useState(false)
  if (!view) {
    return <div className="flex items-center gap-3 text-xl text-slate-500"><Spinner className="h-6 w-6" /> Loading the record…</div>
  }
  const chain = view.chain ?? packet?.chain ?? null
  const ok = chain ? chain.ok : true
  const items = buildTimeline(view.events)
  const sarLines = (packet?.sar_draft ?? '').split('\n').filter((l) => l.trim())

  return (
    <div className="grid gap-8 lg:grid-cols-[1.05fr_1fr]">
      <ol className="space-y-1.5">
        {items.map((it, i) => {
          const bad = !ok && chain?.bad_seq === it.seq
          return (
            <li
              key={it.seq}
              style={{ animationDelay: `${i * 0.08}s` }}
              className={`rise flex items-center gap-4 rounded-2xl border px-4 py-1.5 ${bad ? 'border-red-500 bg-red-50' : 'border-slate-200 bg-white'}`}
            >
              <IconTile icon={bad ? 'alert' : it.icon} tone={bad ? 'danger' : it.tone} />
              <div className="min-w-0 flex-1">
                <div className="text-[19px] font-semibold leading-tight text-slate-900">{it.text}</div>
                {it.sub && <div className="text-base text-slate-500">{it.sub}</div>}
              </div>
              {bad ? (
                <span className="rounded-full bg-red-600 px-3 py-1 text-sm font-bold text-white">ALTERED</span>
              ) : (
                <span className="text-sm tabular-nums text-slate-400">#{it.seq}</span>
              )}
            </li>
          )
        })}
      </ol>

      <div className="space-y-3">
        <div
          key={ok ? 'ok' : 'bad'}
          className={`${ok ? 'rise' : 'shake'} flex items-center gap-5 rounded-3xl border-2 p-5 ${
            ok ? 'border-green-500 bg-green-50 text-green-900' : 'border-red-500 bg-red-50 text-red-900'
          }`}
        >
          <span className={`grid h-16 w-16 shrink-0 place-items-center rounded-full text-white ${ok ? 'bg-green-600' : 'bg-red-600'}`}>
            <Icon name={ok ? 'lock' : 'alert'} className="h-8 w-8" />
          </span>
          <div>
            <div className="text-[30px] font-extrabold leading-tight tracking-tight">
              {ok ? 'Record verified — nothing has been altered' : `Record was altered at entry #${chain?.bad_seq ?? '?'}`}
            </div>
            <div className="mt-1 text-lg">
              {ok
                ? 'Each entry is sealed to the one before it, so any edit shows up.'
                : 'The seals no longer match, so the change is caught.'}
            </div>
          </div>
        </div>

        <button
          type="button" disabled={busy || !ok} onClick={onTamper}
          className={`w-full rounded-2xl border-2 border-slate-900 bg-white px-6 py-3.5 text-xl font-bold text-slate-900 transition hover:bg-slate-50 disabled:opacity-50 ${ok && !busy ? 'pulse-ring' : ''}`}
        >
          {ok ? (busy ? 'Altering…' : 'Try to tamper with the record') : 'Tampering detected'}
        </button>

        {sarLines.length > 0 && (
          <div className="rounded-3xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <Icon name="file" className="h-5 w-5 shrink-0 text-slate-500" />
              <h3 className="text-[17px] font-bold leading-snug">Suspicious Activity Report draft <span className="font-medium text-slate-500">(for the compliance officer)</span></h3>
            </div>
            <div className={`relative mt-3 text-[15px] leading-snug text-slate-700 ${showAll ? 'max-h-72 overflow-auto' : 'max-h-[8.2em] overflow-hidden'}`}>
              {sarLines.map((l, i) => <p key={i} className="whitespace-pre-wrap">{l}</p>)}
              {!showAll && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white to-transparent" />
              )}
            </div>
            {sarLines.length > 0 && (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 text-base font-semibold text-accent hover:underline">
                {showAll ? 'Show less' : 'Show full draft'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
