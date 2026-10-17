import type { CaseState, Transfer } from '../types'
import { Phone, TypingDots } from './bits'
import { Icon } from './Icons'
import { usd } from './lib'

export const START_BALANCE = 48250
export const FALLBACK_SMS = 'Bay Credit Union: Did you just call Grandma asking for money? Reply YES or NO.'
export const PAYEE = 'New payee — Wells transfer'
const HELD_COPY_VERIFY = (who: string) => `Paused for your safety. We could not confirm the caller was ${who}. We've asked your trusted contact to approve this transfer.`
const HELD_COPY_GENERIC = "Paused for your safety. A voice on your recent call sounded AI-generated. We've asked your trusted contact to approve this transfer."
export const AMOUNT = 9500

const pulse = 'pulse-ring'

export default function Phones({
  hasVerify, contactName, ready, error, smsBody, smsSent, reply, caseState, transfer, busy, onReply, onSend, onDecide,
}: {
  hasVerify: boolean
  contactName: string
  ready: boolean
  error: string | null
  smsBody: string
  smsSent: boolean
  reply: 'YES' | 'NO' | null
  caseState: CaseState | null
  transfer: Transfer | null
  busy: boolean
  onReply: (r: 'YES' | 'NO') => void
  onSend: () => void
  onDecide: (verb: 'approve' | 'decline') => void
}) {
  const held = transfer?.state === 'HELD'
  const settled = transfer?.state === 'DECLINED' || transfer?.state === 'RELEASED'
  const showMaria = !!transfer && (held || (settled && !!transfer.reason))
  const balance = START_BALANCE - (transfer?.state === 'RELEASED' ? transfer.amount : 0)
  const nextAction = !ready ? null : smsSent && !reply ? 'reply' : !transfer ? 'send' : held ? 'decide' : null

  return (
    <div>
      {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-lg text-red-800">{error}</p>}
      <div className={`grid gap-8 ${hasVerify ? 'md:grid-cols-3' : 'mx-auto max-w-[760px] md:grid-cols-2'}`}>
        {/* (a) the saved contact's real phone */}
        {hasVerify && (
        <Phone caption={`${contactName}'s real phone`} note="The saved number — not the caller's">
          <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 pb-3 pt-8">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-accent text-white"><Icon name="bank" className="h-5 w-5" /></span>
            <div>
              <div className="text-lg font-bold leading-tight">Bay Credit Union</div>
              <div className="text-sm text-slate-500">Text message · now</div>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-3 p-4">
            {ready && !smsSent ? (
              <div className="grid flex-1 place-items-center text-center text-lg text-slate-400">
                No text needed.
              </div>
            ) : ready ? (
              <div className="rise max-w-[92%] rounded-3xl rounded-bl-md bg-slate-100 px-4 py-3 text-[18px] leading-snug text-slate-900">
                {smsBody}
              </div>
            ) : (
              <div className="rounded-3xl rounded-bl-md bg-slate-100 px-4 py-3"><TypingDots /></div>
            )}
            {reply && (
              <div className="rise ml-auto rounded-3xl rounded-br-md bg-accent px-6 py-3 text-2xl font-bold text-white">{reply}</div>
            )}
            {reply && (
              <div
                className={`rise mt-auto rounded-2xl px-4 py-3 text-[18px] font-bold leading-snug ${
                  reply === 'NO' ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'
                }`}
              >
                {reply === 'NO' ? `${contactName} says it wasn't them` : `${contactName} says it was them`}
                {' → '}
                <span className="tracking-wide">{caseState && caseState !== 'OPEN' && caseState !== 'VERIFYING' ? caseState : reply === 'NO' ? 'CONTRADICTED' : 'VERIFIED'}</span>
              </div>
            )}
            {smsSent && !reply && (
              <div className="mt-auto grid grid-cols-2 gap-3">
                <button
                  type="button" disabled={!ready || busy} onClick={() => onReply('YES')}
                  className="rounded-2xl border-2 border-slate-300 bg-white py-3.5 text-2xl font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                >
                  YES
                </button>
                <button
                  type="button" disabled={!ready || busy} onClick={() => onReply('NO')}
                  className={`rounded-2xl bg-slate-900 py-3.5 text-2xl font-bold text-white transition hover:bg-slate-700 disabled:opacity-40 ${nextAction === 'reply' ? pulse : ''}`}
                >
                  NO
                </button>
              </div>
            )}
          </div>
        </Phone>
        )}

        {/* (b) Grandma's banking app */}
        <Phone caption="Grandma's banking app" note="Her account at the credit union">
          <div className="bg-accent px-5 pb-4 pt-8 text-white">
            <div className="text-sm font-semibold uppercase tracking-wider text-indigo-200">Checking ••4821</div>
            <div className="text-[34px] font-extrabold tabular-nums leading-tight">{usd(balance)}</div>
          </div>
          <div className="flex flex-1 flex-col gap-3 p-4">
            {!transfer ? (
              <>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-sm font-semibold uppercase tracking-wider text-slate-400">Send money</div>
                  <div className="mt-1 text-[22px] font-bold">{usd(AMOUNT)}</div>
                  <div className="text-base text-slate-500">To: {PAYEE}</div>
                </div>
                <button
                  type="button" disabled={!ready || busy} onClick={onSend}
                  className={`mt-auto rounded-2xl bg-accent px-4 py-4 text-xl font-bold leading-snug text-white transition hover:bg-indigo-800 disabled:opacity-40 ${nextAction === 'send' ? pulse : ''}`}
                >
                  Send {usd(AMOUNT)}
                </button>
              </>
            ) : (
              <>
                <div className="text-base text-slate-500">{usd(transfer.amount)} → {transfer.payee}</div>
                {transfer.state === 'PENDING' && (
                  <div className="rise flex-1 rounded-2xl border-2 border-slate-300 bg-slate-50 p-4 text-slate-800">
                    <Icon name="check" className="h-10 w-10 text-green-600" />
                    <div className="mt-2 text-[30px] font-extrabold leading-tight tracking-tight">Sent</div>
                    <p className="mt-1 text-[19px] leading-snug">CallGuard saw nothing unusual, so this transfer went through.</p>
                  </div>
                )}
                {held && (
                  <div className="rise flex-1 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4">
                    <div className="flex items-center gap-2 text-amber-800">
                      <Icon name="pause" className="h-8 w-8" fill />
                      <span className="text-[36px] font-extrabold leading-none tracking-tight">HELD</span>
                    </div>
                    <p className="mt-3 text-[18px] leading-snug text-amber-950">{transfer.reason ?? (hasVerify ? HELD_COPY_VERIFY(contactName) : HELD_COPY_GENERIC)}</p>
                  </div>
                )}
                {transfer.state === 'DECLINED' && (
                  <div className="rise flex-1 rounded-2xl border-2 border-green-500 bg-green-50 p-4 text-green-900">
                    <Icon name="shieldCheck" className="h-10 w-10 text-green-600" />
                    <div className="mt-2 text-[30px] font-extrabold leading-tight tracking-tight">Declined</div>
                    <p className="mt-1 text-[20px] font-semibold leading-snug">No money left the account.</p>
                  </div>
                )}
                {transfer.state === 'RELEASED' && (
                  <div className="rise flex-1 rounded-2xl border-2 border-slate-300 bg-slate-50 p-4 text-slate-800">
                    <Icon name="bank" className="h-10 w-10" />
                    <div className="mt-2 text-[30px] font-extrabold leading-tight tracking-tight">Released</div>
                    <p className="mt-1 text-[20px] font-semibold leading-snug">{usd(transfer.amount)} was sent.</p>
                  </div>
                )}
              </>
            )}
          </div>
        </Phone>

        {/* (c) Maria's phone */}
        <Phone caption="Maria's phone" note="Grandma's trusted contact" dim={!showMaria}>
          <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 pb-3 pt-8">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-slate-900 text-white"><Icon name="shield" className="h-5 w-5" /></span>
            <div>
              <div className="text-lg font-bold leading-tight">CallGuard</div>
              <div className="text-sm text-slate-500">{showMaria ? 'Approval needed · now' : 'No alerts'}</div>
            </div>
          </div>
          {showMaria && transfer ? (
            <div key="maria" className="rise flex flex-1 flex-col gap-3 p-4">
              <div>
                <div className="text-base text-slate-500">Grandma wants to send</div>
                <div className="text-[40px] font-extrabold tabular-nums leading-tight">{usd(transfer.amount)}</div>
                <div className="text-lg text-slate-700">to {transfer.payee}</div>
              </div>
              <div className="rounded-2xl bg-amber-50 px-4 py-3 text-base leading-snug text-amber-950">
                <b>Why it is held:</b> {hasVerify ? `we could not confirm the caller was ${contactName}.` : 'a voice on the call sounded AI-generated.'}
              </div>
              {held ? (
                <div className="mt-auto grid grid-cols-2 gap-3">
                  <button
                    type="button" disabled={busy} onClick={() => onDecide('approve')}
                    className="rounded-2xl border-2 border-slate-300 bg-white py-3.5 text-xl font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
                  >
                    Approve
                  </button>
                  <button
                    type="button" disabled={busy} onClick={() => onDecide('decline')}
                    className={`rounded-2xl bg-slate-900 py-3.5 text-xl font-bold text-white transition hover:bg-slate-700 disabled:opacity-40 ${nextAction === 'decide' ? pulse : ''}`}
                  >
                    Decline
                  </button>
                </div>
              ) : (
                <div className={`rise mt-auto rounded-2xl px-4 py-3 text-[19px] font-bold ${transfer.state === 'DECLINED' ? 'bg-green-50 text-green-800' : 'bg-slate-100 text-slate-800'}`}>
                  {transfer.state === 'DECLINED' ? 'You declined this transfer.' : 'You approved this transfer.'}
                </div>
              )}
            </div>
          ) : (
            <div className="grid flex-1 place-items-center p-6 text-center text-lg text-slate-400">
              Waiting for a held transfer…
            </div>
          )}
        </Phone>
      </div>
    </div>
  )
}
