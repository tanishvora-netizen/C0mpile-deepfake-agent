import type { CaseView, Packet } from '../types'
import { Card, Pill } from './ui'

export function CasePacket({ packet, view }: { packet: Packet | null; view: CaseView | null }) {
  const chain = packet?.chain ?? view?.chain ?? null
  return (
    <Card
      title="Case packet"
      right={
        chain === null ? null : chain.ok ? (
          <Pill tone="ok">Chain verified</Pill>
        ) : (
          <Pill tone="critical">Chain broken at event {chain.bad_seq ?? '?'}</Pill>
        )
      }
    >
      {!packet ? (
        <p className="text-sm text-slate-500">The incident summary and SAR draft appear after a case is opened.</p>
      ) : (
        <div className="space-y-4">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Summary</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{packet.summary}</p>
          </div>
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">SAR draft</h3>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-amber-200 bg-warn-soft p-3 font-sans text-sm text-slate-800">
              {packet.sar_draft}
            </pre>
          </div>
          {view && (
            <p className="text-xs text-slate-500">{view.events.length} hash-chained case events recorded.</p>
          )}
        </div>
      )}
    </Card>
  )
}
