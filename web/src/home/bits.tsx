import type { ReactNode } from 'react'
import type { Tone } from './lib'
import { Icon, type IconName } from './Icons'

export const TONE_TILE: Record<Tone, string> = {
  neutral: 'bg-card2 text-mute',
  ok: 'bg-human/15 text-human',
  warn: 'bg-part/15 text-part',
  danger: 'bg-ai/15 text-ai',
}

export function IconTile({ icon, tone, size = 'md' }: { icon: IconName; tone: Tone; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-14 w-14 rounded-2xl' : 'h-10 w-10 rounded-xl'
  return (
    <span className={`grid shrink-0 place-items-center ${box} ${TONE_TILE[tone]}`}>
      <Icon name={icon} className={size === 'lg' ? 'h-7 w-7' : 'h-5 w-5'} />
    </span>
  )
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`spin ${className}`} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function TypingDots() {
  return (
    <span className="inline-flex gap-1.5" aria-label="typing">
      {[0, 1, 2].map((i) => (
        <span key={i} className="dot-blink h-2.5 w-2.5 rounded-full bg-mute" style={{ animationDelay: `${i * 0.2}s` }} />
      ))}
    </span>
  )
}

/** A phone mockup with a caption above it. */
export function Phone({ caption, note, dim = false, children }: {
  caption: string
  note?: string
  dim?: boolean
  children: ReactNode
}) {
  return (
    <div className={`flex flex-col items-center transition-opacity duration-500 ${dim ? 'opacity-45' : 'opacity-100'}`}>
      <div className="mb-3 text-center">
        <div className="text-[22px] font-extrabold leading-tight tracking-tight text-ink">{caption}</div>
        {note && <div className="text-[17px] text-mute">{note}</div>}
      </div>
      <div className="relative flex min-h-[410px] w-full max-w-[340px] flex-1 flex-col overflow-hidden rounded-[36px] border-[9px] border-[#2a2a31] bg-white shadow-[0_0_60px_rgba(209,254,23,0.12)]">
        <div className="absolute left-1/2 top-0 z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-[#2a2a31]" />
        {children}
      </div>
    </div>
  )
}
