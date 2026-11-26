import { useEffect, useState } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  Bell,
  Box,
  ChevronRight,
  CircleCheck,
  FileText,
  Fingerprint,
  GitBranch,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Upload,
  User,
  Users,
  X,
  Zap,
} from 'lucide-react'
import './App.css'

const navItems = [
  { label: 'Product', to: '/features' },
  { label: 'Solutions', to: '/how-it-works' },
  { label: 'Documentation', to: '/docs' },
  { label: 'About', to: '/about' },
]

type Observation = {
  category: string
  recordIds: string[]
  evidence: string[]
  explanation: string
  confidence: number
  status: string
}

type EvidenceRow = {
  id: string
  recordId: string
  rowNumber: number | null
  amount: string
  currency: string
  type: string
  status: string
  originalStatus: string
  reference: string
  source: string
}

type AgentRun = {
  id: string
  batch_id: string
  investigation_id: string
  agent_name: string
  status: string
  error_code: string | null
  started_at: string
  finished_at: string | null
  summary: { observations: Observation[]; reviewedCount?: number } | null
}

type DuplicateGroup = {
  key: string
  reference: string
  currency: string
  amount: string
  rows: EvidenceRow[]
}

type BatchDetail = {
  batch: {
    id: string
    investigationId: string
    model: string
    status: string
    createdAt: string
    finishedAt: string | null
  }
  runs: AgentRun[]
  evidence: EvidenceRow[]
  deterministicMatches: DuplicateGroup[]
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleTimeString() : 'pending'
}

