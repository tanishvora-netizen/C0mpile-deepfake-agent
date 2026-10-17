import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { decide, getApproval } from '../api'
import type { Transfer } from '../types'
import { Button, ErrorNote, PageHeader } from '../components/ui'

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
    <div className="mx-auto w-full max-w-[390px]">
      <PageHeader title="Approve a transfer" desc="A transfer was paused to keep Grandma safe. Check it looks right, then approve or decline." />
      <div className="space-y-4">
        <div className="rounded-3xl border border-line bg-card p-5">
          <p className="text-[15px] font-bold uppercase tracking-wide text-accent">Trusted contact approval</p>
          <h2 className="mt-1 text-[26px] font-extrabold leading-tight tracking-tight">Grandma needs your OK</h2>
          {loading && <p className="mt-3 text-[17px] text-mute">Loading…</p>}
          {t && (
            <dl className="mt-5 space-y-4">
              <div>
                <dt className="text-[15px] font-semibold text-mute">Amount</dt>
                <dd className="text-[44px] font-black leading-none tracking-tight tabular-nums">{usd(t.amount)}</dd>
              </div>
              <div>
                <dt className="text-[15px] font-semibold text-mute">Payee</dt>
                <dd className="text-[19px] font-bold">{t.payee}</dd>
              </div>
              <div>
                <dt className="mb-1.5 text-[15px] font-semibold text-mute">Why it was held</dt>
                <dd className="rounded-2xl border border-part/50 bg-part/10 p-4 text-[17px] leading-snug text-ink">
                  {t.reason || 'A new payee was added while the caller could not be verified.'}
                </dd>
              </div>
            </dl>
          )}
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        {t && t.state === 'HELD' && (
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" disabled={busy} onClick={() => void act('decline')} className="!py-4 !text-lg">Decline</Button>
            <Button disabled={busy} onClick={() => void act('approve')} className="!py-4 !text-lg">Approve</Button>
          </div>
        )}
        {t && t.state === 'RELEASED' && (
          <p role="status" className="rounded-3xl border border-human/40 bg-human/10 p-5 text-[18px] font-semibold text-human">Approved. The transfer has been released.</p>
        )}
        {t && t.state === 'DECLINED' && (
          <p role="status" className="rounded-3xl border border-ai/40 bg-ai/10 p-5 text-[18px] font-semibold text-ai">Declined. No money has been sent.</p>
        )}
        {t && t.state === 'PENDING' && (
          <p className="text-[17px] text-mute">This transfer is not waiting for approval.</p>
        )}
      </div>
    </div>
  )
}
