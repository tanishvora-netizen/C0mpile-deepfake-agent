import type { CaseView, CaseState } from '../types'
import { Button, Card, Pill } from './ui'

const ACTION_LABEL: Record<string, string> = {
  verify_contact: 'Verify with contact',
  hold_new_payee: 'Hold transfers to new payees',
  notify_trusted_contact: 'Notify trusted contact',
}

const STATE_COPY: Record<CaseState, { tone: 'ok' | 'warn' | 'critical' | 'neutral' | 'accent'; text: string }> = {
  OPEN: { tone: 'neutral', text: 'Not started' },
  VERIFYING: { tone: 'accent', text: 'Waiting for the contact to reply' },
  VERIFIED: { tone: 'ok', text: 'Contact confirmed the call' },
  CONTRADICTED: { tone: 'critical', text: 'Contact says it was NOT them' },
  UNREACHABLE: { tone: 'warn', text: 'No reply from the contact' },
}

export function ActionsPanel({ view, busy, onReply, onOpen, canOpen }: {
  view: CaseView | null
  busy: boolean
  onReply: (r: 'YES' | 'NO') => void
  onOpen: () => void
  canOpen: boolean
}) {
  return (
    <Card
      title="Actions"
      right={
        <Button variant="secondary" onClick={onOpen} disabled={!canOpen || busy || view !== null} className="!min-h-9 !py-1.5">
          {view ? `Case ${view.case_id.slice(0, 12)}` : 'Open case'}
        </Button>
      }
    >
      {!view ? (
        <p className="text-sm text-slate-500">
          Open a case from this analysis to run the policy and ask the contact to verify.
        </p>
      ) : (
        <div className="space-y-4">
          <ul className="space-y-1.5">
            {view.actions.length === 0 && <li className="text-sm text-slate-500">No actions required.</li>}
            {view.actions.map((a, i) => (
              <li key={i} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                <p className="font-semibold">
                  {ACTION_LABEL[a.type] ?? a.type}
                  {a.target && <span className="ml-1.5 font-mono text-xs font-normal text-slate-500">{a.target}</span>}
                </p>
                <p className="text-slate-600">{a.reason}</p>
              </li>
            ))}
          </ul>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Verification status</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Jake</span>
              <Pill tone={STATE_COPY[view.state].tone}>{view.state}</Pill>
              <span className="text-sm text-slate-600">{STATE_COPY[view.state].text}</span>
            </div>
          </div>
          <div className="rounded-md border border-dashed border-slate-300 p-3">
            <p className="mb-2 text-xs text-slate-500">
              <b>Mock only.</b> Pretend to be Jake replying to the SMS.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => onReply('YES')} className="flex-1">YES, it was me</Button>
              <Button variant="danger" disabled={busy} onClick={() => onReply('NO')} className="flex-1">NO, not me</Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
