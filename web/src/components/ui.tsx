import type { ReactNode } from 'react'
import type { Label } from '../types'

export function Card({ title, right, children, className = '' }: {
  title?: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {title && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
          <h2 className="text-sm font-semibold tracking-tight text-slate-800">{title}</h2>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

const LABEL_STYLE: Record<Label, string> = {
  synthetic: 'bg-critical text-white',
  uncertain: 'bg-amber-400 text-amber-950',
  bona_fide: 'bg-slate-200 text-slate-700',
}

export function LabelBadge({ label }: { label: Label }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${LABEL_STYLE[label]}`}>
      {label.replace('_', ' ')}
    </span>
  )
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'critical' | 'neutral' | 'accent'; children: ReactNode }) {
  const t = {
    ok: 'bg-ok-soft text-ok border-green-200',
    warn: 'bg-warn-soft text-warn border-amber-200',
    critical: 'bg-critical-soft text-critical border-red-200',
    neutral: 'bg-slate-100 text-slate-600 border-slate-200',
    accent: 'bg-accent-soft text-accent border-indigo-200',
  }[tone]
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>
}

export function Button({ children, variant = 'primary', ...rest }: {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'danger'
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const v = {
    primary: 'bg-accent text-white hover:bg-indigo-800',
    secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50',
    danger: 'bg-critical text-white hover:bg-red-700',
  }[variant]
  return (
    <button
      {...rest}
      className={`min-h-10 rounded-md px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${v} ${rest.className ?? ''}`}
    >
      {children}
    </button>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p role="alert" className="rounded-md border border-red-200 bg-critical-soft px-3 py-2 text-sm text-critical">{children}</p>
}
