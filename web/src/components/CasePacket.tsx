import type { Packet } from '../types'
import { Card, Disclosure, Empty } from './ui'

export function CasePacket({ packet }: { packet: Packet | null }) {
  return (
    <Card title="Case summary" desc="A short write-up of the incident, ready to hand to your bank.">
      {!packet ? (
        <Empty>The summary and a draft suspicious-activity report appear after you open a case.</Empty>
      ) : (
        <div className="space-y-4">
          <div>
            <h3 className="text-[15px] font-semibold text-mute">Summary</h3>
            <p className="mt-1 whitespace-pre-wrap text-[17px] leading-relaxed text-ink">{packet.summary}</p>
          </div>
          <Disclosure label="Show SAR draft" openLabel="Hide SAR draft">
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl border border-part/40 bg-part/10 p-4 font-sans text-[16px] leading-relaxed text-ink">
              {packet.sar_draft}
            </pre>
          </Disclosure>
        </div>
      )}
    </Card>
  )
}
