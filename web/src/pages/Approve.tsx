import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { decide, getApproval } from '../api'
import type { Transfer } from '../types'
import { Button, ErrorNote } from '../components/ui'

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export default function Approve() {
  const { token = '' } = useParams()
  const [t, setT] = useState<Transfer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getApproval(token)
      .then(setT)
      .catch((e: Error) => setError(`This approval link could not be opened (${e.message}).`))
      .finally(() => setLoading(false))
  }, [token])

  async function act(verb: 'approve' | 'decline') {
    if (!t) return
    setBusy(true)
    setError(null)
    try {
      await decide(t.id, token, verb)
      setT({ ...t, state: verb === 'approve' ? 'RELEASED' : 'DECLINED' })
    } catch (e) {
      setError(`Could not record your answer: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[390px] space-y-4">
      <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">Trusted contact approval</p>
        <h1 className="mt-1 text-xl font-semibold">Grandma needs your OK</h1>
        {loading && <p className="mt-3 text-sm text-slate-500">Loading…</p>}
        {t && (
          <dl className="mt-4 space-y-3 text-base">
            <div>
              <dt className="text-xs text-slate-500">Amount</dt>
              <dd className="text-3xl font-semibold tabular-nums">{usd(t.amount)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Payee</dt>
              <dd className="font-medium">{t.payee}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Why it was held</dt>
              <dd className="rounded-md bg-warn-soft p-3 text-sm text-amber-950">
                {t.reason || 'A new payee was added while the caller could not be verified.'}
              </dd>
            </div>
          </dl>
        )}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {t && t.state === 'HELD' && (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" disabled={busy} onClick={() => void act('decline')} className="!min-h-14 text-base">Decline</Button>
          <Button disabled={busy} onClick={() => void act('approve')} className="!min-h-14 text-base">Approve</Button>
        </div>
      )}
      {t && t.state === 'RELEASED' && (
        <p role="status" className="rounded-lg border border-green-300 bg-ok-soft p-4 text-green-900">Approved. The transfer has been released.</p>
      )}
      {t && t.state === 'DECLINED' && (
        <p role="status" className="rounded-lg border border-red-300 bg-critical-soft p-4 text-red-900">Declined. No money has been sent.</p>
      )}
      {t && t.state === 'PENDING' && (
        <p className="text-sm text-slate-500">This transfer is not waiting for approval.</p>
      )}
    </div>
  )
}
