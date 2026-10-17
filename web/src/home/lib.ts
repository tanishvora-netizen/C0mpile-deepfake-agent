// Plain-English helpers for the CallGuard home page.
import type { CallSource, Label, Segment, TraceEvent, TranscriptLine } from '../types'
import { asObj, num } from '../lib/trace'

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger'

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
export const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)
export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// ---------- verdict wording ----------
export const VERDICT: Record<Label, { headline: string; tone: Tone }> = {
  synthetic: { headline: 'AI-generated voice', tone: 'danger' },
  bona_fide: { headline: 'Real person', tone: 'ok' },
  uncertain: { headline: 'Not sure', tone: 'warn' },
}

export function overallVerdict(segments: Segment[]): { tone: Tone; text: string; sub?: string } {
  const n = segments.length
  const ai = segments.filter((s) => s.label === 'synthetic').length
  const unsure = segments.filter((s) => s.label === 'uncertain').length
  if (n === 0) return { tone: 'warn', text: "CallGuard couldn't reach a verdict on this call." }
  if (ai > 0) {
    return {
      tone: 'danger',
      text: n === 1 ? 'The voice on this call is AI-generated.' : `${ai} of ${n} voices on this call ${ai === 1 ? 'is' : 'are'} AI-generated.`,
      sub: unsure > 0 ? `${unsure} ${unsure === 1 ? 'voice' : 'voices'} could not be judged.` : undefined,
    }
  }
  if (unsure > 0) {
    return { tone: 'warn', text: `Not sure about ${unsure} of ${n} ${n === 1 ? 'voice' : 'voices'} on this call.`, sub: 'No voice was flagged as AI-generated.' }
  }
  return {
    tone: 'ok',
    text: 'No AI-generated voices found.',
    sub: n === 1 ? 'The voice on this call sounds like a real person.' : `All ${n} voices sound like real people.`,
  }
}

// ---------- per-voice details ----------
/** "Voice 1", "Voice 2", … by order of first appearance of each speaker. */
export function voiceNames(segments: Segment[]): string[] {
  const order: string[] = []
  return segments.map((s, i) => {
    const key = s.speaker ?? `#${i}`
    let at = order.indexOf(key)
    if (at < 0) {
      order.push(key)
      at = order.length - 1
    }
    return `Voice ${at + 1}`
  })
}

const overlap = (a0: number, a1: number, b0: number, b1: number): number => Math.min(a1, b1) - Math.max(a0, b0)

/** The uploaded file that mostly covers this segment's time range. */
export function sourceFor(seg: Segment, sources: CallSource[]): CallSource | null {
  let best: CallSource | null = null
  let bestOv = 0
  for (const src of sources) {
    const ov = overlap(seg.start, seg.end, src.start, src.end)
    if (ov > bestOv) {
      bestOv = ov
      best = src
    }
  }
  return best
}

/** Each transcript line goes under the one voice card it overlaps the most. */
export function linesFor(segIdx: number, segments: Segment[], lines: TranscriptLine[] | null): TranscriptLine[] {
  if (!lines || !lines.length) return []
  return lines.filter((l) => {
    let best = -1
    let bestOv = -Infinity
    segments.forEach((s, i) => {
      const ov = overlap(l.start, l.end, s.start, s.end)
      if (ov > bestOv) {
        bestOv = ov
        best = i
      }
    })
    return best === segIdx
  })
}

export interface DetectorScores { A: number | null; B: number | null }

/** The two detector scores out of segment.evidence ("(A)" / "(B)" fields). */
export function detectorScores(seg: Segment): DetectorScores {
  const out: DetectorScores = { A: null, B: null }
  for (const ev of seg.evidence ?? []) {
    if (ev.tool !== 'score_turns' || typeof ev.value !== 'number') continue
    const f = ev.field
    if (out.A === null && /\(A\)|_A$|^A$|detector[\s_]?A\b/i.test(f)) out.A = ev.value
    else if (out.B === null && /\(B\)|_B$|^B$|detector[\s_]?B\b/i.test(f)) out.B = ev.value
  }
  return out
}

export const detectorsDisagree = (d: DetectorScores): boolean =>
  d.A !== null && d.B !== null && (d.A >= 0.5) !== (d.B >= 0.5)

/** Result of the closer look (rescore) CallGuard took on this voice, if any. */
export function closerLook(seg: Segment): number | null {
  const ev = (seg.evidence ?? []).find((e) => e.tool === 'rescore_region' && typeof e.value === 'number')
  return ev ? (ev.value as number) : null
}

// ---------- live progress, one plain-English line per step ----------
export interface ProgressLine { id: string; text: string; tone: Tone }

interface TurnScore { idx: number; p: number }
const turnScores = (values: Record<string, unknown>): TurnScore[] =>
  (Array.isArray(values.scores) ? values.scores : Array.isArray(values.turns) ? values.turns : []).map((t, i) => {
    const o = asObj(t)
    return { idx: num(o.idx) ?? i, p: num(o.p_fake) ?? 0 }
  })

export function buildProgress(events: TraceEvent[]): ProgressLine[] {
  const out: ProgressLine[] = []
  const seen: Record<string, TurnScore[]> = {}
  const reported = new Set<number>()
  for (const e of events) {
    const p = asObj(e.payload)
    const tool = String(p.tool ?? p.name ?? '')
    if (e.kind === 'tool_call') {
      const args = asObj(p.args ?? p.arguments ?? p.input ?? p.params)
      const det = typeof args.detector === 'string' ? args.detector : ''
      const id = `c${e.seq}`
      if (tool === 'get_context') out.push({ id, tone: 'neutral', text: 'Finding where each voice starts and stops' })
      else if (tool === 'score_turns') out.push({ id, tone: 'neutral', text: `Detector ${det || '?'} is listening to every voice…` })
      else if (tool === 'find_boundaries') out.push({ id, tone: 'neutral', text: 'Checking exactly where the voice changes' })
      else if (tool === 'rescore_region') {
        const s = num(args.start)
        const en = num(args.end)
        out.push({
          id, tone: 'neutral',
          text: s !== null && en !== null ? `Taking a closer look at ${mmss(s)}–${mmss(en)}${det ? ` with detector ${det}` : ''}…` : 'Taking a closer look at one voice…',
        })
      } else if (tool) out.push({ id, tone: 'neutral', text: 'Running an extra check…' })
    } else if (e.kind === 'tool_result') {
      const rec = asObj(p.record ?? p)
      if (rec.status === 'failed' || rec.status === 'invalid_input') {
        out.push({ id: `f${e.seq}`, tone: 'warn', text: "One check couldn't run — carrying on with the others" })
        continue
      }
      if (tool !== 'score_turns') continue
      const values = asObj(rec.values)
      const det = String(asObj(rec.params).detector ?? values.detector ?? '')
      const turns = turnScores(values)
      if (!det || !turns.length) continue
      seen[det] = turns
      const dets = Object.keys(seen)
      if (dets.length < 2) continue
      const [a, b] = [seen[dets[0]], seen[dets[1]]]
      for (const x of a) {
        const y = b.find((z) => z.idx === x.idx)
        if (y && !reported.has(x.idx) && (Math.abs(x.p - y.p) > 0.3 || x.p >= 0.5 !== y.p >= 0.5)) {
          reported.add(x.idx)
          out.push({ id: `d${e.seq}-${x.idx}`, tone: 'warn', text: `The detectors disagree on voice ${x.idx + 1} — taking a closer look` })
        }
      }
    }
  }
  return out
}
