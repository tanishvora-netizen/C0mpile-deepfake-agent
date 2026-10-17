import { buildRows } from '../lib/trace'
import type { TraceEvent } from '../types'
import { IconTile, Spinner } from './bits'
import { Icon } from './Icons'
import { mmss, pct, type PlainRow, type VerdictRow } from './plain'

function Row({ row }: { row: PlainRow }) {
  return (
    <li className="rise flex items-center gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-2">
      <IconTile icon={row.icon} tone={row.tone} />
      <div className="min-w-0">
        <div className="text-[21px] font-semibold leading-tight text-slate-900">{row.text}</div>
        {row.sub && <div className="text-base text-slate-500">{row.sub}</div>}
      </div>
    </li>
  )
}

function VerdictCard({ verdict, clipScore }: { verdict: VerdictRow[]; clipScore: number | null }) {
  const anyFake = verdict.some((v) => v.label === 'synthetic')
  return (
    <div className="rise rounded-3xl border-2 border-slate-900 bg-white p-6 shadow-[0_12px_40px_rgba(15,23,42,0.12)]">
      <div className="mb-4 flex items-center gap-3">
        <Icon name="shieldCheck" className={`h-9 w-9 ${anyFake ? 'text-red-600' : 'text-green-600'}`} />
        <h2 className="text-[30px] font-extrabold leading-none tracking-tight">
          {anyFake ? 'A cloned voice was found' : 'No cloned voice found'}
        </h2>
      </div>
      <ul className="space-y-3">
        {verdict.map((v, i) => {
          const fake = v.label === 'synthetic'
          const unsure = v.label === 'uncertain'
          return (
            <li
              key={i}
              style={{ animationDelay: `${i * 0.25}s` }}
              className={`rise rounded-2xl border-l-8 px-5 py-3 ${
                fake ? 'border-red-600 bg-red-50' : unsure ? 'border-amber-500 bg-amber-50' : 'border-green-600 bg-green-50'
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 text-[22px] font-semibold text-slate-900">
                <span className="tabular-nums text-slate-600">{mmss(v.start)}–{mmss(v.end)}</span>
                <span>“{v.name}”</span>
              </div>
              <div className={`mt-0.5 text-[26px] font-extrabold tracking-tight ${fake ? 'text-red-700' : unsure ? 'text-amber-800' : 'text-green-800'}`}>
                {fake ? 'AI-GENERATED VOICE' : unsure ? 'Not sure' : 'Real person'}
                {v.score !== null && fake && <span className="ml-3 text-lg font-semibold text-red-700/80">{pct(v.score)} likely AI</span>}
              </div>
            </li>
          )
        })}
      </ul>
      {anyFake && (
        <p className="mt-4 rounded-2xl bg-accent-soft px-5 py-4 text-[19px] leading-snug text-slate-800">
          {clipScore !== null && clipScore < 0.5 ? (
            <>
              A single score for the whole call said <b className="text-accent">{pct(clipScore)}</b> — it would have looked safe.{' '}
              <b>Checking each speaker caught the clone.</b>
            </>
          ) : (
            <b>Checking each speaker separately pinpointed exactly which voice is the clone.</b>
          )}
        </p>
      )}
    </div>
  )
}

export default function StepCheck({ rows, llmSteps, working, error, verdict, clipScore, events }: {
  rows: PlainRow[]
  llmSteps: number
  working: boolean
  error: string | null
  verdict: VerdictRow[] | null
  clipScore: number | null
  events: TraceEvent[]
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[1.05fr_1fr]">
      <div>
        <ul className="space-y-2">
          {rows.map((r) => <Row key={r.id} row={r} />)}
        </ul>
        {working && !error && (
          <div className="mt-3 flex items-center gap-3 px-2 text-lg text-slate-500">
            <Spinner /> {llmSteps > 0 ? 'AI agent reasoning about what to check next…' : 'CallGuard is listening…'}
          </div>
        )}
        {!working && llmSteps > 0 && (
          <div className="mt-3 flex items-center gap-3 px-2 text-base text-slate-400">
            <Icon name="sparkle" className="h-5 w-5" /> AI agent reasoning: {llmSteps} step{llmSteps === 1 ? '' : 's'} (see technical trace)
          </div>
        )}
        {error && <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-lg text-red-800">{error}</p>}
      </div>

      <div>
        {verdict ? (
          <VerdictCard verdict={verdict} clipScore={clipScore} />
        ) : (
          <div className="grid min-h-[260px] place-items-center rounded-3xl border-2 border-dashed border-slate-300 p-6 text-center text-xl text-slate-400">
            {error ? 'No verdict' : 'The verdict appears here'}
          </div>
        )}
        {events.length > 0 && (
          <details className="mt-3 px-2 text-base text-slate-500">
            <summary className="cursor-pointer select-none text-slate-400 hover:text-slate-600">Show technical trace</summary>
            <div className="mt-2 max-h-72 overflow-auto rounded-xl bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-200">
              {buildRows(events).map((r, i) => (
                <div key={i} className="whitespace-pre-wrap break-words">
                  <span className="text-slate-500">{String(r.seq).padStart(2, '0')} {r.kind}</span>{' '}
                  <span className="text-sky-300">{r.tool}{r.detector ? ` (${r.detector})` : ''}</span>{' '}
                  {r.args || r.result}{r.ms !== null ? ` · ${Math.round(r.ms)} ms` : ''}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
