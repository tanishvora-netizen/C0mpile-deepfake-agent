import { useEffect, useRef, useState, type Dispatch, type DragEvent, type SetStateAction } from 'react'
import { clipAudioUrl, listGolden } from '../api'
import type { GoldenClip } from '../types'
import { Icon } from './Icons'
import { mmss } from './lib'

export interface CallItem {
  id: string
  name: string
  file?: File
  /** Set for an example call that is already on the server. */
  clipId?: string
  url: string | null
  duration: number | null
}

const AUDIO_EXT = /\.(wav|mp3|m4a|aac|flac|ogg|oga|opus|webm|aif|aiff|caf|mp4)$/i
const isAudio = (f: File): boolean => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name)

let counter = 0
const nextId = (): string => `item-${Date.now()}-${++counter}`

/** Reads an audio file's length through an <audio> element (null when the browser can't tell). */
function readDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const a = new Audio()
    a.preload = 'metadata'
    let settled = false
    const done = (d: number | null) => {
      if (settled) return
      settled = true
      a.onloadedmetadata = a.onerror = a.ontimeupdate = null
      a.removeAttribute('src')
      resolve(d)
    }
    const timer = setTimeout(() => done(null), 5000)
    a.onloadedmetadata = () => {
      if (Number.isFinite(a.duration)) {
        clearTimeout(timer)
        done(a.duration)
      } else {
        // Recorded webm files report Infinity until the browser seeks to the end.
        a.ontimeupdate = () => {
          clearTimeout(timer)
          done(Number.isFinite(a.duration) ? a.duration : null)
        }
        a.currentTime = 1e101
      }
    }
    a.onerror = () => {
      clearTimeout(timer)
      done(null)
    }
    a.src = url
  })
}

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m))
}

const btnSecondary =
  'inline-flex items-center justify-center gap-2 rounded-full border border-line bg-card2 px-6 py-3 text-[17px] font-semibold text-ink transition hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
const iconBtn =
  'grid h-10 w-10 shrink-0 place-items-center rounded-full text-mute transition hover:bg-card2 hover:text-accent disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-accent'

