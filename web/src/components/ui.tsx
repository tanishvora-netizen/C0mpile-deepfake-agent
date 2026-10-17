import type { ReactNode } from 'react'
import type { Label } from '../types'
import { VERDICT, type Tone } from '../home/lib'

/* Shared look for the Analyst view. Same tokens as the home page (see index.css). */

export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
export const btnPrimary = `inline-flex items-center justify-center gap-2 rounded-full bg-accent px-7 py-3 text-[17px] font-bold text-accent-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`
export const btnSecondary = `inline-flex items-center justify-center gap-2 rounded-full border border-line bg-card2 px-6 py-3 text-[17px] font-semibold text-ink transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`
export const btnDanger = `inline-flex items-center justify-center gap-2 rounded-full bg-ai px-7 py-3 text-[17px] font-bold text-bg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`
export const inputCls = `min-h-12 w-full rounded-2xl border border-line bg-card2 px-4 py-3 text-[17px] text-ink placeholder:text-mute disabled:opacity-50 focus:border-accent ${focusRing}`

/** Page title with a one-line description. */
export function PageHeader({ title, desc, right }: { title: string; desc?: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[34px] font-black leading-[1.05] tracking-tight text-ink sm:text-[44px]">{title}</h1>
        {desc && <p className="mt-2 max-w-2xl text-[18px] leading-snug text-mute">{desc}</p>}
      </div>
      {right}
    </div>
  )
}

export function Card({ title, desc, right, children, className = '' }: {
  title?: string
  desc?: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`min-w-0 rounded-3xl border border-line bg-card p-5 sm:p-6 ${className}`}>
      {(title || right) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title && <h2 className="text-[24px] font-extrabold leading-tight tracking-tight text-ink">{title}</h2>}
            {desc && <p className="mt-1 text-[16px] leading-snug text-mute">{desc}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

/** Technical detail tucked away by default. */
export function Disclosure({ label = 'Show details', openLabel = 'Hide details', children, className = '' }: {
  label?: string
  openLabel?: string
  children: ReactNode
  className?: string
}) {
  return (
    <details className={`group ${className}`}>
      <summary className={`inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-line bg-card2 px-4 py-2 text-[15px] font-semibold text-mute transition hover:border-accent hover:text-accent [&::-webkit-details-marker]:hidden ${focusRing}`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
        <span className="group-open:hidden">{label}</span>
        <span className="hidden group-open:inline">{openLabel}</span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  )
}

/** Same wording and colours as the home page results. */
export const LABEL_TEXT: Record<Label, string> = {
  synthetic: VERDICT.synthetic.headline,
  bona_fide: VERDICT.bona_fide.headline,
  uncertain: VERDICT.uncertain.headline,
}
/** Solid fills (timeline bars). */
export const LABEL_SOLID: Record<Label, string> = {
  synthetic: 'bg-ai text-bg',
  bona_fide: 'bg-human text-bg',
  uncertain: 'bg-unsure text-bg',
}
const LABEL_SOFT: Record<Label, string> = {
  synthetic: 'border-ai/40 bg-ai/15 text-ai',
  bona_fide: 'border-human/40 bg-human/15 text-human',
  uncertain: 'border-line bg-card2 text-mute',
}
export const LABEL_DOT: Record<Label, string> = { synthetic: 'bg-ai', bona_fide: 'bg-human', uncertain: 'bg-unsure' }

export function LabelBadge({ label }: { label: Label }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[14px] font-bold sm:px-3 sm:text-[15px] ${LABEL_SOFT[label]}`}>
      {LABEL_TEXT[label]}
    </span>
  )
}

export const TONE_TEXT: Record<Tone, string> = { danger: 'text-ai', ok: 'text-human', warn: 'text-part', neutral: 'text-unsure' }
export const TONE_CARD: Record<Tone, string> = {
  danger: 'border-ai/40 bg-ai/10',
  ok: 'border-human/40 bg-human/10',
  warn: 'border-part/50 bg-part/10',
  neutral: 'border-line bg-card2',
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'critical' | 'neutral' | 'accent'; children: ReactNode }) {
  const t = {
    ok: 'border-human/40 bg-human/15 text-human',
    warn: 'border-part/50 bg-part/15 text-part',
    critical: 'border-ai/40 bg-ai/15 text-ai',
    neutral: 'border-line bg-card2 text-mute',
    accent: 'border-accent/40 bg-accent/15 text-accent',
  }[tone]
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-[15px] font-semibold ${t}`}>{children}</span>
}

export function Button({ children, variant = 'primary', ...rest }: {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'danger'
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const v = { primary: btnPrimary, secondary: btnSecondary, danger: btnDanger }[variant]
  return (
    <button {...rest} className={`${v} ${rest.className ?? ''}`}>
      {children}
    </button>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[16px] font-semibold text-mute">{label}</span>
      {children}
    </label>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-2xl border border-ai/40 bg-ai/10 px-4 py-3 text-[16px] text-ink">
      {children}
    </p>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[17px] leading-snug text-mute">{children}</p>
}
