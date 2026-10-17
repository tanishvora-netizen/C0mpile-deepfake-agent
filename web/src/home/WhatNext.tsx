import { useEffect, useMemo, useState } from 'react'
import { createTransfer, decide, getCase, getTransfer, openCase, simulateReply } from '../api'
import type { CaseView, Transfer } from '../types'
import { Spinner } from './bits'
import { cap, errMsg } from './lib'
import Phones, { AMOUNT, FALLBACK_SMS, PAYEE } from './Phones'

export default function WhatNext({ jobId }: { jobId: string }) {
  const [opening, setOpening] = useState(false)
  const [caseView, setCaseView] = useState<CaseView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [reply, setReply] = useState<'YES' | 'NO' | null>(null)
  const [transfer, setTransfer] = useState<Transfer | null>(null)
  const [busy, setBusy] = useState(false)

  const protect = async () => {
    if (opening) return
    setOpening(true)
    setErr(null)
    try {
      setCaseView(await openCase(jobId, 'grandma'))
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setOpening(false)
    }
  }

  const verify = useMemo(() => caseView?.actions.find((a) => a.type === 'verify_contact') ?? null, [caseView])
  const hasVerify = !!verify
  const contactName = cap(verify?.target?.trim() || 'Jake')

  const smsEv = useMemo(
    () => caseView?.events.find((e) => e.type === 'verification' && typeof e.payload.body === 'string'),
    [caseView],
  )
  const smsBody = smsEv ? String(smsEv.payload.body) : FALLBACK_SMS
  const smsSent = hasVerify || !!smsEv

  const guarded = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      await fn()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const sendReply = (r: 'YES' | 'NO') => guarded(async () => {
    if (!caseView) return
    await simulateReply(caseView.case_id, r)
    setReply(r)
    setCaseView(await getCase(caseView.case_id))
  })

  const sendTransfer = () => guarded(async () => {
    setTransfer(await createTransfer(PAYEE, AMOUNT, true, 'grandma'))
  })

  const decideNow = (verb: 'approve' | 'decline') => guarded(async () => {
    if (!transfer?.token) throw new Error('Missing approval token for this transfer')
    await decide(transfer.id, transfer.token, verb)
    setTransfer((t) => (t ? { ...t, state: verb === 'approve' ? 'RELEASED' : 'DECLINED' } : t))
  })

  // Poll the transfer; keep the token from the create response (GET omits it).
  const tId = transfer?.id
  const tState = transfer?.state
  useEffect(() => {
    if (!tId || tState !== 'HELD') return
    const iv = setInterval(() => {
      getTransfer(tId)
        .then((t) => setTransfer((prev) => (prev && prev.id === t.id ? { ...prev, ...t, token: prev.token ?? t.token } : prev)))
        .catch(() => undefined)
    }, 1500)
    return () => clearInterval(iv)
  }, [tId, tState])

  return (
    <section className="rise rounded-3xl border border-line bg-card p-5 shadow-[0_0_80px_rgba(209,254,23,0.04)] sm:p-8" aria-labelledby="next-title">
      <h2 id="next-title" className="text-[30px] font-extrabold leading-tight tracking-tight text-ink">What happens next</h2>
      <p className="mt-2 max-w-2xl text-[18px] leading-relaxed text-mute">
        An AI voice was found on this call. If the call was to Grandma, CallGuard can step in before any money leaves her account.
      </p>

      {!caseView && (
        <div className="mt-6">
          <button
            type="button" onClick={() => void protect()} disabled={opening}
            className="inline-flex items-center gap-3 rounded-full bg-accent px-8 py-4 text-xl font-bold text-accent-ink shadow-[0_0_32px_rgba(209,254,23,0.3)] transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
          >
            {opening && <Spinner />} Protect Grandma's account
          </button>
        </div>
      )}
      {err && <p className="mt-4 rounded-2xl border border-line bg-card2 px-4 py-3 text-[17px] text-ink" role="alert">{err}</p>}

      {caseView && (
        <div className="mt-6">
          {!hasVerify && (
            <p className="mx-auto mb-6 max-w-[760px] rounded-2xl border border-line bg-card2 px-4 py-3 text-[18px] leading-snug text-ink">
              The caller didn't claim to be a saved contact, so CallGuard holds new payees and alerts the trusted contact.
            </p>
          )}
          <Phones
            hasVerify={hasVerify} contactName={contactName}
            ready smsBody={smsBody} smsSent={smsSent} reply={reply}
            caseState={caseView.state} transfer={transfer} busy={busy} error={null}
            onReply={(r) => void sendReply(r)} onSend={() => void sendTransfer()} onDecide={(v) => void decideNow(v)}
          />
        </div>
      )}
    </section>
  )
}
