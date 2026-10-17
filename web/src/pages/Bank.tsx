import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { createTransfer, getTransfer } from '../api'
import type { Transfer } from '../types'
import { Button, ErrorNote } from '../components/ui'

const START_BALANCE = 48250
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
  ok: 'border-green-300 bg-ok-soft text-green-900',
  warn: 'border-amber-300 bg-warn-soft text-amber-950',
  critical: 'border-red-300 bg-critical-soft text-red-900',
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
}

export default function Bank() {
  const search = useLocation().search
  const [payee, setPayee] = useState('New payee — Wells transfer')
  const [amount, setAmount] = useState('9500')
  const [newPayee, setNewPayee] = useState(true)
  const [transfer, setTransfer] = useState<Transfer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const released = transfer?.state === 'RELEASED' ? transfer.amount : 0
  const balance = START_BALANCE - released

  // Poll until the transfer reaches a final state.
  const id = transfer?.id
  const state = transfer?.state
  useEffect(() => {
    if (!id || state === 'RELEASED' || state === 'DECLINED') return
    const timer = setInterval(() => {
      getTransfer(id).then(setTransfer).catch(() => undefined)
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
    <div className="mx-auto w-full max-w-[390px] space-y-4">
      <div className="rounded-xl bg-accent p-5 text-white shadow">
        <p className="text-sm opacity-80">Checking account · Grandma</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{usd(balance)}</p>
        <p className="text-xs opacity-70">Available balance</p>
      </div>

      <form onSubmit={(e) => void submit(e)} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">Send money</h2>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Payee</span>
          <input
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            required
            className="min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Amount (USD)</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            required
            className="min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base tabular-nums"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={newPayee} onChange={(e) => setNewPayee(e.target.checked)} className="size-5" />
          This is a new payee
        </label>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" disabled={busy} className="w-full !min-h-12 text-base">
          {busy ? 'Sending…' : 'Send money'}
        </Button>
      </form>

      {transfer && status && (
        <div role="status" className={`space-y-2 rounded-lg border p-4 text-base ${TONE[status.tone]}`}>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Transfer status: {transfer.state}</p>
          <p>{status.text}</p>
          {transfer.state === 'HELD' && transfer.token && (
            <p className="border-t border-amber-300 pt-2 text-xs">
              Demo only:{' '}
              <Link className="font-semibold underline" to={`/approve/${transfer.token}${search}`}>
                open the trusted contact approval page
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
