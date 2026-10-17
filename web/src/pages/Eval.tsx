import { useEffect, useMemo, useState } from 'react'
import { getEval } from '../api'
import { asObj } from '../lib/trace'
import { Card, Disclosure, ErrorNote, PageHeader, Pill } from '../components/ui'
import { cap, pct } from '../home/lib'

type Row = Record<string, unknown>

/** The results.json shape is owned by the eval harness; accept a few reasonable layouts. */
function parse(raw: unknown): { provenance: string | null; rows: Row[]; note: string | null } {
  const o = asObj(raw)
  let rows: Row[] = []
  if (Array.isArray(raw)) rows = raw.map(asObj)
  else {
    const arr = ['rows', 'results', 'systems', 'table'].map((k) => o[k]).find(Array.isArray)
    if (Array.isArray(arr)) rows = arr.map(asObj)
    else {
      const holder = asObj(o.summary ?? o.systems ?? o.results ?? o.metrics ?? o)
      rows = Object.entries(holder)
        .filter(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) && !['provenance', 'meta', 'note'].includes(k))
        .map(([k, v]) => ({ system: k, ...asObj(v) }))
    }
  }
  const prov = o.provenance ?? asObj(o.meta).provenance ?? rows[0]?.provenance
  return {
    provenance: typeof prov === 'string' ? prov : null,
    rows,
    note: typeof o.note === 'string' ? o.note : null,
  }
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3)
  if (typeof v === 'string' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

const HEAD: Record<string, string> = {
  system: 'Way of checking',
  mean_turn_accuracy: 'Voices judged correctly',
  abstain_rate: "Couldn't tell",
  mean_tool_calls: 'Checks run (average)',
}
const RATE = /accuracy|rate|recall|precision|f1|auc/

const head = (c: string): string => HEAD[c] ?? cap(c.replace(/_/g, ' '))
function show(c: string, v: unknown): string {
  if (c === 'system' && typeof v === 'string') return cap(v)
  if (typeof v === 'number' && RATE.test(c) && v >= 0 && v <= 1) return pct(v)
  if (typeof v === 'number' && c.includes('tool_calls')) return v.toFixed(1)
  return cell(v)
}

export default function Eval() {
  const [raw, setRaw] = useState<unknown>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getEval()
      .then(setRaw)
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])

  const parsed = useMemo(() => (raw ? parse(raw) : null), [raw])
  const cols = useMemo(() => {
    const set: string[] = []
    for (const r of parsed?.rows ?? []) for (const k of Object.keys(r)) if (k !== 'provenance' && !set.includes(k)) set.push(k)
    return set.sort((a, b) => (a === 'system' ? -1 : b === 'system' ? 1 : 0))
  }, [parsed])

  const isMock = parsed?.provenance === 'mock'

  return (
    <div>
      <PageHeader
        title="Evaluation"
        desc="How well each way of checking calls did on a set of test recordings."
        right={
          parsed && (
            <Pill tone={isMock ? 'warn' : 'ok'}>
              {isMock ? 'Example numbers, not measured' : parsed.provenance ? 'Measured results' : 'Source unknown'}
            </Pill>
          )
        }
      />
      <div className="space-y-6">
        {isMock && (
          <p className="rounded-2xl border border-part/50 bg-part/10 px-4 py-3 text-[17px] leading-snug text-ink">
            These numbers come from pretend tools and a pretend AI on placeholder clips. They show the test setup works, not how good the detectors really are.
          </p>
        )}
        {parsed?.note && <p className="text-[17px] text-mute">{parsed.note}</p>}
        {loading && <p className="text-[17px] text-mute">Loading results…</p>}
        {err && !loading && (
          <Card title="No results yet">
            <p className="text-[17px] leading-snug text-mute">
              Run <code className="rounded-md bg-card2 px-1.5 py-0.5 text-ink">make eval</code> to create{' '}
              <code className="rounded-md bg-card2 px-1.5 py-0.5 text-ink">results/results.json</code>.
            </p>
            <div className="mt-4"><ErrorNote>{err}</ErrorNote></div>
          </Card>
        )}
        {parsed && parsed.rows.length === 0 && !loading && !err && (
          <Card title="No results yet">
            <p className="text-[17px] leading-snug text-mute">
              The results file is empty. Run <code className="rounded-md bg-card2 px-1.5 py-0.5 text-ink">make eval</code>.
            </p>
          </Card>
        )}
        {parsed && parsed.rows.length > 0 && (
          <Card title="Ways of checking, compared" desc="Each row is one way of checking a call, tried on the same test recordings.">
            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[420px] text-left text-[17px]">
                <thead className="bg-card2 text-[14px] font-semibold text-mute">
                  <tr>{cols.map((c) => <th key={c} className="px-4 py-3 font-semibold">{head(c)}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {parsed.rows.map((r, i) => (
                    <tr key={i}>
                      {cols.map((c) => (
                        <td key={c} className={`px-4 py-3 tabular-nums ${c === 'system' ? 'font-bold text-ink' : 'text-ink'}`}>{show(c, r[c])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Disclosure className="mt-4">
              <p className="text-[15px] text-mute">Results source: {parsed.provenance ?? 'unknown'}. Raw column names: {cols.join(', ')}.</p>
            </Disclosure>
          </Card>
        )}
      </div>
    </div>
  )
}
