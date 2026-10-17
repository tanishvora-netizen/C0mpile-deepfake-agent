import type { TraceEvent } from '../types'

type Obj = Record<string, unknown>

export const asObj = (v: unknown): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {}

const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function fmt(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined ? '—' : v.toFixed(digits)
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

export function compact(v: unknown, n = 140): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return truncate(v, n)
  try {
    return truncate(JSON.stringify(v), n)
  } catch {
    return String(v)
  }
}

export interface TraceRow {
  seq: number
  kind: TraceEvent['kind']
  tool: string
  detector?: string
  args: string
  result: string
  ms: number | null
  failed: boolean
}

function shortResult(tool: string, rec: Obj): string {
  const values = asObj(rec.values)
  if (rec.status === 'failed' || rec.status === 'invalid_input') {
    return `${String(rec.status)}${rec.error ? ': ' + String(rec.error) : ''}`
  }
  const scores = asArr(values.scores)
  if (scores.length) {
    const parts = scores.map((s) => {
      const o = asObj(s)
      return `${String(o.speaker ?? '#' + String(o.idx ?? '?'))} ${fmt(num(o.p_fake))}`
    })
    const clip = num(values.clip_p_fake)
    return parts.join(' · ') + (clip !== null ? ` · clip ${fmt(clip)}` : '')
  }
  const turns = asArr(values.turns)
  if (tool === 'get_context' && turns.length) {
    return `${turns.length} turns, ${new Set(turns.map((t) => asObj(t).speaker)).size} speakers`
  }
  const cps = asArr(values.change_points)
  if (tool === 'find_boundaries') {
    if (!cps.length) return 'no change points'
    return cps
      .map((c) => `${fmt(num(asObj(c).t), 1)}s moved ${String(asObj(c).moved ?? '?')}`)
      .join(' · ')
  }
  const p = num(values.p_fake)
  if (p !== null) return `p_fake ${fmt(p)}`
  return compact(values, 120)
}

/** One row per trace event; results inherit the args of the call that preceded them. */
export function buildRows(events: TraceEvent[]): TraceRow[] {
  const pending = new Map<string, Obj[]>()
  const rows: TraceRow[] = []
  for (const e of events) {
    const p = asObj(e.payload)
    const tool = String(p.tool ?? p.name ?? '')
    if (e.kind === 'tool_call') {
      const args = asObj(p.args ?? p.arguments ?? p.input ?? p.params)
      const q = pending.get(tool) ?? []
      q.push(args)
      pending.set(tool, q)
      rows.push({
        seq: e.seq, kind: e.kind, tool,
        detector: typeof args.detector === 'string' ? args.detector : undefined,
        args: compact(Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'clip_id')), 160),
        result: '', ms: null, failed: false,
      })
    } else if (e.kind === 'tool_result') {
      const rec = asObj(p.record ?? p)
      const callArgs = pending.get(tool)?.shift() ?? {}
      const params = asObj(rec.params)
      const detector = String(params.detector ?? callArgs.detector ?? '') || undefined
      const failed = rec.status === 'failed' || rec.status === 'invalid_input'
      rows.push({
        seq: e.seq, kind: e.kind, tool, detector, args: '',
        result: shortResult(tool, rec),
        ms: num(rec.runtime_ms ?? p.runtime_ms), failed,
      })
    } else if (e.kind === 'llm') {
      rows.push({
        seq: e.seq, kind: e.kind, tool: String(p.model ?? 'llm'), args: '',
        result: compact(p.text ?? p.content ?? p, 220), ms: num(p.latency_ms), failed: false,
      })
    } else if (e.kind === 'final') {
      const segs = asArr(p.segments)
      rows.push({
        seq: e.seq, kind: e.kind, tool: 'final', args: '',
        result: p.abstain ? `abstain: ${String(p.abstain)}` : `${segs.length} segments, composition ${String(p.composition ?? 'none')}`,
        ms: null, failed: Boolean(p.abstain),
      })
    } else {
      rows.push({
        seq: e.seq, kind: e.kind, tool: 'error', args: '',
        result: compact(p.message ?? p.error ?? p, 220), ms: null, failed: true,
      })
    }
  }
  return rows
}

/** Detector A's whole-clip clip_p_fake from the score_turns A tool_result, if present. */
export function detectorAClipScore(events: TraceEvent[]): number | null {
  const pendingArgs: Obj[] = []
  for (const e of events) {
    const p = asObj(e.payload)
    const tool = String(p.tool ?? p.name ?? '')
    if (tool !== 'score_turns') continue
    if (e.kind === 'tool_call') {
      pendingArgs.push(asObj(p.args ?? p.arguments ?? p.input ?? p.params))
    } else if (e.kind === 'tool_result') {
      const rec = asObj(p.record ?? p)
      const callArgs = pendingArgs.shift() ?? {}
      const detector = String(asObj(rec.params).detector ?? callArgs.detector ?? '')
      if (detector === 'A') {
        const v = num(asObj(rec.values).clip_p_fake)
        if (v !== null) return v
      }
    }
  }
  return null
}
