import { useEffect, useMemo, useState } from 'react'
import { getEval } from '../api'
import { asObj } from '../lib/trace'
import { Card, ErrorNote, Pill } from '../components/ui'

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Evaluation</h1>
        {parsed && (
          <span
            className={`rounded-md px-3 py-1 text-sm font-bold uppercase tracking-wide ${
              isMock ? 'bg-amber-400 text-amber-950' : 'bg-ok-soft text-ok'
            }`}
          >
            Provenance: {parsed.provenance ?? 'unknown'}
          </span>
        )}
      </div>
      {isMock && (
        <p className="rounded-md border border-amber-300 bg-warn-soft px-3 py-2 text-sm text-amber-950">
          These numbers come from mocked tools and a mocked LLM on placeholder clips. They show the harness works. They are not measured detector performance.
        </p>
      )}
      {parsed?.note && <p className="text-sm text-slate-600">{parsed.note}</p>}
      {loading && <p className="text-sm text-slate-500">Loading results…</p>}
      {err && !loading && (
        <Card>
          <p className="text-sm text-slate-700">
            No evaluation results yet. Run <code className="rounded bg-slate-100 px-1">make eval</code> to generate{' '}
            <code className="rounded bg-slate-100 px-1">results/results.json</code>.
          </p>
          <div className="mt-3"><ErrorNote>{err}</ErrorNote></div>
        </Card>
      )}
      {parsed && parsed.rows.length === 0 && !loading && !err && (
        <Card><p className="text-sm text-slate-700">The results file is empty. Run <code className="rounded bg-slate-100 px-1">make eval</code>.</p></Card>
      )}
      {parsed && parsed.rows.length > 0 && (
        <Card title="Systems compared" right={<Pill tone="neutral">{parsed.rows.length} rows</Pill>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>{cols.map((c) => <th key={c} className="whitespace-nowrap py-1 pr-4 font-medium">{c.replace(/_/g, ' ')}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parsed.rows.map((r, i) => (
                  <tr key={i}>
                    {cols.map((c) => (
                      <td key={c} className={`py-2 pr-4 tabular-nums ${c === 'system' ? 'font-semibold' : ''}`}>{cell(r[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
