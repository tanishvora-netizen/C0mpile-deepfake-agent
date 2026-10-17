import { useEffect, useRef, useState } from 'react'
import { listGolden, uploadClip } from '../api'
import type { GoldenClip } from '../types'
import { Card, ErrorNote, btnSecondary, focusRing } from './ui'

export interface PickedClip {
  clip_id: string
  label: string
}

export function ClipPicker({ picked, onPick, disabled }: {
  picked: PickedClip | null
  onPick: (c: PickedClip) => void
  disabled: boolean
}) {
  const [golden, setGolden] = useState<GoldenClip[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listGolden().then(setGolden).catch((e: Error) => setErr(`Could not load golden clips: ${e.message}`))
  }, [])

  async function onFile(f: File | undefined) {
    if (!f) return
    setBusy(true)
    setErr(null)
    try {
      const meta = await uploadClip(f)
      onPick({ clip_id: meta.clip_id, label: f.name })
    } catch (e) {
      setErr(`Upload failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <Card title="1. Pick a recording" desc="Choose an example call or upload your own audio.">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Example calls">
        {golden.map((g) => {
          const on = picked?.clip_id === g.clip_id
          return (
            <button
              key={g.name}
              disabled={disabled}
              onClick={() => onPick({ clip_id: g.clip_id, label: g.title ?? g.name })}
              aria-pressed={on}
              className={`min-h-11 min-w-12 rounded-full border px-4 py-2 text-[16px] font-bold transition disabled:opacity-50 ${focusRing} ${
                on ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-card2 text-ink hover:border-accent hover:text-accent'
              }`}
            >
              {g.title ?? g.name}
            </button>
          )
        })}
        {!golden.length && !err && <span className="text-[16px] text-mute">Loading clips…</span>}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <label className={`${btnSecondary} cursor-pointer border-dashed !py-2.5 text-[16px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${disabled || busy ? 'pointer-events-none opacity-50' : ''}`}>
          {busy ? 'Uploading…' : 'Upload audio'}
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac"
            className="sr-only"
            disabled={disabled || busy}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
        <span className="min-w-0 break-words text-[16px] text-mute">
          {picked ? <>Selected: <b className="text-ink">{picked.label}</b></> : 'Nothing selected yet'}
        </span>
      </div>
      {err && <div className="mt-4"><ErrorNote>{err}</ErrorNote></div>}
    </Card>
  )
}
