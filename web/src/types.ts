// Mirrors contracts/models.py. Keep in sync by hand.
export type Label = 'bona_fide' | 'synthetic' | 'uncertain'
export type Mode = 'baseline' | 'fixed' | 'adaptive'

export interface ClipMeta {
  clip_id: string
  duration_s: number
  orig_sr: number
  paths: Record<string, string>
  parent_clip_id?: string | null
}

export interface GoldenClip {
  name: string
  clip_id: string
  title?: string
  description?: string
  duration_s?: number
}

export interface TranscriptLine {
  start: number
  end: number
  speaker: string
  who?: string
  text: string
}

export interface Evidence {
  tool: string
  field: string
  value: number | string | boolean
}

export interface Segment {
  start: number
  end: number
  speaker: string | null
  label: Label
  tool_score: number | null
  evidence: Evidence[]
}

export interface AnalysisResult {
  clip_id: string
  system: Mode
  model: string | null
  segments: Segment[]
  mixed: boolean
  composition: 'none' | 'speaker_handoff' | 'splice' | 'overlay'
  abstain?: string | null
  summary: string
  trace_id: string
  usage: Record<string, number | string>
}

export interface TraceEvent {
  trace_id: string
  seq: number
  kind: 'tool_call' | 'tool_result' | 'llm' | 'final' | 'error'
  payload: Record<string, unknown>
}

export interface Action {
  type: 'verify_contact' | 'hold_new_payee' | 'notify_trusted_contact'
  case_id: string
  target: string | null
  reason: string
}

export interface CaseEvent {
  case_id: string
  seq: number
  ts: string
  type: string
  payload: Record<string, unknown>
  prev_hash: string
  hash: string
}

export type CaseState = 'OPEN' | 'VERIFYING' | 'VERIFIED' | 'CONTRADICTED' | 'UNREACHABLE'
export type TransferState = 'PENDING' | 'HELD' | 'RELEASED' | 'DECLINED'

export interface ChainStatus {
  ok: boolean
  bad_seq: number | null
}

export interface CaseView {
  case_id: string
  state: CaseState
  events: CaseEvent[]
  actions: Action[]
  chain: ChainStatus | null
}

export interface Packet {
  summary: string
  sar_draft: string
  chain: ChainStatus | null
}

export interface Transfer {
  id: string
  state: TransferState
  amount: number
  payee: string
  reason?: string | null
  token?: string
}
