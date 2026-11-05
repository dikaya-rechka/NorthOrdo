import { useEffect, useState, type FormEvent } from 'react'
import { EstimatesPage } from './features/estimates/EstimatesPage'
import { ObjectsPage } from './features/objects/ObjectsPage'
import { WorksPage } from './features/works/WorksPage'
import { FinancePage } from './features/finance/FinancePage'
import { OverviewFinance } from './features/finance/FinancePlanning'
import { MaterialsPage } from './features/materials/MaterialsPage'
import { ToolsPage } from './features/tools/ToolsPage'
import { DocumentsPage } from './features/documents/DocumentsPage'
import './App.css'

type IconName = 'overview' | 'objects' | 'works' | 'estimates' | 'finance' | 'materials' | 'tools' | 'documents' | 'arrow' | 'info'
type ModuleId = Exclude<IconName, 'arrow' | 'info'>
type AppRole = 'OWNER' | 'ADMIN'
type AppUser = { id: string; username: string; role: AppRole }
type AuthState =
  | { status: 'checking' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: AppUser }
  | { status: 'unavailable' }

const modules: { id: ModuleId; label: string; description: string }[] = [
  { id: 'objects', label: 'Объекты', description: 'Общая информация и ход работ по объектам.' },
  { id: 'works', label: 'Работы', description: 'Предстоящие и выполненные работы команды.' },
  { id: 'estimates', label: 'Сметы', description: 'Работы, объёмы, стоимость и история изменений.' },
  { id: 'finance', label: 'Финансы', description: 'Поступления, расходы и финансовая сводка.' },
  { id: 'materials', label: 'Материалы', description: 'Закупки, остатки и движение материалов.' },
  { id: 'tools', label: 'Инструменты', description: 'Оборудование, состояние и ответственные.' },
  { id: 'documents', label: 'Документы', description: 'Локальные вложения, карточки и история документов.' },
]

function Icon({ name, size = 19 }: { name: IconName; size?: number }) {
  const shared = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }

  switch (name) {
    case 'overview':
      return <svg {...shared}><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg>
    case 'objects':
      return <svg {...shared}><path d="M4 20.5V7.8L12 3.5l8 4.3v12.7" /><path d="M8 20.5v-7h8v7M8 9h.01M12 9h.01M16 9h.01" /></svg>
    case 'works':
      return <svg {...shared}><rect x="5" y="4" width="15" height="17" rx="2" /><path d="M9 4V2.5h7V4M8 11l2 2 4-4M8 17h8" /></svg>
    case 'estimates':
      return <svg {...shared}><path d="M7 3.5h7l4 4v13H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" /><path d="M14 3.5v4h4M8.5 12h7M8.5 16h7" /></svg>
    case 'finance':
      return <svg {...shared}><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 9h17M7.5 5V3.5h9V5M15.5 14h2" /><circle cx="13" cy="14" r=".7" fill="currentColor" stroke="none" /></svg>
    case 'materials':
      return <svg {...shared}><path d="m12 3.5 8.5 4.7v8.1L12 21l-8.5-4.7V8.2L12 3.5Z" /><path d="m3.8 8.3 8.2 4.6 8.2-4.6M12 12.9V21M7.5 5.9l8.3 4.7" /></svg>
    case 'tools':
      return <svg {...shared}><path d="M14.5 6.2a4.5 4.5 0 0 0-5.8 5.8l-5.1 5.1a2 2 0 0 0 2.8 2.8l5.1-5.1a4.5 4.5 0 0 0 5.8-5.8l-2.7 2.7-3-3 2.9-2.5Z" /></svg>
    case 'documents':
      return <svg {...shared}><path d="M7 3.5h7l4 4v13H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" /><path d="M14 3.5v4h4M8.5 12h7M8.5 16h5" /></svg>
    case 'arrow':
      return <svg {...shared}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
    case 'info':
      return <svg {...shared}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
  }
}

