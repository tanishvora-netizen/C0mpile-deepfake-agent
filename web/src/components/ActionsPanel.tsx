import type { CaseView, CaseState } from '../types'
import { Button, Card, Empty, Pill } from './ui'

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
      title="Next steps"
      desc="Open a case to protect the account and ask the contact to confirm."
      right={
        <Button variant="secondary" onClick={onOpen} disabled={!canOpen || busy || view !== null} className="!px-5 !py-2 !text-[16px]">
          {view ? `Case ${view.case_id.slice(0, 12)}` : 'Open case'}
        </Button>
      }
    >
      {!view ? (
        <Empty>Open a case from this check to run the safety policy and ask the contact to verify.</Empty>
      ) : (
        <div className="space-y-5">
          <ul className="space-y-2">
            {view.actions.length === 0 && <li><Empty>No actions required.</Empty></li>}
            {view.actions.map((a, i) => (
              <li key={i} className="rounded-2xl border border-line bg-card2 px-4 py-3">
                <p className="text-[17px] font-bold text-ink">
                  {ACTION_LABEL[a.type] ?? a.type}
                  {a.target && <span className="ml-2 break-all font-mono text-[13px] font-normal text-mute">{a.target}</span>}
                </p>
                <p className="mt-0.5 text-[16px] leading-snug text-mute">{a.reason}</p>
              </li>
            ))}
          </ul>
          <div>
            <p className="text-[15px] font-semibold text-mute">Contact status</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="text-[17px] font-bold text-ink">Jake</span>
              <Pill tone={STATE_COPY[view.state].tone}>{STATE_COPY[view.state].text}</Pill>
            </div>
          </div>
          <div className="rounded-2xl border border-dashed border-line p-4">
            <p className="mb-3 text-[15px] leading-snug text-mute">
              <b className="text-ink">Demo only.</b> Pretend to be Jake replying to the text message.
            </p>
            <div className="flex flex-col gap-2 min-[480px]:flex-row">
              <Button variant="secondary" disabled={busy} onClick={() => onReply('YES')} className="flex-1">Yes, it was me</Button>
              <Button variant="danger" disabled={busy} onClick={() => onReply('NO')} className="flex-1">No, not me</Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
