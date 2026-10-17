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

function AnalystShell() {
  const { search } = useLocation()
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
          <span className="text-base font-bold tracking-tight text-accent">CallGuard</span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Analyst view</span>
          <nav className="flex gap-1" aria-label="Screens">
            {TABS.map((t) => (
              <NavLink
                key={t.to}
                to={{ pathname: t.to, search }}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-accent-soft text-accent' : 'text-slate-600 hover:bg-slate-100'}`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
          <NavLink to={{ pathname: '/', search }} className="text-sm font-medium text-slate-500 hover:text-slate-900">
            ← Back to CallGuard
          </NavLink>
          {isFixtures() && (
            <span className="ml-auto rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">fixtures mode</span>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-4">
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