function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'checking' })
  const [activeId, setActiveId] = useState<'overview' | ModuleId>('overview')
  const [estimateObjectFilter, setEstimateObjectFilter] = useState('')
  const activeModule = modules.find((module) => module.id === activeId)

  useEffect(() => {
    let isCurrent = true

    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!isCurrent) return
        if (response.status === 401) {
          setAuth({ status: 'anonymous' })
          return
        }
        if (!response.ok) throw new Error('Session check failed')
        const data = await response.json() as { user: AppUser }
        setAuth({ status: 'authenticated', user: data.user })
      })
      .catch(() => {
        if (isCurrent) setAuth({ status: 'unavailable' })
      })

    return () => { isCurrent = false }
  }, [])

  async function signIn(username: string, password: string): Promise<'ok' | 'invalid' | 'limited' | 'unavailable'> {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      if (response.status === 401) return 'invalid'
      if (response.status === 429) return 'limited'
      if (!response.ok) return 'unavailable'

      const data = await response.json() as { user: AppUser }
      setAuth({ status: 'authenticated', user: data.user })
      return 'ok'
    } catch {
      return 'unavailable'
    }
  }

  async function signOut() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    } finally {
      setAuth({ status: 'anonymous' })
      setActiveId('overview')
    }
  }

  if (auth.status === 'checking') {
    return <main className="auth-state"><span className="auth-spinner" /><p>Проверяем вход…</p></main>
  }
  if (auth.status === 'unavailable') {
    return (
      <main className="auth-state">
        <span className="brand-mark" aria-hidden="true"><span>N</span></span>
        <h1>Сервер пока недоступен</h1>
        <p>Запустите локальное API в PowerShell командой <code>npm.cmd run dev:api</code>.</p>
        <button className="auth-submit" onClick={() => window.location.reload()}>Проверить снова</button>
      </main>
    )
  }
  if (auth.status === 'anonymous') return <LoginScreen onSignIn={signIn} />

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => setActiveId('overview')} aria-label="Northordo — обзор">
          <span className="brand-mark" aria-hidden="true"><span>N</span></span>
          <span className="brand-copy"><strong>northordo</strong><small>рабочая среда</small></span>
        </a>

        <div className="sidebar-label">РАБОТА</div>
        <nav className="primary-nav" aria-label="Основная навигация">
          <button className={`nav-item ${activeId === 'overview' ? 'is-active' : ''}`} onClick={() => setActiveId('overview')} aria-current={activeId === 'overview' ? 'page' : undefined}>
            <Icon name="overview" /><span>Обзор</span>
          </button>
          {modules.map((module) => (
            <button key={module.id} className={`nav-item ${activeId === module.id ? 'is-active' : ''}`} onClick={() => { setActiveId(module.id); if (module.id === 'estimates') setEstimateObjectFilter('') }} aria-current={activeId === module.id ? 'page' : undefined}>
              <Icon name={module.id} /><span>{module.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-status"><span className="status-light" /><span><strong>Закрытый доступ</strong><small>серверная сессия активна</small></span></div>
          <div className="sidebar-version">NORTHORDO <span>•</span> РАННЯЯ СБОРКА</div>
        </div>
      </aside>

      <main className="main-area">
        <header className="page-header">
          <div>
            <div className="eyebrow">NORTHORDO <span>/</span> {activeModule ? activeModule.label.toLocaleUpperCase('ru-RU') : 'ОБЗОР'}</div>
            <h1>{activeModule ? activeModule.label : 'Рабочая сводка'}</h1>
            <p>{activeModule ? activeModule.description : 'Состояние рабочей среды компании'}</p>
          </div>
          <div className="header-actions">
            <div className="account-chip"><span>{auth.user.username}</span><small>{auth.user.role}</small></div>
            <button className="logout-button" onClick={() => void signOut()}>Выйти</button>
            <div className="build-badge"><span className="build-badge-dot" />Локальная сборка</div>
          </div>
        </header>

        {activeModule?.id === 'objects' ? (
          <ObjectsPage onOpenEstimates={(objectId) => { setEstimateObjectFilter(objectId); setActiveId('estimates') }} />
        ) : activeModule?.id === 'documents' ? (
          <DocumentsPage />
        ) : activeModule?.id === 'tools' ? (
          <ToolsPage />
        ) : activeModule?.id === 'materials' ? (
          <MaterialsPage />
        ) : activeModule?.id === 'finance' ? (
          <FinancePage />
        ) : activeModule?.id === 'works' ? (
          <WorksPage />
        ) : activeModule?.id === 'estimates' ? (
          <EstimatesPage key={estimateObjectFilter || 'all'} initialObjectFilter={estimateObjectFilter} />
        ) : activeModule ? (
          <section className="module-empty" aria-labelledby="module-empty-title">
            <div className="module-empty-icon"><Icon name={activeModule.id} size={24} /></div>
            <span className="section-kicker">РАЗДЕЛ ГОТОВИТСЯ</span>
            <h2 id="module-empty-title">{activeModule.label}</h2>
            <p>{activeModule.description}</p>
            <div className="notice"><Icon name="info" size={18} /><span>Этот раздел пока не сохраняет рабочие записи. Его функции появятся в следующих этапах.</span></div>
            <button className="text-button" onClick={() => setActiveId('overview')}>Вернуться к обзору <Icon name="arrow" size={16} /></button>
          </section>
        ) : (
          <>
            <OverviewFinance onOpen={() => setActiveId('finance')} />

            <section className="modules-section" aria-labelledby="modules-title">
              <div className="section-heading">
                <div><span className="section-kicker">СТРУКТУРА СИСТЕМЫ</span><h2 id="modules-title">Рабочие разделы</h2></div>
                <span className="section-count">{modules.length} модулей</span>
              </div>
              <div className="module-grid">
                {modules.map((module) => (
                  <button key={module.id} className="module-card" onClick={() => { setActiveId(module.id); if (module.id === 'estimates') setEstimateObjectFilter('') }}>
                    <span className="module-card-icon"><Icon name={module.id} size={20} /></span>
                    <span className="module-card-copy"><strong>{module.label}</strong><small>{module.description}</small></span>
                    <span className="module-card-footer"><Icon name="arrow" size={16} /></span>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        <footer className="page-footer"><span>Northordo · Рабочая среда в разработке</span><span>Локально на этом компьютере</span></footer>
      </main>
    </div>
  )
}

function LoginScreen({ onSignIn }: {
  onSignIn: (username: string, password: string) => Promise<'ok' | 'invalid' | 'limited' | 'unavailable'>
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'invalid' | 'limited' | 'unavailable'>('idle')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus('submitting')
    const result = await onSignIn(username, password)
    if (result === 'ok') return
    setPassword('')
    setStatus(result)
  }

  const errorMessage = status === 'invalid'
    ? 'Не удалось войти. Проверьте логин и пароль.'
    : status === 'limited'
      ? 'Слишком много попыток. Подождите минуту и попробуйте снова.'
      : status === 'unavailable'
        ? 'Не удалось связаться с сервером. Проверьте, запущено ли API.'
        : null

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <a className="login-brand" href="#login" aria-label="Northordo">
          <span className="brand-mark" aria-hidden="true"><span>N</span></span>
          <span className="brand-copy"><strong>northordo</strong><small>рабочая среда</small></span>
        </a>
        <span className="section-kicker">ЗАКРЫТАЯ СИСТЕМА</span>
        <h1 id="login-title">Вход в Northordo</h1>
        <p className="login-intro">Используйте свою учётную запись OWNER или ADMIN.</p>
        <form className="login-form" onSubmit={(event) => void handleSubmit(event)}>
          <label htmlFor="login-username">Логин</label>
          <input
            id="login-username"
            name="username"
            autoComplete="username"
            maxLength={64}
            required
            value={username}
            onChange={(event) => { setUsername(event.target.value); setStatus('idle') }}
          />
          <label htmlFor="login-password">Пароль</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            required
            value={password}
            onChange={(event) => { setPassword(event.target.value); setStatus('idle') }}
          />
          {errorMessage && <p className="login-error" role="alert">{errorMessage}</p>}
          <button className="auth-submit" type="submit" disabled={status === 'submitting'}>
            {status === 'submitting' ? 'Проверяем…' : 'Войти'}
          </button>
        </form>
        <p className="login-footnote">Первая учётная запись OWNER создаётся один раз из локальной консоли.</p>
      </section>
    </main>
  )
}

export default App