function ObservationList({ observations, evidence }: { observations: Observation[]; evidence: EvidenceRow[] }) {
  if (!observations.length) return <p className="observation-empty">No candidate observations were accepted in this run.</p>
  const byId = new Map(evidence.map((row) => [row.id, row]))
  return (
    <div className="observation-list">
      {observations.map((observation, index) => {
        const rows = observation.evidence.map((id) => byId.get(id)).filter((row): row is EvidenceRow => Boolean(row))
        return (
          <article className="observation-card" key={`${observation.category}-${index}`}>
            <div className="observation-head">
              <strong>{observation.category.replace(/_/g, ' ')}</strong>
              <span className="observation-status">{observation.status || 'unverified'}</span>
            </div>
            <p>{observation.explanation}</p>
            <div className="observation-sources">
              <span>Confidence {Number(observation.confidence ?? 0).toFixed(2)}</span>
              <span>Cited records {observation.recordIds.join(', ') || 'none'}</span>
              <span>Source rows {rows.map((row) => `#${row.rowNumber ?? '?'} ${row.recordId}`).join(', ') || 'none'}</span>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function CompactObservations({ observations }: { observations: Observation[] }) {
  if (!observations.length) return <span>—</span>
  return (
    <ul className="compact-observations">
      {observations.map((observation, index) => (
        <li key={index}><b>{observation.category.replace(/_/g, ' ')}</b> {observation.explanation} <em>{observation.status || 'unverified'}</em></li>
      ))}
    </ul>
  )
}

function RunDetail({ run, evidence }: { run: AgentRun; evidence: EvidenceRow[] }) {
  const isAuditor = run.agent_name === 'Adversarial Auditor'
  return (
    <article className={`run-detail ${isAuditor ? 'auditor' : ''}`}>
      <div className="run-detail-head">
        <div><strong>{run.agent_name}</strong><small>{run.id}</small></div>
        <span className={`run-status ${run.status}`}>{run.status}</span>
      </div>
      <div className="run-times">
        <span>Started {formatTime(run.started_at)}</span>
        <span>Finished {formatTime(run.finished_at)}</span>
        {isAuditor && run.summary?.reviewedCount ? <span>Challenged {run.summary.reviewedCount} candidate observations</span> : null}
        {run.error_code && <span className="run-error">{run.error_code}</span>}
      </div>
      <ObservationList observations={run.summary?.observations || []} evidence={evidence} />
    </article>
  )
}

function BatchPanel({ detail }: { detail: BatchDetail }) {
  const specialists = detail.runs.filter((run) => run.agent_name !== 'Adversarial Auditor')
  const auditor = detail.runs.find((run) => run.agent_name === 'Adversarial Auditor')
  const isDemo = detail.batch.model === 'deterministic-demo'
  return (
    <section className="app-panel batch-panel">
      <div className="panel-heading">
        <div><span>Batch {detail.batch.id.slice(0, 8)}</span><strong>{detail.batch.status} · {detail.batch.model}</strong></div>
      </div>
      <div className="batch-timeline">
        <span>Started {formatTime(detail.batch.createdAt)}</span>
        <span>Finished {formatTime(detail.batch.finishedAt)}</span>
        <span>{specialists.length} specialists {isDemo ? 'produced rule-based observations' : 'ran in parallel'}{auditor ? '; auditor ran after them' : ''}</span>
      </div>
      {isDemo && <p className="investigation-note">Model-free deterministic demo: observations come from local rules on the uploaded rows, not a language model or external provider.</p>}
      {detail.runs.length ? (
        <div className="run-grid">{detail.runs.map((run) => <RunDetail key={run.id} run={run} evidence={detail.evidence} />)}</div>
      ) : <p className="investigation-note">The batch is queued. This panel refreshes automatically.</p>}
    </section>
  )
}

function DuplicateMatches({ groups }: { groups: DuplicateGroup[] }) {
  if (!groups.length) return null
  return (
    <section className="app-panel batch-panel">
      <div className="panel-heading"><div><span>Deterministic check</span><strong>Possible duplicate payouts</strong></div></div>
      <p className="investigation-note">Matching reference, currency and amount. This is a source-row check, not an agent finding.</p>
      {groups.map((group) => (
        <div className="duplicate-group" key={group.key}>
          <div className="duplicate-head"><strong>{group.reference}</strong><span>{group.currency} {group.amount}</span></div>
          <table>
            <thead><tr><th>Row</th><th>Source record ID</th><th>Amount</th><th>Source status</th><th>Evidence ID</th></tr></thead>
            <tbody>{group.rows.map((row) => (
              <tr key={row.id}>
                <td>#{row.rowNumber ?? '?'}</td>
                <td><strong>{row.recordId}</strong></td>
                <td>{row.amount}</td>
                <td>{row.originalStatus || row.status}</td>
                <td><small>{row.id}</small></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
    </section>
  )
}

function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link className={`brand ${light ? 'brand-light' : ''}`} to="/" aria-label="Payout Forensics home">
      <span className="brand-mark">P</span>
      <span>Payout Forensics</span>
    </Link>
  )
}

function Header() {
  const [open, setOpen] = useState(false)
  return (
    <header className="site-header">
      <Brand />
      <nav className={open ? 'nav-open' : ''} aria-label="Main navigation">
        {navItems.map((item) => (
          <Link key={item.label} to={item.to} onClick={() => setOpen(false)}>{item.label}</Link>
        ))}
      </nav>
      <Link className="launch-button" to="/app">Launch App <ArrowRight size={14} /></Link>
      <button className="menu-button" onClick={() => setOpen(!open)} aria-label="Toggle navigation">
        {open ? <X /> : <Menu />}
      </button>
    </header>
  )
}

function HeroVisual() {
  return (
    <div className="hero-visual" aria-label="Financial investigation visualization">
      <div className="orbit orbit-one"></div>
      <div className="orbit orbit-two"></div>
      <div className="visual-card transactions-card">
        <span>Source record</span>
        <strong>Traceable <i>linked</i></strong>
      </div>
      <div className="visual-card discrepancies-card">
        <span>Investigation</span>
        <strong>Candidate <i>review</i></strong>
      </div>
      <div className="visual-card evidence-card">
        <span>Provenance</span>
        <strong>Source-linked <i>records</i></strong>
      </div>
      <div className="magnifier">
        <div className="magnifier-lens">
          <div className="chart-bars">
            {[18, 30, 25, 39, 52, 68, 82, 75, 93].map((height, index) => (
              <span key={index} style={{ height: `${height}%` }}></span>
            ))}
          </div>
          <svg className="chart-line" viewBox="0 0 220 130" aria-hidden="true">
            <polyline points="12,106 38,96 66,101 93,77 122,83 150,48 178,54 208,25" />
          </svg>
        </div>
        <div className="magnifier-handle"></div>
      </div>
      <div className="coin-stack stack-left">
        {[0, 1, 2, 3].map((n) => <span key={n}></span>)}
      </div>
      <div className="coin-stack stack-right">
        {[0, 1, 2, 3, 4].map((n) => <span key={n}></span>)}
      </div>
    </div>
  )
}

function LandingPage() {
  return (
    <main>
      <Header />
      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow"><span></span> AI Multi-Agent Financial Investigation</div>
          <h1>Payout <br /><em>Forensics.</em></h1>
          <h2>Every transaction has a story.<br />Every discrepancy leaves a <em>trace.</em></h2>
          <p>Payout Forensics is a financial evidence workspace that imports CSV records, organizes source-linked investigations, and can request evidence-constrained review from Mozaik specialists.</p>
          <div className="hero-actions">
            <Link className="primary-button" to="/app/investigations/new">Start Investigating <ArrowRight size={17} /></Link>
            <button className="demo-button" onClick={() => document.querySelector('.product-preview')?.scrollIntoView({ behavior: 'smooth' })}>
              <span className="play-icon">View</span> See interface preview
            </button>
          </div>
          <div className="social-proof">
            <ShieldCheck size={17} />
            <p>Private workspace. Your financial records stay yours.</p>
          </div>
        </div>
        <HeroVisual />
      </section>

      <section className="trust-strip">
        <span className="trust-heading">Built with modern AI, powered by <strong>Mozaik</strong></span>
        <div><Box size={25} /><span><strong>Mozaik</strong></span></div>
        <div><GitBranch size={25} /><span><strong>Open Source</strong></span></div>
        <div><Zap size={25} /><span><strong>Evidence linked</strong></span></div>
        <div><LockKeyhole size={25} /><span><strong>Secure by Design</strong></span></div>
      </section>

      <section className="product-preview" id="features">
        <div className="preview-copy">
          <div className="pill">ILLUSTRATIVE INTERFACE PREVIEW</div>
          <h2>A deeper<br />investigation,<br /><em>not just an answer.</em></h2>
          <p>With a configured provider and your consent, five Mozaik specialists review imported record summaries in parallel; an adversarial pass challenges candidate observations. Results remain unverified.</p>
          <div className="feature-list">
            <div><Zap /><p><strong>Concurrent Agents</strong><span>Six expert agents work together.</span></p></div>
            <div><ShieldCheck /><p><strong>Evidence-Linked Results</strong><span>Observations cite source rows.</span></p></div>
            <div><Fingerprint /><p><strong>Adversarial Review</strong><span>Challenge candidates against imported IDs.</span></p></div>
            <div><BarChart3 /><p><strong>Financial Integrity</strong><span>No automated reconciliation totals yet.</span></p></div>
          </div>
        </div>
        <ProductPreview />
      </section>

      <section className="final-cta">
        <div className="cta-orb"><span>P</span></div>
        <div className="cta-copy">
          <h2>Investigate. Understand. <em>Resolve.</em></h2>
          <p>Join the next generation of financial intelligence.</p>
        </div>
        <Link className="primary-button" to="/app">Launch the App <ArrowRight size={17} /></Link>
      </section>
    </main>
  )
}

function ProductPreview() {
  return (
    <div className="dashboard-preview">
      <aside className="preview-sidebar">
        <Brand />
        <div className="preview-nav">
          <span className="active"><LayoutDashboard />Overview</span>
          <span><GitBranch />Evidence</span>
          <span><Users />Investigation</span>
          <span><FileText />Reports</span>
          <span><Settings />Settings</span>
        </div>
      </aside>
      <div className="preview-main">
        <div className="preview-greeting">
          <div><p>Private workspace</p><strong>Add your financial records to begin.</strong></div>
          <div className="sound-icon"></div>
        </div>
        <div className="metric-row">
          <div><span>Investigation status</span><strong>Ready</strong><small>Waiting for your records</small></div>
          <div><span>Evidence imported</span><strong>0 records</strong><small>Your uploads appear here</small></div>
          <div><span>Findings</span><strong>None yet</strong><small>No conclusions without evidence</small></div>
        </div>
        <div className="preview-bottom">
          <div className="activity-panel">
            <div className="panel-title"><strong>Mozaik agent activity</strong></div>
            <div className="preview-empty"><Users size={20} /><strong>No agent run yet</strong><span>Start an investigation to run specialists on your evidence.</span></div>
          </div>
          <div className="evidence-panel">
            <div className="panel-title"><strong>Evidence links · preview</strong></div>
            <div className="preview-empty"><GitBranch size={21} /><strong>Graph visualization is not implemented</strong><span>Review imported source rows in the Evidence workspace.</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}

const publicPages: Record<string, { title: string; copy: string }> = {
  '/how-it-works': { title: 'How it works', copy: 'Import CSV evidence, then optionally request source-constrained observations from specialist agents. Candidate observations are not verified findings.' },
  '/features': { title: 'Product capabilities', copy: 'Account-scoped investigations, CSV evidence ingestion and opt-in Mozaik review. Deterministic reconciliation and report export are not implemented yet.' },
  '/docs': { title: 'Documentation', copy: 'Setup, CSV ingestion, provider configuration and implementation limits are documented in the project README.' },
  '/security': { title: 'Security & data handling', copy: 'Selected fields are encrypted in SQLite. Uploaded records are sent to the configured model provider only after explicit user consent.' },
  '/about': { title: 'About Payout Forensics', copy: 'Evidence-first financial investigation infrastructure for modern finance teams.' },
}

function PublicPage() {
  const location = useLocation()
  const page = publicPages[location.pathname] || publicPages['/about']
  return (
    <main className="inner-public">
      <Header />
      <section className="inner-hero">
        <div className="pill">PAYOUT FORENSICS</div>
        <h1>{page.title}</h1>
        <p>{page.copy}</p>
        <Link className="primary-button" to="/app">Open the workspace <ArrowRight size={17} /></Link>
      </section>
    </main>
  )
}

function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)
    const form = new FormData(event.currentTarget)
    const isRegister = mode === 'register'
    const payload = isRegister
      ? { name: form.get('name'), username: form.get('username'), email: form.get('email'), password: form.get('password') }
      : { identifier: form.get('identifier'), password: form.get('password') }
    try {
      const response = await fetch(`/api/auth/${isRegister ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error || 'Unable to continue')
        return
      }
      window.location.href = '/app'
    } catch {
      setError('Unable to reach the server. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <Header />
      <section className="auth-shell">
        <div className="auth-introduction">
          <div className="pill">SECURE WORKSPACE</div>
          <h1>Follow the money.<br /><em>Verify every trace.</em></h1>
          <p>Source-linked financial evidence and optional specialist review for finance operations teams.</p>
        </div>
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-tabs">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError('') }}>Sign in</button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError('') }}>Create account</button>
          </div>
          {mode === 'register' && (
            <>
              <label>Full name<input name="name" autoComplete="name" required /></label>
              <label>Username<input name="username" pattern="[a-zA-Z0-9_.-]{3,32}" autoComplete="username" required /></label>
              <label>Email<input name="email" type="email" autoComplete="email" required /></label>
            </>
          )}
          {mode === 'login' && <label>Username or email<input name="identifier" autoComplete="username" required /></label>}
          <label>Password<input name="password" type="password" minLength={12} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label>
          {error && <div className="auth-error">{error}</div>}
          <button className="primary-button" type="submit" disabled={loading}>{loading ? 'Processing...' : mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight size={16} /></button>
        </form>
      </section>
    </main>
  )
}

const appLinks = [
  { label: 'Overview', to: '/app', icon: LayoutDashboard },
  { label: 'Investigations', to: '/app/investigations', icon: Search },
  { label: 'Evidence', to: '/app/evidence', icon: Fingerprint },
  { label: 'Transactions', to: '/app/transactions', icon: BarChart3 },
  { label: 'Settlements', to: '/app/settlements', icon: CircleCheck },
  { label: 'Agents', to: '/app/agents', icon: Users },
  { label: 'Reports', to: '/app/reports', icon: FileText },
]

function AppSidebar() {
  const location = useLocation()
  return (
    <aside className="app-sidebar">
      <Brand />
      <nav>
        {appLinks.map(({ label, to, icon: Icon }) => (
          <Link key={to} to={to} className={location.pathname === to ? 'active' : ''}>
            <Icon size={18} /><span>{label}</span>
          </Link>
        ))}
      </nav>
      <Link className="app-settings" to="/app/settings"><Settings size={18} /><span>Settings</span></Link>
    </aside>
  )
}

function InvestigationRow({ name, id, status, variance, date }: { name: string; id: string; status: string; variance: string; date: string }) {
  return (
    <tr>
      <td><Link to={`/app/investigations/${id}`}><strong>{name}</strong><small>{id}</small></Link></td>
      <td><span className={`status-dot ${status.toLowerCase().replace(' ', '-')}`}>{status}</span></td>
      <td>{variance}</td>
      <td>{date}</td>
      <td><Link to={`/app/investigations/${id}`} aria-label={`Open investigation ${name}`}><ChevronRight size={16} /></Link></td>
    </tr>
  )
}

function Dashboard() {
  const location = useLocation()
  const isRoot = location.pathname === '/app'
  const title = isRoot ? 'Overview' : location.pathname.split('/').pop()?.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const [user, setUser] = useState<{ name: string; username: string; email?: string } | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchError, setSearchError] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ id: string; title: string; status: string }>>([])
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationError, setNotificationError] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; message: string; unread: number }>>([])
  const [investigations, setInvestigations] = useState<Array<{ id: string; name: string; status: string; variance: string; created_at: string }>>([])
  const [evidenceCount, setEvidenceCount] = useState(0)
  const [agentRuns, setAgentRuns] = useState<Array<{ id: string; agent_name: string; status: string; error_code?: string }>>([])
  const [workspaceError, setWorkspaceError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function loadWorkspace() {
      try {
        const meResponse = await fetch('/api/me', { credentials: 'include' })
        if (meResponse.status === 401) { window.location.href = '/login'; return }
        if (!meResponse.ok) throw new Error('profile request failed')
        const [me, dashboardResponse, runsResponse] = await Promise.all([
          meResponse.json(),
          fetch('/api/dashboard', { credentials: 'include' }),
          fetch('/api/mozaik/runs', { credentials: 'include' }),
        ])
        if (!dashboardResponse.ok || !runsResponse.ok) throw new Error('workspace request failed')
        const [dashboard, runData] = await Promise.all([dashboardResponse.json(), runsResponse.json()])
        if (cancelled) return
        setUser(me.user)
        setInvestigations(dashboard.investigations || [])
        setEvidenceCount(dashboard.evidenceCount || 0)
        setAgentRuns(runData.runs || [])
      } catch {
        if (!cancelled) setWorkspaceError('Workspace data could not be loaded. Check the API and refresh.')
      }
    }
    loadWorkspace()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!searchOpen) return
    const timeout = window.setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`, { credentials: 'include' })
        .then((response) => {
          if (!response.ok) throw new Error('Search request failed')
          return response.json()
        })
        .then((data) => { setSearchResults(data.results || []); setSearchError('') })
        .catch(() => { setSearchResults([]); setSearchError('Search is temporarily unavailable.') })
    }, 150)
    return () => window.clearTimeout(timeout)
  }, [searchOpen, searchQuery])

  async function openNotifications() {
    const opening = !notificationsOpen
    setNotificationsOpen(opening)
    if (!opening) return
    try {
      const response = await fetch('/api/notifications', { credentials: 'include' })
      if (!response.ok) throw new Error('Notification request failed')
      const data = await response.json()
      setNotifications(data.notifications || [])
      setNotificationError('')
    } catch {
      setNotificationError('Notifications could not be loaded.')
    }
  }

  async function markNotificationsRead() {
    try {
      const response = await fetch('/api/notifications/read', { method: 'POST', credentials: 'include' })
      if (!response.ok) throw new Error('Notification update failed')
      setNotifications((items) => items.map((item) => ({ ...item, unread: 0 })))
      setNotificationError('')
    } catch {
      setNotificationError('Notifications could not be marked as read.')
    }
  }

  async function logout() {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
      if (!response.ok) throw new Error('Logout request failed')
      window.location.href = '/login'
    } catch {
      setWorkspaceError('Logout could not be confirmed. Retry before closing this page.')
    }
  }

  return (
    <div className="app-shell">
      <AppSidebar />
      <main className="app-main">
        <header className="app-header">
          <div className="app-breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{title}</strong></div>
          <div className="app-header-actions">
            <button aria-label="Search" onClick={() => setSearchOpen(true)}><Search size={18} /></button>
            <button aria-label="Notifications" onClick={openNotifications}><Bell size={18} />{notifications.some((item) => item.unread) && <i className="notification-dot"></i>}</button>
            <button className="profile-button" aria-label="Open profile menu" onClick={() => setProfileOpen(!profileOpen)}>
              <span className="profile-avatar">{user?.name?.[0]?.toUpperCase() || 'U'}</span>
            </button>
            {profileOpen && (
              <div className="profile-menu">
                <div><strong>{user?.name || 'User'}</strong><small>@{user?.username || 'username'}</small></div>
                <Link to="/app/settings" onClick={() => setProfileOpen(false)}><User size={15} /> Profile and security</Link>
                <button onClick={logout}><LogOut size={15} /> Log out</button>
              </div>
            )}
            {searchOpen && (
              <div className="header-overlay search-overlay">
                <div className="overlay-heading"><strong>Search workspace</strong><button onClick={() => setSearchOpen(false)}><X size={16} /></button></div>
                <div className="search-input"><Search size={16} /><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search investigations or IDs" /></div>
                <div className="search-results">
                  {searchError ? <p role="alert">{searchError}</p> : searchResults.length ? searchResults.map((result) => (
                    <Link key={result.id} to="/app/investigations" onClick={() => setSearchOpen(false)}><div><strong>{result.title}</strong><small>{result.id}</small></div><span>{result.status}</span></Link>
                  )) : <p>No matching workspace records.</p>}
                </div>
              </div>
            )}
            {notificationsOpen && (
              <div className="header-overlay notifications-overlay">
                <div className="overlay-heading"><strong>Notifications</strong><button onClick={() => setNotificationsOpen(false)}><X size={16} /></button></div>
                {notificationError ? <p role="alert" className="empty-notifications">{notificationError}</p> : notifications.length ? notifications.map((item) => (
                  <div className={`notification-row ${item.unread ? 'unread' : ''}`} key={item.id}><span></span><div><strong>{item.title}</strong><p>{item.message}</p></div></div>
                )) : <p className="empty-notifications">You're all caught up.</p>}
                <button className="mark-read" onClick={markNotificationsRead}>Mark all as read</button>
              </div>
            )}
          </div>
        </header>

        {isRoot ? (
          <div className="dashboard-content">
            {workspaceError && <div className="settings-status" role="alert">{workspaceError}</div>}
            <div className="dashboard-heading">
              <div><p>PRIVATE WORKSPACE</p><h1>Financial Intelligence</h1></div>
              <Link className="primary-button" to="/app/investigations/new"><Upload size={16} /> New investigation</Link>
            </div>
            <div className="kpi-grid">
              <div className="kpi-card"><span>Investigations</span><strong>{investigations.length}</strong><small>Stored in your workspace</small></div>
              <div className="kpi-card"><span>Imported evidence rows</span><strong>{evidenceCount}</strong><small>Your uploaded records</small></div>
              <div className="kpi-card"><span>Unexplained variance</span><strong>Not calculated</strong><small className="amber">Reconciliation engine not implemented</small></div>
              <div className="kpi-card"><span>Agent runs</span><strong>{agentRuns.length}</strong><small>Mozaik executions in your workspace</small></div>
            </div>

            <div className="dashboard-grid">
              <section className="app-panel variance-panel">
                <div className="panel-heading"><div><span>Reconciliation variance</span><strong>Not calculated</strong></div></div>
                <div className="dashboard-empty"><BarChart3 size={22} /><strong>Financial variance is not calculated</strong><span>Imported evidence can be reviewed, but deterministic reconciliation is not implemented.</span></div>
              </section>
              <section className="app-panel agents-panel">
                <div className="panel-heading"><div><span>Mozaik agent execution</span><strong>{agentRuns.length} persisted agent runs</strong></div><Link to="/app/agents">View all</Link></div>
                {agentRuns.slice(0, 4).map((run) => (
                  <div className="agent-list-row" key={run.id}><span className="agent-letter">{run.agent_name[0]}</span><p><strong>{run.agent_name}</strong><small>{run.error_code || 'Execution state'}</small></p><b className={['failed', 'partial', 'interrupted'].includes(run.status) ? run.status : ''}>{run.status}</b></div>
                ))}
                {!agentRuns.length && <div className="dashboard-empty compact"><Users size={20} /><strong>No agent executions yet</strong><span>Mozaik runs will appear here after you start one.</span></div>}
              </section>
            </div>

            <section className="app-panel investigations-panel">
              <div className="panel-heading"><div><span>Recent investigations</span><strong>Your stored cases</strong></div><Link to="/app/investigations">View workspace</Link></div>
              <table>
                <thead><tr><th>Investigation</th><th>Status</th><th>Variance</th><th>Updated</th><th></th></tr></thead>
                <tbody>
                  {investigations.length ? investigations.slice(0, 5).map((investigation) => (
                    <InvestigationRow key={investigation.id} name={investigation.name} id={investigation.id} status={investigation.status} variance={investigation.variance} date={new Date(investigation.created_at).toLocaleDateString()} />
                  )) : (
                    <tr><td colSpan={5}>No investigations yet. Create your first investigation to begin.</td></tr>
                  )}
                </tbody>
              </table>
            </section>
          </div>
        ) : (
          <WorkspacePage />
        )}
      </main>
    </div>
  )
}

function WorkspacePage() {
  const location = useLocation()
  const segment = location.pathname.split('/').filter(Boolean).pop() || 'workspace'
  const isNew = segment === 'new'
  const isSettings = segment === 'settings'
  const isInvestigationDetail = location.pathname.startsWith('/app/investigations/') && !isNew
  const title = isNew ? 'Create investigation' : isInvestigationDetail ? 'Investigation' : segment.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const [profile, setProfile] = useState<{ name: string; username: string; email: string } | null>(null)
  const [investigationName, setInvestigationName] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [status, setStatus] = useState('')
  const [investigations, setInvestigations] = useState<Array<{ id: string; name: string; status: string; variance: string; created_at: string }>>([])
  const [records, setRecords] = useState<Array<EvidenceRow & { investigationId: string }>>([])
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [mozaikConfigured, setMozaikConfigured] = useState(false)
  const [newInvestigationId, setNewInvestigationId] = useState('')
  const [activeBatchId, setActiveBatchId] = useState('')
  const [batchDetail, setBatchDetail] = useState<BatchDetail | null>(null)
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([])
  const selectedInvestigation = isInvestigationDetail ? investigations.find((item) => item.id === segment) : undefined
  const investigationRuns = runs.filter((run) => run.investigation_id === segment)

  useEffect(() => {
    if (isSettings) {
      fetch('/api/me', { credentials: 'include' })
        .then((response) => {
          if (!response.ok) throw new Error('Profile request failed')
          return response.json()
        })
        .then((data) => setProfile(data.user))
        .catch(() => setStatus('Profile data could not be loaded. Refresh and try again.'))
      return
    }
    Promise.all([
      fetch('/api/dashboard', { credentials: 'include' }),
      fetch('/api/mozaik/runs', { credentials: 'include' }),
      fetch('/api/mozaik/status', { credentials: 'include' }),
    ]).then(async ([dashboardResponse, runsResponse, statusResponse]) => {
      if (!dashboardResponse.ok || !runsResponse.ok || !statusResponse.ok) throw new Error('Workspace request failed')
      const [dashboard, runData, mozaikStatus] = await Promise.all([
        dashboardResponse.json(),
        runsResponse.json(),
        statusResponse.json(),
      ])
      setInvestigations(dashboard.investigations || [])
      setRuns(runData.runs || [])
      setMozaikConfigured(Boolean(mozaikStatus.configured))
      const evidenceInvestigationIds = ['evidence', 'transactions'].includes(segment)
        ? (dashboard.investigations || []).map((item: { id: string }) => item.id)
        : isInvestigationDetail && (dashboard.investigations || []).some((item: { id: string }) => item.id === segment)
          ? [segment]
          : []
      if (evidenceInvestigationIds.length > 0) {
        const evidenceSets = await Promise.all(evidenceInvestigationIds.map(async (id: string) => {
          const response = await fetch(`/api/investigations/${id}/evidence`, { credentials: 'include' })
            if (!response.ok) throw new Error('Evidence request failed')
          const result = await response.json()
          return (result.evidence || []).map((row: Omit<(typeof records)[number], 'investigationId'>) => ({ ...row, investigationId: id }))
        }))
        setRecords(evidenceSets.flat())
      }
      if (isInvestigationDetail && (dashboard.investigations || []).some((item: { id: string }) => item.id === segment)) {
        const response = await fetch(`/api/investigations/${segment}/duplicate-check`, { credentials: 'include' })
        if (response.ok) {
          const data = await response.json()
          setDuplicateGroups(data.groups || [])
        }
      }
    }).catch(() => setStatus('Workspace data could not be loaded. Refresh and try again.'))
  }, [isSettings, isInvestigationDetail, segment])

  useEffect(() => {
    if (!activeBatchId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const response = await fetch(`/api/mozaik/batches/${activeBatchId}`, { credentials: 'include' })
        if (!response.ok) return
        const detail: BatchDetail = await response.json()
        if (cancelled) return
        setBatchDetail(detail)
        if (detail.batch.status === 'queued' || detail.batch.status === 'running') {
          timer = setTimeout(poll, 2000)
          return
        }
        setActiveBatchId('')
        setStatus(`Mozaik batch finished with status ${detail.batch.status}.`)
        const [runsResponse, dashboardResponse] = await Promise.all([
          fetch('/api/mozaik/runs', { credentials: 'include' }),
          fetch('/api/dashboard', { credentials: 'include' }),
        ])
        if (!cancelled && runsResponse.ok && dashboardResponse.ok) {
          const [runData, dashboard] = await Promise.all([runsResponse.json(), dashboardResponse.json()])
          setRuns(runData.runs || [])
          setInvestigations(dashboard.investigations || [])
        }
      } catch {
        if (!cancelled) setStatus('Batch status could not be polled. Check Agent activity.')
      }
    }
    timer = setTimeout(poll, 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [activeBatchId])

  async function createInvestigation() {
    setStatus('')
    try {
      const response = await fetch('/api/investigations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: investigationName }),
      })
      const data = await response.json()
      if (!response.ok) { setStatus(data.error || 'Unable to create investigation'); return }
      setNewInvestigationId(data.investigation.id)
      if (uploadFile) {
        const form = new FormData()
        form.append('file', uploadFile)
        const uploadResponse = await fetch(`/api/investigations/${data.investigation.id}/upload`, { method: 'POST', credentials: 'include', body: form })
        const uploadData = await uploadResponse.json()
        if (!uploadResponse.ok) { setStatus(uploadData.error || 'CSV upload failed'); return }
        setStatus(`Accepted ${uploadData.accepted} records; rejected ${uploadData.rejected}.`)
        setInvestigations((items) => [{ ...data.investigation, name: investigationName, created_at: new Date().toISOString() }, ...items])
        return
      }
      setStatus(`Investigation ${data.investigation.id} created.`)
    } catch {
      setStatus('The request could not be completed. Refresh the investigation list before retrying.')
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') || '')
    const username = String(form.get('username') || '')
    try {
      const response = await fetch('/api/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username }),
      })
      const data = await response.json()
      setStatus(response.ok ? 'Profile updated.' : data.error || 'Unable to update profile')
    } catch {
      setStatus('Unable to reach the server. Your profile was not confirmed as updated.')
    }
  }

  async function resetPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      const response = await fetch('/api/me/password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: form.get('password') }),
      })
      const data = await response.json()
      setStatus(response.ok ? 'Password updated.' : data.error || 'Unable to update password')
    } catch {
      setStatus('Unable to reach the server. The password update was not confirmed.')
    }
  }

  async function runInvestigation(id: string) {
    if (!window.confirm('This sends up to 1,000 uploaded record summaries to your configured model provider for investigation. Continue?')) return
    try {
      const response = await fetch(`/api/investigations/${id}/run`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmExternalProcessing: true }),
      })
      const data = await response.json()
      if (response.ok) {
        setStatus(`Mozaik run ${data.runId} is ${data.status}. This panel updates automatically.`)
        setBatchDetail(null)
        setActiveBatchId(data.runId)
      } else {
        setStatus(data.error || 'Unable to start Mozaik')
      }
    } catch {
      setStatus('The run status could not be confirmed. Check agent activity before retrying.')
    }
  }

  async function runModelFreeDemo(id: string) {
    try {
      const response = await fetch(`/api/investigations/${id}/run-demo`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await response.json()
      if (response.ok) {
        setStatus(`Model-free demo batch ${data.runId} is ${data.status}. This panel updates automatically.`)
        setBatchDetail(null)
        setActiveBatchId(data.runId)
      } else {
        setStatus(data.error || 'Unable to start the model-free demo.')
      }
    } catch {
      setStatus('The demo status could not be confirmed. Check the batch panel before retrying.')
    }
  }

  return (
    <div className="dashboard-content workspace-content">
      <div className="dashboard-heading">
      <div><p>PRIVATE WORKSPACE</p><h1>{title}</h1></div>
      {segment === 'investigations' && <Link className="primary-button" to="/app/investigations/new"><Upload size={16} /> New investigation</Link>}
      </div>
      {isSettings ? (
        <div className="settings-grid">
          <section className="app-panel settings-panel">
            <div className="settings-heading"><User size={18} /><div><strong>Profile</strong><p>Manage your account identity</p></div></div>
            {profile && (
              <form onSubmit={saveProfile} className="settings-form">
                <label>Full name<input name="name" defaultValue={profile.name} required /></label>
                <label>Username<input name="username" defaultValue={profile.username} pattern="[a-zA-Z0-9_.-]{3,32}" required /></label>
                <label>Email<input value={profile.email} readOnly /></label>
                <button className="primary-button" type="submit">Save profile</button>
              </form>
            )}
          </section>
          <section className="app-panel settings-panel">
            <div className="settings-heading"><LockKeyhole size={18} /><div><strong>Password</strong><p>Use at least 12 characters</p></div></div>
            <form onSubmit={resetPassword} className="settings-form">
              <label>New password<input name="password" type="password" minLength={12} required /></label>
              <button className="primary-button" type="submit">Reset password</button>
            </form>
          </section>
          {status && <div className="settings-status">{status}</div>}
        </div>
      ) : isNew ? (
        <div className="create-grid">
          <section className="app-panel upload-panel">
            <div className="upload-zone">
              <Upload size={30} />
              <h2>Upload financial records</h2>
              <p>CSV files up to 25 MB</p>
              <label className="secondary-button file-button">Choose CSV file<input type="file" accept=".csv,text/csv" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} /></label>
              {uploadFile && <small className="selected-file">{uploadFile.name}</small>}
            </div>
          </section>
          <section className="app-panel create-form">
            <label>Investigation name<input value={investigationName} onChange={(event) => setInvestigationName(event.target.value)} required /></label>
            <small className="provider-note">Imports preserve record IDs, amounts, source row numbers and supplied reference, currency, type and status. Automated reconciliation totals are not available yet.</small>
            <button className="primary-button" type="button" onClick={createInvestigation}>Start investigation <ArrowRight size={16} /></button>
            <small className="provider-note">{mozaikConfigured ? 'Mozaik is configured. You choose when to send your records for agent review.' : 'Mozaik agent runs require a configured model provider API key.'}</small>
            {newInvestigationId && <div className="table-actions"><button className="secondary-button" type="button" onClick={() => runModelFreeDemo(newInvestigationId)} disabled={Boolean(activeBatchId)}>Start model-free demo</button><button className="secondary-button" type="button" onClick={() => runInvestigation(newInvestigationId)} disabled={!mozaikConfigured}>Start Mozaik agents</button></div>}
            {status && <div className="settings-status">{status}</div>}
          </section>
        </div>
      ) : segment === 'investigations' ? (
        <section className="app-panel data-table-panel">
          <div className="panel-heading"><div><span>Investigations</span><strong>Only your saved cases are shown</strong></div><Link className="text-link" to="/app/investigations/new">New investigation</Link></div>
          <table>
            <thead><tr><th>Investigation</th><th>Status</th><th>Variance</th><th>Created</th><th>Action</th></tr></thead>
            <tbody>{investigations.length ? investigations.map((item) => (
              <tr key={item.id}><td><Link to={`/app/investigations/${item.id}`}><strong>{item.name}</strong><small>{item.id}</small></Link></td><td>{item.status}</td><td>Not calculated</td><td>{new Date(item.created_at).toLocaleDateString()}</td><td><div className="table-actions"><button className="table-action" onClick={() => runModelFreeDemo(item.id)}>Model-free demo</button><button className="table-action" onClick={() => runInvestigation(item.id)} disabled={!mozaikConfigured}>Run agents</button></div></td></tr>
            )) : <tr><td colSpan={5}>No investigations yet. Create one and upload your financial records.</td></tr>}</tbody>
          </table>
          {status && <div className="settings-status">{status}</div>}
        </section>
      ) : isInvestigationDetail ? (
        selectedInvestigation ? (
          <>
            <section className="app-panel data-table-panel">
              <div className="panel-heading">
                <div><span>{selectedInvestigation.id}</span><strong>{selectedInvestigation.name} · {selectedInvestigation.status}</strong></div>
                <div className="table-actions"><button className="table-action" onClick={() => runModelFreeDemo(selectedInvestigation.id)} disabled={Boolean(activeBatchId)}>Model-free demo</button><button className="table-action" onClick={() => runInvestigation(selectedInvestigation.id)} disabled={!mozaikConfigured || Boolean(activeBatchId)}>Run agents</button></div>
              </div>
              <p className="investigation-note">Financial variance is not calculated. Imported rows and agent observations are shown as evidence, not verified accounting findings.</p>
              <table>
                <thead><tr><th>Row</th><th>Source record ID</th><th>Reference</th><th>Currency</th><th>Type</th><th>Source status</th><th>Amount</th><th>Source file</th></tr></thead>
                <tbody>{records.length ? records.map((row) => (
                  <tr key={row.id}>
                    <td>#{row.rowNumber ?? '?'}</td>
                    <td><strong>{row.recordId}</strong><small>{row.id}</small></td>
                    <td>{row.reference || '—'}</td>
                    <td>{row.currency || '—'}</td>
                    <td>{row.type || '—'}</td>
                    <td>{row.originalStatus || row.status}</td>
                    <td>{row.amount}</td>
                    <td>{row.source}</td>
                  </tr>
                )) : <tr><td colSpan={8}>No evidence rows uploaded to this investigation.</td></tr>}</tbody>
              </table>
              <div className="panel-heading investigation-runs-heading"><div><span>Agent activity</span><strong>Persisted runs with timings</strong></div></div>
              <table>
                <thead><tr><th>Specialist</th><th>Status</th><th>Started</th><th>Finished</th><th>Candidate observations</th></tr></thead>
                <tbody>{investigationRuns.length ? investigationRuns.map((run) => (
                  <tr key={run.id}>
                    <td><strong>{run.agent_name}</strong><small>{run.error_code || run.id}</small></td>
                    <td>{run.status}</td>
                    <td>{formatTime(run.started_at)}</td>
                    <td>{formatTime(run.finished_at)}</td>
                    <td><CompactObservations observations={run.summary?.observations || []} /></td>
                  </tr>
                )) : <tr><td colSpan={5}>No agent runs for this investigation.</td></tr>}</tbody>
              </table>
            </section>
            <DuplicateMatches groups={duplicateGroups} />
            {batchDetail && batchDetail.batch.investigationId === segment && <BatchPanel detail={batchDetail} />}
            {status && <div className="settings-status">{status}</div>}
          </>
        ) : (
          <section className="app-panel empty-workspace"><Search size={24} /><h2>Investigation not found</h2><p>This case does not exist in your account.</p><Link className="text-link" to="/app/investigations">Back to investigations</Link></section>
        )
      ) : segment === 'agents' ? (
        <section className="app-panel data-table-panel">
          <div className="panel-heading"><div><span>Mozaik agent activity</span><strong>Persisted execution status and evidence-linked candidate observations</strong></div></div>
          <table>
            <thead><tr><th>Specialist</th><th>Status</th><th>Investigation</th><th>Started</th><th>Finished</th><th>Candidate observations</th></tr></thead>
            <tbody>{runs.length ? runs.map((run) => (
              <tr key={run.id}>
                <td><strong>{run.agent_name}</strong><small>{run.error_code || run.id}</small></td>
                <td>{run.status}</td>
                <td>{run.investigation_id}</td>
                <td>{formatTime(run.started_at)}</td>
                <td>{formatTime(run.finished_at)}</td>
                <td><CompactObservations observations={run.summary?.observations || []} /></td>
              </tr>
            )) : <tr><td colSpan={6}>No Mozaik executions yet. Configure a model provider and start an agent run from an investigation.</td></tr>}</tbody>
          </table>
        </section>
      ) : ['evidence', 'transactions'].includes(segment) ? (
        <section className="app-panel data-table-panel">
          <div className="panel-heading"><div><span>{title}</span><strong>Imported records from your investigations</strong></div></div>
          <table>
            <thead><tr><th>Row</th><th>Source record ID</th><th>Reference</th><th>Currency</th><th>Import status</th><th>Amount</th><th>Source file</th><th>Investigation</th></tr></thead>
            <tbody>{records.length ? records.map((row) => (
              <tr key={row.id}>
                <td>#{row.rowNumber ?? '?'}</td>
                <td><strong>{row.recordId}</strong><small>{row.id}</small></td>
                <td>{row.reference || '—'}</td>
                <td>{row.currency || '—'}</td>
                <td>{row.status}</td>
                <td>{row.amount}</td>
                <td>{row.source}</td>
                <td>{row.investigationId}</td>
              </tr>
            )) : <tr><td colSpan={8}>No records uploaded to your workspace yet.</td></tr>}</tbody>
          </table>
        </section>
      ) : segment === 'settlements' ? (
        <section className="app-panel empty-workspace">
          <CircleCheck size={26} /><h2>Settlement reconciliation is not implemented</h2><p>Imported rows remain available in Evidence and Transactions. This page does not currently identify or match settlement records.</p>
        </section>
      ) : segment === 'reports' ? (
        <section className="app-panel empty-workspace">
          <FileText size={26} /><h2>Report generation is not implemented</h2><p>Review imported evidence and persisted agent observations in their respective workspaces. No report export is currently available.</p>
        </section>
      ) : (
        <section className="app-panel empty-workspace">
          <Search size={24} /><h2>{title}</h2><p>This view is scoped to your account. No records are available here yet.</p>
        </section>
      )}
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/how-it-works" element={<PublicPage />} />
      <Route path="/features" element={<PublicPage />} />
      <Route path="/docs" element={<PublicPage />} />
      <Route path="/security" element={<PublicPage />} />
      <Route path="/about" element={<PublicPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/app/*" element={<Dashboard />} />
    </Routes>
  )
}

export default App
