import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import Console from './pages/Console'
import Bank from './pages/Bank'
import Approve from './pages/Approve'
import Eval from './pages/Eval'
import Home from './pages/Home'
import { isFixtures } from './api'

const TABS = [
  { to: '/console', label: 'Console' },
  { to: '/bank', label: 'Bank' },
  { to: '/eval', label: 'Eval' },
]

/** Token of a held transfer saved by the Bank screen (so Approve can be reached from the bar). */
function savedApproveToken(): string | null {
  try {
    const raw = sessionStorage.getItem('callguard.bank.transfer')
    const t = raw ? (JSON.parse(raw) as { state?: string; token?: string }) : null
    return t && t.state === 'HELD' && t.token ? t.token : null
  } catch {
    return null
  }
}

function AnalystShell() {
  const { search, pathname } = useLocation()
  const onApprove = pathname.startsWith('/approve/')
  const token = onApprove ? pathname.split('/')[2] : savedApproveToken()
  const tabs = [
    ...TABS.slice(0, 2),
    ...(token ? [{ to: `/approve/${token}`, label: 'Approve' }] : []),
    ...TABS.slice(2),
  ]
  return (
    <div className="min-h-screen text-[17px] text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <NavLink
            to={{ pathname: '/', search }}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-4 py-2 text-[16px] font-bold text-ink transition hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span aria-hidden="true">←</span> Back to CallGuard
          </NavLink>
          <nav className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1" aria-label="Analyst view">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={{ pathname: t.to, search }}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-full px-4 py-2 text-[16px] font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    isActive ? 'bg-accent text-accent-ink' : 'text-mute hover:bg-card2 hover:text-ink'
                  }`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1100px] px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[14px] font-bold uppercase tracking-widest text-mute">
          <span className="text-accent">Analyst view</span>
          {isFixtures() && <span className="rounded-full border border-part/50 bg-part/10 px-3 py-0.5 normal-case tracking-normal text-part">Example data mode</span>}
        </div>
        <Routes>
          <Route path="/console" element={<Console />} />
          <Route path="/bank" element={<Bank />} />
          <Route path="/approve/:token" element={<Approve />} />
          <Route path="/eval" element={<Eval />} />
          <Route path="*" element={<Navigate to={{ pathname: '/console', search }} replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  const { search } = useLocation()
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/demo" element={<Navigate to={{ pathname: '/', search }} replace />} />
      <Route path="*" element={<AnalystShell />} />
    </Routes>
  )
}
