import { useEffect, useRef, useState } from 'react'
import { listGolden, uploadClip } from '../api'
import type { GoldenClip } from '../types'
import { Card, ErrorNote } from './ui'

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
    <Card title="1. Clip">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Example calls">
        {golden.map((g) => {
          const on = picked?.clip_id === g.clip_id
          return (
            <button
              key={g.name}
              disabled={disabled}
              onClick={() => onPick({ clip_id: g.clip_id, label: g.title ?? g.name })}
              aria-pressed={on}
              className={`min-h-10 min-w-12 rounded-md border px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50 ${
                on ? 'border-accent bg-accent text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {g.title ?? g.name}
            </button>
          )
        })}
        {!golden.length && !err && <span className="text-sm text-slate-500">Loading clips…</span>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="cursor-pointer rounded-md border border-dashed border-slate-300 px-3 py-2 text-slate-600 hover:bg-slate-50">
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
        <span className="text-slate-500">
          {picked ? <>Selected: <b className="text-slate-800">{picked.label}</b></> : 'No clip selected'}
        </span>
      </div>
      {err && <div className="mt-3"><ErrorNote>{err}</ErrorNote></div>}
    </Card>
  )
}
