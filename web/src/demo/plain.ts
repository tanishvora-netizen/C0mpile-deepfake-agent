// Plain-English views of the raw trace / case data, for the demo page.
import type { CaseEvent, Label, TraceEvent, TranscriptLine } from '../types'
import { asObj, num } from '../lib/trace'
import type { IconName } from './Icons'

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger'

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export const pct = (p: number): string => `${Math.round(p * 100)}%`
export const mmss = (t: number): string => {
  const s = Math.max(0, Math.round(t))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
export const usd = (n: number): string =>
  n.toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  })
const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)
const humanize = (s: string): string => cap(s.replace(/_/g, ' '))

// ---------- names of the voices ----------
const GENERIC_SPEAKER = /^(s|spk|speaker|voice|turn)[\s_-]*\d+$/i

/** Best display name for the voice speaking in [start,end], using the transcript. */
export function voiceName(start: number, end: number, lines: TranscriptLine[] | null, idx: number): string {
  const fallback = `Speaker ${idx + 1}`
  if (!lines || !lines.length) return fallback
  let best: TranscriptLine | null = null
  let bestOv = 0
  for (const l of lines) {
    const ov = Math.min(end, l.end) - Math.max(start, l.start)
    if (ov > bestOv) {
      bestOv = ov
      best = l
    }
  }
  if (!best) return fallback
  const who = best.who ?? ''
  const q = /['"“]([^'"”]+)['"”]/.exec(who) ?? /they'?re\s+([A-Za-z]+)/i.exec(who)
  if (q) return cap(q[1])
  const sp = (best.speaker ?? '').replace(/["'“”]/g, '').trim()
  if (sp && !GENERIC_SPEAKER.test(sp)) return cap(sp)
  if (/attorney|lawyer/i.test(best.text)) return 'Lawyer'
  const m = /\b(?:it'?s|this is)\s+([A-Z][a-z]+)/.exec(best.text)
  return m ? m[1] : fallback
}

// ---------- step 2: plain-English trace rows ----------
export interface PlainRow {
  id: string
  icon: IconName
  text: string
  sub?: string
  tone: Tone
}

interface TurnScore { idx: number; p: number }

export function buildPlainRows(events: TraceEvent[]): { rows: PlainRow[]; llmSteps: number } {
  const rows: PlainRow[] = []
  const seen: Record<string, TurnScore[]> = {}
  let llmSteps = 0
  for (const e of events) {
    if (e.kind === 'llm') {
      llmSteps++
      continue
    }
    if (e.kind !== 'tool_result') continue
    const p = asObj(e.payload)
    const tool = String(p.tool ?? p.name ?? '')
    const rec = asObj(p.record ?? p)
    const values = asObj(rec.values)
    const params = asObj(rec.params)
    const id = `r${e.seq}`
    if (rec.status === 'failed' || rec.status === 'invalid_input') {
      rows.push({ id, icon: 'alert', text: `One check could not run (${humanize(tool).toLowerCase()})`, tone: 'neutral' })
      continue
    }
    if (tool === 'get_context') {
      const turns = arr(values.turns).map(asObj)
      const n = new Set(turns.map((t) => String(t.speaker ?? t.idx))).size
      rows.push({
        id, icon: 'users', tone: 'neutral',
        text: n ? `Split the call into ${n} speaker${n === 1 ? '' : 's'}` : 'Listened to the call audio',
      })
    } else if (tool === 'score_turns') {
      const det = String(params.detector ?? values.detector ?? '?')
      const turns: TurnScore[] = arr(values.turns ?? values.scores).map((t, i) => {
        const o = asObj(t)
        return { idx: num(o.idx) ?? i, p: num(o.p_fake) ?? 0 }
      })
      if (!turns.length) continue
      const top = turns.reduce((a, b) => (b.p > a.p ? b : a))
      const others = turns.filter((t) => t !== top).map((t) => `speaker ${t.idx + 1}: ${pct(t.p)}`)
      rows.push({
        id, icon: 'bars', tone: top.p >= 0.5 ? 'danger' : 'neutral',
        text: `Detector ${det}: ${pct(top.p)} likely AI on speaker ${top.idx + 1}`,
        sub: others.length ? others.join(' · ') : undefined,
      })
      seen[det] = turns
      const dets = Object.keys(seen)
      if (dets.length >= 2 && dets[dets.length - 1] === det) {
        const [a, b] = [seen[dets[0]], seen[det]]
        const diff = a.find((x) => {
          const y = b.find((z) => z.idx === x.idx)
          return y && Math.abs(x.p - y.p) > 0.3
        })
        if (diff) {
          rows.push({
            id: id + 'd', icon: 'alert', tone: 'warn',
            text: 'The two detectors disagree — looking closer',
          })
        }
      }
    } else if (tool === 'find_boundaries') {
      const times = [...new Set(arr(values.change_points).map((c) => num(asObj(c).t)).filter((t): t is number => t !== null))].sort((x, y) => x - y)
      rows.push({
        id, icon: 'wave', tone: 'neutral',
        text: times.length ? `The voice changes at ${times.map(mmss).join(' and ')}` : 'No sudden change of voice found',
      })
    } else if (tool === 'rescore_region') {
      const pf = num(values.p_fake)
      const s = num(values.start ?? params.start) ?? 0
      const en = num(values.end ?? params.end) ?? 0
      const ctx = num(values.context_s ?? params.context_s)
      rows.push({
        id, icon: 'search', tone: pf !== null && pf >= 0.5 ? 'danger' : 'neutral',
        text: `Closer look at ${mmss(s)}–${mmss(en)}: ${pf !== null ? pct(pf) : '?'} likely AI`,
        sub: `Detector ${String(params.detector ?? values.detector ?? '')}${ctx ? `, using ${ctx} seconds of surrounding audio` : ''}`.replace('Detector ,', ''),
      })
    } else {
      rows.push({ id, icon: 'search', tone: 'neutral', text: `Extra check: ${humanize(tool).toLowerCase()}` })
    }
  }
  return { rows, llmSteps }
}

// ---------- step 2: verdict ----------
export interface VerdictRow {
  start: number
  end: number
  name: string
  label: Label
  score: number | null
}

export function buildVerdict(final: Record<string, unknown>, lines: TranscriptLine[] | null): VerdictRow[] {
  return arr(final.segments).map((s, i) => {
    const o = asObj(s)
    const start = num(o.start) ?? 0
    const end = num(o.end) ?? 0
    return {
      start, end,
      name: voiceName(start, end, lines, i),
      label: (o.label as Label) ?? 'uncertain',
      score: num(o.tool_score),
    }
  })
}

// ---------- step 4: case timeline ----------
export interface TimelineItem {
  seq: number
  icon: IconName
  text: string
  sub?: string
  tone: Tone
}

export function buildTimeline(events: CaseEvent[]): TimelineItem[] {
  const out: TimelineItem[] = []
  let trusted = 'Trusted contact'
  for (const e of events) {
    const p = asObj(e.payload)
    const who = (id: unknown) => (typeof id === 'string' && id ? cap(id) : 'Contact')
    const seq = e.seq
    switch (e.type) {
      case 'clip_ingested': {
        const d = num(p.duration_s)
        out.push({ seq, icon: 'phone', tone: 'neutral', text: `Call recorded${d ? ` (${Math.round(d)} seconds)` : ''}` })
        break
      }
      case 'analysis_done': {
        const synth = arr(p.segments).filter((s) => asObj(s).label === 'synthetic').length
        out.push(synth
          ? { seq, icon: 'shieldCheck', tone: 'danger', text: 'Call analyzed — cloned voice found' }
          : { seq, icon: 'shieldCheck', tone: 'ok', text: 'Call analyzed — no cloned voice found' })
        break
      }
      case 'action': {
        if (p.type === 'hold_new_payee') {
          out.push({ seq, icon: 'shield', tone: 'neutral', text: 'New payees put on hold until the caller is verified' })
        } else if (p.type === 'notify_trusted_contact') {
          trusted = who(p.target)
          out.push({ seq, icon: 'bell', tone: 'neutral', text: `Trusted contact (${trusted}) alerted` })
        }
        break
      }
      case 'verification': {
        const name = who(p.contact_id)
        const o = String(p.outcome ?? '')
        if (o === 'VERIFYING') out.push({ seq, icon: 'message', tone: 'neutral', text: `Text sent to ${name}'s saved number` })
        else if (o === 'CONTRADICTED') out.push({ seq, icon: 'x', tone: 'danger', text: `${name} replied NO — it wasn't them` })
        else if (o === 'VERIFIED') out.push({ seq, icon: 'check', tone: 'ok', text: `${name} replied YES — it was them` })
        else if (o === 'UNREACHABLE') out.push({ seq, icon: 'clock', tone: 'warn', text: `${name} did not reply in time` })
        break
      }
      case 'transfer_held': {
        const amt = num(p.amount)
        out.push({ seq, icon: 'bank', tone: 'warn', text: `Transfer${amt ? ` of ${usd(amt)}` : ''} held` })
        break
      }
      case 'transfer_declined':
        out.push({ seq, icon: 'shieldCheck', tone: 'ok', text: `${trusted} declined — no money left the account` })
        break
      case 'transfer_released':
      case 'transfer_approved':
        out.push({ seq, icon: 'bank', tone: 'warn', text: `${trusted} approved — transfer released` })
        break
      case 'notification':
        break
      default:
        out.push({ seq, icon: 'file', tone: 'neutral', text: humanize(e.type) })
    }
  }
  return out
}
