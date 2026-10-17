import type { Mode } from '../types'
import { Card } from './ui'

export const MODELS = [
  { value: 'claude-haiku-5-5', label: 'claude-haiku-5-5' },
  { value: 'claude-sonnet-5-5', label: 'claude-sonnet-5-5' },
  { value: 'gpt-4.1', label: 'gpt-4.1 (OpenAI-compatible)' },
]

export const DEFAULT_MODEL: Record<Mode, string> = {
  baseline: 'claude-haiku-5-5',
  fixed: 'claude-haiku-5-5',
  adaptive: 'claude-sonnet-5-5',
}

const MODES: { value: Mode; hint: string }[] = [
  { value: 'baseline', hint: 'No LLM' },
  { value: 'fixed', hint: 'Fixed pipeline' },
  { value: 'adaptive', hint: 'Agent picks tools' },
]

export function ModeSelector({ mode, model, onMode, onModel, disabled }: {
  mode: Mode
  model: string
  onMode: (m: Mode) => void
  onModel: (m: string) => void
  disabled: boolean
}) {
  return (
    <Card title="2. Mode">
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Analysis mode">
        {MODES.map((m) => (
          <button
            key={m.value}
            role="radio"
            aria-checked={mode === m.value}
            disabled={disabled}
            onClick={() => onMode(m.value)}
            className={`rounded-md border px-2 py-2 text-left transition disabled:opacity-50 ${
              mode === m.value ? 'border-accent bg-accent-soft' : 'border-slate-300 bg-white hover:bg-slate-50'
            }`}
          >
            <span className="block text-sm font-semibold capitalize">{m.value}</span>
            <span className="block text-xs text-slate-500">{m.hint}</span>
          </button>
        ))}
      </div>
      <label className="mt-3 block text-sm">
        <span className="mb-1 block text-slate-600">Model</span>
        <select
          value={model}
          disabled={disabled || mode === 'baseline'}
          onChange={(e) => onModel(e.target.value)}
          className="min-h-10 w-full rounded-md border border-slate-300 bg-white px-2 py-2 disabled:bg-slate-100 disabled:text-slate-400"
        >
          {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </label>
    </Card>
  )
}
