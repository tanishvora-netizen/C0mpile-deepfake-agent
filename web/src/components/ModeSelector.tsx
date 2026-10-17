import type { Mode } from '../types'
import { Card, focusRing, inputCls } from './ui'

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

const MODES: { value: Mode; title: string; hint: string }[] = [
  { value: 'baseline', title: 'Baseline', hint: 'No AI agent' },
  { value: 'fixed', title: 'Fixed', hint: 'Same steps every time' },
  { value: 'adaptive', title: 'Adaptive', hint: 'Agent picks its checks' },
]

export function ModeSelector({ mode, model, onMode, onModel, disabled }: {
  mode: Mode
  model: string
  onMode: (m: Mode) => void
  onModel: (m: string) => void
  disabled: boolean
}) {
  return (
    <Card title="2. Choose how to check" desc="Adaptive is the full CallGuard agent; the others are for comparison.">
      <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-3" role="radiogroup" aria-label="Analysis mode">
        {MODES.map((m) => {
          const on = mode === m.value
          return (
            <button
              key={m.value}
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onMode(m.value)}
              className={`rounded-2xl border px-3 py-3 text-left transition disabled:opacity-50 ${focusRing} ${
                on ? 'border-accent bg-accent/10' : 'border-line bg-card2 hover:border-accent/60'
              }`}
            >
              <span className={`block text-[17px] font-extrabold ${on ? 'text-accent' : 'text-ink'}`}>{m.title}</span>
              <span className="block text-[15px] leading-snug text-mute">{m.hint}</span>
            </button>
          )
        })}
      </div>
      <label className="mt-4 block">
        <span className="mb-1.5 block text-[16px] font-semibold text-mute">AI model</span>
        <select
          value={model}
          disabled={disabled || mode === 'baseline'}
          onChange={(e) => onModel(e.target.value)}
          className={inputCls}
        >
          {MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </label>
    </Card>
  )
}
