import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { createTransfer, getTransfer } from '../api'
import type { Transfer } from '../types'
import { Button, ErrorNote, Field, PageHeader, inputCls } from '../components/ui'

const START_BALANCE = 48250
const SAVED_TRANSFER_KEY = 'callguard.bank.transfer'

function loadSavedTransfer(): Transfer | null {
  try {
    const raw = sessionStorage.getItem(SAVED_TRANSFER_KEY)
    return raw ? (JSON.parse(raw) as Transfer) : null
  } catch {
    return null
  }
}
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export const HELD_COPY =
  "Paused for your safety. We could not confirm the caller was Jake. We've asked your trusted contact to approve this transfer."

export function statusCopy(t: Transfer): { tone: 'ok' | 'warn' | 'critical' | 'neutral'; text: string } {
  switch (t.state) {
    case 'HELD':
      return { tone: 'warn', text: HELD_COPY }
    case 'RELEASED':
      return { tone: 'ok', text: `Sent. ${usd(t.amount)} is on its way to ${t.payee}.` }
    case 'DECLINED':
      return { tone: 'critical', text: 'Cancelled. Your trusted contact declined this transfer. No money has left your account.' }
    default:
      return { tone: 'neutral', text: 'Sending your transfer…' }
  }
}

const TONE = {
  ok: 'border-human/40 bg-human/10',
  warn: 'border-part/50 bg-part/10',
  critical: 'border-ai/40 bg-ai/10',
  neutral: 'border-line bg-card',
}
const TONE_HEAD = { ok: 'text-human', warn: 'text-part', critical: 'text-ai', neutral: 'text-mute' }
const STATE_WORD: Record<Transfer['state'], string> = {
  PENDING: 'Sending',
  HELD: 'On hold',
  RELEASED: 'Sent',
  DECLINED: 'Cancelled',
}

export default function Bank() {
  const search = useLocation().search
  const [payee, setPayee] = useState('New payee — Wells transfer')
  const [amount, setAmount] = useState('9500')
  const [newPayee, setNewPayee] = useState(true)
  const [transfer, setTransfer] = useState<Transfer | null>(loadSavedTransfer)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const released = transfer?.state === 'RELEASED' ? transfer.amount : 0
  const balance = START_BALANCE - released

  // Keep the transfer across navigation (e.g. after using the approve page in this tab).
  useEffect(() => {
    try {
      if (transfer) sessionStorage.setItem(SAVED_TRANSFER_KEY, JSON.stringify(transfer))
    } catch {
      // storage unavailable: the screen still works for this visit
    }
  }, [transfer])

  // Refresh a restored transfer once on mount so a decision made elsewhere shows up.
  const restoredId = useState(() => transfer?.id)[0]
  useEffect(() => {
    if (!restoredId) return
    getTransfer(restoredId)
      .then((t) => setTransfer((prev) => ({ ...t, token: t.token ?? prev?.token })))
      .catch(() => undefined)
  }, [restoredId])

  // Poll until the transfer reaches a final state.
  const id = transfer?.id
  const state = transfer?.state
  useEffect(() => {
    if (!id || state === 'RELEASED' || state === 'DECLINED') return
    const timer = setInterval(() => {
      getTransfer(id)
        .then((t) => setTransfer((prev) => ({ ...t, token: t.token ?? prev?.token })))
        .catch(() => undefined)
    }, 2000)
    return () => clearInterval(timer)
  }, [id, state])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      setTransfer(await createTransfer(payee, amt, newPayee))
    } catch (err) {
      setError(`We could not start that transfer: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const status = transfer ? statusCopy(transfer) : null

  return (
    <div className="mx-auto w-full max-w-[390px]">
      <PageHeader title="Demo bank" desc="A pretend bank app. Send money to see CallGuard hold a risky transfer." />
      <div className="space-y-4">
        <div className="rounded-3xl bg-accent p-6 text-accent-ink">
          <p className="text-[16px] font-semibold opacity-80">Checking account · Grandma</p>
          <p className="mt-1 text-[44px] font-black leading-none tracking-tight tabular-nums">{usd(balance)}</p>
          <p className="mt-1 text-[15px] font-medium opacity-75">Available balance</p>
        </div>

        <form onSubmit={(e) => void submit(e)} className="space-y-4 rounded-3xl border border-line bg-card p-5">
          <h2 className="text-[24px] font-extrabold tracking-tight">Send money</h2>
          <Field label="Payee">
            <input value={payee} onChange={(e) => setPayee(e.target.value)} required className={inputCls} />
          </Field>
          <Field label="Amount (USD)">
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required className={`${inputCls} tabular-nums`} />
          </Field>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[17px] text-ink">
            <input type="checkbox" checked={newPayee} onChange={(e) => setNewPayee(e.target.checked)} className="size-6 accent-[#d1fe17]" />
            This is a new payee
          </label>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" disabled={busy} className="w-full !py-3.5 !text-lg">
            {busy ? 'Sending…' : 'Send money'}
          </Button>
        </form>

        {transfer && status && (
          <div role="status" className={`space-y-2 rounded-3xl border p-5 ${TONE[status.tone]}`}>
            <p className={`text-[15px] font-bold uppercase tracking-wide ${TONE_HEAD[status.tone]}`}>Transfer {STATE_WORD[transfer.state].toLowerCase()}</p>
            <p className="text-[17px] leading-snug text-ink">{status.text}</p>
            {transfer.state === 'HELD' && transfer.token && (
              <p className="border-t border-part/30 pt-3 text-[15px] text-mute">
                Demo only:{' '}
                <Link className="font-semibold text-accent underline underline-offset-4" to={`/approve/${transfer.token}${search}`}>
                  open the trusted contact approval page
                </Link>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
