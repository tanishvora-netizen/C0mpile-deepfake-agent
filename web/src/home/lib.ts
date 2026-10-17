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
  uncertain: { headline: "Couldn't tell", tone: 'neutral' },
}

// ---------- voices: one card per source file / speaker ----------
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

export type VoiceKind = 'ai' | 'human' | 'part' | 'unsure'

export interface Detectors { A: number | null; B: number | null; C: number | null }

export interface Voice {
  name: string
  /** indexes into result.segments */
  idx: number[]
  segments: Segment[]
  start: number
  end: number
  source: CallSource | null
  kind: VoiceKind
  headline: string
  tone: Tone
  /** Merged time ranges where the AI was found. */
  aiRanges: [number, number][]
  detectors: Detectors | null
}

/** Time as m:ss, rounded down (for the start of a range). */
const tFloor = (t: number): string => mmss(Math.floor(Math.max(0, t)))
/** Time as m:ss, rounded up (for the end of a range). */
const tCeil = (t: number): string => mmss(Math.ceil(Math.max(0, t)))
export const rangeText = (r: [number, number]): string => `${tFloor(r[0])}–${tCeil(r[1])}`
export const aiAtText = (ranges: [number, number][]): string => `AI at ${ranges.map(rangeText).join(', ')}`

const DET_FIELD = /\(([ABC])\)\s*$/
const DET_TOOLS = new Set(['score_turns', 'score_windows'])

/** Detector A/B/C scores for one segment, read from its evidence. */
export function detectorScores(seg: Segment): Detectors {
  const out: Detectors = { A: null, B: null, C: null }
  for (const ev of seg.evidence ?? []) {
    if (!DET_TOOLS.has(ev.tool) || typeof ev.value !== 'number') continue
    const m = DET_FIELD.exec(ev.field)
    if (!m) continue
    const k = m[1] as 'A' | 'B' | 'C'
    if (out[k] === null) out[k] = ev.value
  }
  return out
}

const minScore = (d: Detectors): number => {
  const v = [d.A, d.B, d.C].filter((x): x is number => x !== null)
  return v.length ? Math.min(...v) : -1
}

/** Scores of the voice's segment with the highest min score (null when no detector reported). */
function bestDetectors(segs: Segment[]): Detectors | null {
  let best: Detectors | null = null
  let bestMin = -1
  for (const s of segs) {
    const d = detectorScores(s)
    const m = minScore(d)
    if (m > bestMin) {
      bestMin = m
      best = d
    }
  }
  return best
}

function mergeRanges(segs: Segment[]): [number, number][] {
  const ai = segs.filter((s) => s.label === 'synthetic').sort((a, b) => a.start - b.start)
  const out: [number, number][] = []
  for (const s of ai) {
    const last = out[out.length - 1]
    if (last && s.start - last[1] <= 0.25) last[1] = Math.max(last[1], s.end)
    else out.push([s.start, s.end])
  }
  return out
}

/**
 * Groups segments per voice: by source file when we know the files, otherwise by speaker.
 * A voice that has any AI segment is never called a real person.
 */
export function groupVoices(segments: Segment[], sources: CallSource[]): Voice[] {
  const keys: string[] = []
  const groups = new Map<string, number[]>()
  segments.forEach((s, i) => {
    const src = sourceFor(s, sources)
    const key = src ? `src:${src.name}:${src.start}` : s.speaker ? `spk:${s.speaker}` : `#${i}`
    if (!groups.has(key)) {
      groups.set(key, [])
      keys.push(key)
    }
    groups.get(key)?.push(i)
  })
  return keys.map((key, n) => {
    const idx = groups.get(key) ?? []
    const segs = idx.map((i) => segments[i])
    const ai = segs.some((s) => s.label === 'synthetic')
    const human = segs.some((s) => s.label === 'bona_fide')
    const allAi = segs.every((s) => s.label === 'synthetic')
    let kind: VoiceKind
    let headline: string
    let tone: Tone
    if (allAi) {
      kind = 'ai'; headline = 'AI-generated voice'; tone = 'danger'
    } else if (ai) {
      kind = 'part'; headline = human ? 'Part human, part AI' : 'Part AI, part unclear'; tone = 'warn'
    } else if (human && !segs.some((s) => s.label === 'uncertain')) {
      kind = 'human'; headline = 'Real person'; tone = 'ok'
    } else {
      kind = 'unsure'; headline = "Couldn't tell — try a longer recording"; tone = 'neutral'
    }
    return {
      name: `Voice ${n + 1}`, idx, segments: segs,
      start: Math.min(...segs.map((s) => s.start)), end: Math.max(...segs.map((s) => s.end)),
      source: sourceFor(segs[0], sources), kind, headline, tone,
      aiRanges: mergeRanges(segs), detectors: bestDetectors(segs),
    }
  })
}

export function overallVerdict(segments: Segment[], voices: Voice[]): { tone: Tone; text: string; sub?: string } {
  const n = voices.length
  if (segments.length === 0 || n === 0) return { tone: 'neutral', text: "CallGuard couldn't reach a verdict on this call." }
  const nAi = voices.filter((v) => v.kind === 'ai').length
  const nPart = voices.filter((v) => v.kind === 'part').length
  const nUnsure = voices.filter((v) => v.kind === 'unsure').length
  if (segments.some((s) => s.label === 'synthetic')) {
    const bits: string[] = []
    if (nAi) bits.push(n === 1 ? 'The voice is AI' : `${nAi} of ${n} voices ${nAi === 1 ? 'is' : 'are'} AI`)
    if (nPart) bits.push(n === 1 ? 'the voice is part AI' : `${nPart} ${nPart === 1 ? 'is' : 'are'} part AI`)
    const sub = bits.join(', ')
    return { tone: 'danger', text: 'This call contains AI-generated speech', sub: sub[0].toUpperCase() + sub.slice(1) }
  }
  return {
    tone: 'ok',
    text: 'No AI-generated speech found',
    sub: nUnsure > 0
      ? `Couldn't tell for ${nUnsure} of ${n} ${n === 1 ? 'voice' : 'voices'}.`
      : n === 1 ? 'The voice sounds like a real person.' : `All ${n} voices sound like real people.`,
  }
}

/** Each transcript line goes under the one voice whose segments it overlaps the most. */
export function linesForVoice(voiceIdx: number, voices: Voice[], lines: TranscriptLine[] | null): TranscriptLine[] {
  if (!lines || !lines.length) return []
  return lines.filter((l) => {
    let best = -1
    let bestOv = -Infinity
    voices.forEach((v, i) => {
      const ov = v.segments.reduce((m, s) => m + Math.max(0, overlap(l.start, l.end, s.start, s.end)), 0)
      if (ov > bestOv) {
        bestOv = ov
        best = i
      }
    })
    return best === voiceIdx
  })
}

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