export default function AddCall({
  items, setItems, onSubmit,
}: {
  items: CallItem[]
  setItems: Dispatch<SetStateAction<CallItem[]>>
  onSubmit: () => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [examples, setExamples] = useState<GoldenClip[]>([])

  // recording
  const [recording, setRecording] = useState(false)
  const [secs, setSecs] = useState(0)
  const [recError, setRecError] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    listGolden().then(setExamples).catch(() => setExamples([]))
  }, [])

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current)
      if (recorder.current && recorder.current.state !== 'inactive') {
        recorder.current.onstop = null
        recorder.current.stop()
      }
      stream.current?.getTracks().forEach((t) => t.stop())
    },
    [],
  )

  const stopPlayback = () => {
    audioRef.current?.pause()
    setPlaying(null)
  }

  const addItem = (item: CallItem) => {
    // An example call stands alone, so adding your own audio replaces it.
    setItems((prev) => [...prev.filter((p) => !p.clipId), item])
    if (item.url && item.duration === null) {
      void readDuration(item.url).then((d) => setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, duration: d } : p))))
    }
  }

  const addFiles = (list: FileList | File[]) => {
    setNotice(null)
    const files = Array.from(list)
    const good = files.filter(isAudio)
    const bad = files.filter((f) => !isAudio(f))
    if (bad.length) setNotice(`Skipped ${bad.map((f) => f.name).join(', ')} — that doesn't look like an audio file.`)
    for (const file of good) {
      addItem({ id: nextId(), name: file.name, file, url: URL.createObjectURL(file), duration: null })
    }
  }

  const remove = (it: CallItem) => {
    if (playing === it.id) stopPlayback()
    if (it.url && it.file) URL.revokeObjectURL(it.url)
    setItems((prev) => prev.filter((p) => p.id !== it.id))
  }

  const move = (i: number, dir: -1 | 1) =>
    setItems((prev) => {
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const togglePlay = (it: CallItem) => {
    const a = audioRef.current
    if (!a || !it.url) return
    if (playing === it.id) {
      stopPlayback()
      return
    }
    a.src = it.url
    a.play().then(() => setPlaying(it.id)).catch(() => setPlaying(null))
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
  }

  // ---- recording ----
  const startRecording = async () => {
    setRecError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setRecError("Recording isn't available in this browser. Add a recording of yourself from a file instead.")
      return
    }
    let s: MediaStream
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      const name = e instanceof DOMException ? e.name : ''
      setRecError(
        name === 'NotFoundError'
          ? "We couldn't find a microphone. Plug one in, or add a recording of yourself from a file."
          : "CallGuard can't use your microphone yet. Allow microphone access for this page in your browser, then try again — or add a recording from a file.",
      )
      return
    }
    stream.current = s
    const mime = pickMime()
    const mr = new MediaRecorder(s, mime ? { mimeType: mime } : undefined)
    const chunks: Blob[] = []
    const startedAt = Date.now()
    mr.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }
    mr.onstop = () => {
      s.getTracks().forEach((t) => t.stop())
      if (timer.current) clearInterval(timer.current)
      setRecording(false)
      const type = mr.mimeType || mime || 'audio/webm'
      if (!chunks.length) {
        setRecError('Nothing was recorded. Please try again.')
        return
      }
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
      const file = new File(chunks, `my_voice.${ext}`, { type })
      addItem({
        id: nextId(), name: 'My voice (recording)', file, url: URL.createObjectURL(file),
        duration: (Date.now() - startedAt) / 1000,
      })
    }
    recorder.current = mr
    mr.start()
    setSecs(0)
    setRecording(true)
    timer.current = setInterval(() => setSecs(Math.floor((Date.now() - startedAt) / 1000)), 250)
  }

  const stopRecording = () => {
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
  }

  const pickExample = (clipId: string) => {
    setNotice(null)
    stopPlayback()
    items.forEach((p) => p.file && p.url && URL.revokeObjectURL(p.url))
    if (!clipId) {
      setItems([])
      return
    }
    const c = examples.find((x) => x.clip_id === clipId)
    if (!c) return
    setItems([{ id: nextId(), name: c.title ?? c.name, clipId: c.clip_id, url: clipAudioUrl(c.clip_id), duration: c.duration_s ?? null }])
  }

  const exampleId = items.find((i) => i.clipId)?.clipId ?? ''

  return (
    <section className="rounded-3xl border border-line bg-card p-5 shadow-[0_0_80px_rgba(209,254,23,0.04)] sm:p-8" aria-labelledby="add-title">
      <h2 id="add-title" className="text-[30px] font-extrabold leading-tight tracking-tight text-ink">Add the call</h2>
      <p className="mt-2 text-[18px] leading-relaxed text-mute">
        Add the AI clip and a recording of yourself. CallGuard joins them into one call and checks every voice separately.
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`mt-6 rounded-3xl border-2 border-dashed px-4 py-8 text-center transition-colors sm:px-8 ${
          dragging ? 'border-accent bg-accent/10' : 'border-line bg-bg/60'
        }`}
      >
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-accent text-accent-ink">
          <Icon name="upload" className="h-6 w-6" />
        </span>
        <p className="mt-3 text-xl font-bold text-ink">Drag audio files here</p>
        <p className="text-[17px] text-mute">WAV, MP3, M4A, WebM and more</p>
        <div className="mt-5 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <button type="button" onClick={() => fileInput.current?.click()} className={btnSecondary}>
            <Icon name="file" className="h-5 w-5" /> Choose files
          </button>
          {recording ? (
            <button
              type="button" onClick={stopRecording}
              className="inline-flex items-center justify-center gap-3 rounded-full bg-ai px-6 py-3 text-[17px] font-bold text-bg transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span className="pulse-ring h-3 w-3 rounded-full bg-bg" aria-hidden="true" />
              <span className="tabular-nums" aria-live="off">{mmss(secs)}</span>
              <span className="inline-flex items-center gap-1.5"><Icon name="stop" className="h-4 w-4" fill /> Stop</span>
            </button>
          ) : (
            <button type="button" onClick={() => void startRecording()} className={btnSecondary}>
              <Icon name="mic" className="h-5 w-5" /> Record my voice
            </button>
          )}
        </div>
        <input
          ref={fileInput} type="file" accept="audio/*" multiple className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {recording && <p className="mt-3 text-[17px] text-mute" role="status">Recording… speak naturally for a few seconds, then press Stop.</p>}
      {recError && <p className="mt-3 rounded-2xl border border-line bg-card2 px-4 py-3 text-[17px] text-ink" role="alert">{recError}</p>}
      {notice && <p className="mt-3 rounded-2xl border border-line bg-card2 px-4 py-3 text-[17px] text-ink" role="alert">{notice}</p>}

      {items.length > 0 && (
        <ol className="mt-6 divide-y divide-line overflow-hidden rounded-2xl border border-line" aria-label="Audio in this call">
          {items.map((it, i) => (
            <li key={it.id} className="flex items-center gap-2 bg-card2/50 px-3 py-2.5 sm:gap-3 sm:px-4">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-[15px] font-extrabold text-accent-ink" aria-hidden="true">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[17px] font-semibold text-ink">{it.name}</div>
                <div className="text-[17px] text-mute">{it.duration !== null ? mmss(it.duration) : '…'}</div>
              </div>
              <button
                type="button" className={iconBtn} disabled={!it.url} onClick={() => togglePlay(it)}
                aria-label={playing === it.id ? `Pause ${it.name}` : `Play ${it.name}`}
              >
                <Icon name={playing === it.id ? 'pause' : 'play'} className="h-5 w-5" fill />
              </button>
              <button type="button" className={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${it.name} up`}>
                <Icon name="arrowUp" className="h-5 w-5" />
              </button>
              <button type="button" className={iconBtn} disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${it.name} down`}>
                <Icon name="arrowDown" className="h-5 w-5" />
              </button>
              <button type="button" className={iconBtn} onClick={() => remove(it)} aria-label={`Remove ${it.name}`}>
                <Icon name="x" className="h-5 w-5" />
              </button>
            </li>
          ))}
        </ol>
      )}
      <audio ref={audioRef} onEnded={() => setPlaying(null)} className="hidden" />

      {examples.length > 0 && (
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <label htmlFor="example" className="text-[17px] text-mute">or try an example call</label>
          <select
            id="example" value={exampleId} onChange={(e) => pickExample(e.target.value)}
            className="min-w-0 rounded-full border border-line bg-card2 px-5 py-3 text-[17px] text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            <option value="">Choose an example…</option>
            {examples.map((c) => <option key={c.clip_id} value={c.clip_id}>{c.title ?? c.name}</option>)}
          </select>
        </div>
      )}

      <button
        type="button" disabled={items.length === 0 || recording} onClick={onSubmit}
        className="mt-8 w-full rounded-full bg-accent px-10 py-4 text-xl font-extrabold text-accent-ink shadow-[0_0_36px_rgba(209,254,23,0.3)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:bg-card2 disabled:text-mute disabled:shadow-none sm:w-auto"
      >
        Check this call
      </button>
      {items.length === 0 && <p className="mt-3 text-[17px] text-mute">Add at least one audio clip to get started.</p>}
    </section>
  )
}
