import { useEffect, useRef, useState, type FormEvent } from 'react'
import { categories, money, today, type Kind } from './api'
import './FinancePlanning.css'

type Settings = { budget: string | null; budgetFrom: string | null; budgetTo: string | null; openingBalance: string | null; openingDate: string | null; revision: number }
type Plan = { id: string; kind: Kind; amount: string; date: string; category: string; objectId: string | null; objectName: string | null; note: string; status: 'PLANNED' | 'SETTLED' | 'CANCELLED'; revision: number }
type ObjectSummary = { id: string; name: string; income: string; expense: string; net: string; gapDate: string | null; lowestBalance: string; overdue: number; planned: number }
type Data = { settings: Settings; plans: Plan[]; objects: { id: string; name: string; archived: boolean }[]; objectSummaries: ObjectSummary[]; summary: { spent: string; budgetRemaining: string | null; cash: string | null; gapDate: string | null; lowestBalance: string | null; overdue: number; planned: number; today: string } }
const labelDate = (value: string) => value.split('-').reverse().join('.')
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch('/api/finance-planning' + path, { credentials: 'same-origin', ...options })
  if (response.status === 401) { window.location.reload(); throw new Error('Сессия завершилась.') }
  if (response.status === 409) throw new Error('Данные изменились или указана будущая дата остатка. Обновите страницу и проверьте ввод.')
  if (!response.ok) throw new Error('Не удалось сохранить. Проверьте суммы, даты и доступность объекта.')
  return response.json() as Promise<T>
}
const put = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const norm = (value: string) => value.trim().replace(',', '.')

function usePlanning() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  async function load() { try { setData(await api<Data>('/')); setError('') } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось загрузить сводку.') } }
  useEffect(() => { void load() }, [])
  return { data, error, setError, load }
}

export function OverviewFinance({ onOpen }: { onOpen: () => void }) {
  const { data, error, load } = usePlanning()
  const [selected, setSelected] = useState('')
  const touchStart = useRef<number | null>(null)
  const cards = data ? [{ id: '', name: 'Вся компания' }, ...data.objectSummaries] : []
  const found = cards.findIndex((card) => card.id === selected)
  const index = Math.max(found, 0)
  const object = data?.objectSummaries.find((item) => item.id === selected)
  function move(delta: number) {
    if (!cards.length) return
    setSelected(cards[(index + delta + cards.length) % cards.length].id)
  }
  return <section className="planning-overview" aria-label="Финансовая сводка">
    <div className="planning-overview-heading"><div><span className="section-kicker">РАБОЧАЯ СВОДКА</span><h2>Финансы и риски</h2></div><button className="secondary-action" onClick={onOpen}>Открыть финансы</button></div>
    {error ? <div className="objects-error" role="alert">{error} <button onClick={() => void load()}>Повторить</button></div> : !data ? <p>Загружаем сводку…</p> : <>
      <div className="overview-switcher">
        <button className="secondary-action" aria-label="Предыдущая сводка" disabled={cards.length < 2} onClick={() => move(-1)}>←</button>
        <label className="overview-object-select"><span>Сводка</span><select aria-label="Выбрать объект для сводки" value={found < 0 ? '' : selected} onChange={(e) => setSelected(e.target.value)}>{cards.map((card) => <option key={card.id || 'company'} value={card.id}>{card.name}</option>)}</select></label>
        <span className="overview-counter" aria-live="polite">{index + 1} / {cards.length}</span>
        <button className="secondary-action" aria-label="Следующая сводка" disabled={cards.length < 2} onClick={() => move(1)}>→</button>
      </div>
      <div onTouchStart={(e) => { touchStart.current = e.touches[0]?.clientX ?? null }} onTouchEnd={(e) => { const end = e.changedTouches[0]?.clientX; if (touchStart.current !== null && end !== undefined && Math.abs(end - touchStart.current) > 60) move(end < touchStart.current ? 1 : -1); touchStart.current = null }}>
        {object ? <ObjectSummaryCards object={object} /> : <Summary data={data} />}
      </div>
      <p className="planning-caption">{object ? 'Только операции и планы, привязанные к объекту. Разница и её прогноз не показывают общий остаток компании и не включают её начальные деньги или общий бюджет.' : 'Остаток и прогноз зависят от полноты финансовых записей.'} Поступления и выплаты одного дня считаются вместе; время платежей не учитывается.</p>
    </>}
  </section>
}

function ObjectSummaryCards({ object }: { object: ObjectSummary }) {
  const empty = object.planned === 0 && /^0(?:\.0+)?$/.test(object.income) && /^0(?:\.0+)?$/.test(object.expense)
  return <div className="planning-summary" aria-live="polite">
    <div><span>Поступления по объекту</span><strong>{money(object.income)}</strong><small>Фактически записано</small></div>
    <div><span>Расходы по объекту</span><strong>{money(object.expense)}</strong><small>Фактически записано</small></div>
    <div><span>Разница по объекту</span><strong>{money(object.net)}</strong><small>Поступления минус расходы</small></div>
    <div className={empty ? '' : object.gapDate ? 'risk-alert' : 'risk-ok'}><span>Риск нехватки по объекту</span><strong>{empty ? 'Нет данных' : object.gapDate ? 'С ' + labelDate(object.gapDate) : 'Не выявлен'}</strong><small>{empty ? 'Добавьте операции или планы' : object.gapDate ? 'Минимальная разница: ' + money(object.lowestBalance) : 'По внесённым планам'}{object.overdue ? ' · просрочено: ' + object.overdue : ''}</small></div>
  </div>
}

function Summary({ data }: { data: Data }) {
  const { settings: s, summary: v } = data
  return <div className="planning-summary">
    <div><span>Выделенный бюджет</span><strong>{s.budget === null ? 'Не задан' : money(s.budget)}</strong><small>{s.budgetFrom && s.budgetTo ? labelDate(s.budgetFrom) + ' — ' + labelDate(s.budgetTo) : 'Задайте сумму и период'}</small></div>
    <div><span>Расходы / остаток бюджета</span><strong>{s.budget === null ? '—' : money(v.spent)}</strong><small>{v.budgetRemaining === null ? 'Нужен бюджет' : 'Остаток: ' + money(v.budgetRemaining)}</small></div>
    <div><span>Расчётный остаток</span><strong>{v.cash === null ? '—' : money(v.cash)}</strong><small>{s.openingBalance === null ? 'По всем записанным операциям' : 'Начальный остаток и операции'}</small></div>
    <div className={v.cash === null ? '' : v.gapDate ? 'risk-alert' : 'risk-ok'}><span>Риск кассового разрыва</span><strong>{v.cash === null ? 'Нужен остаток' : v.gapDate ? 'Нехватка ' + labelDate(v.gapDate) : 'Не выявлен'}</strong><small>{v.cash === null ? 'Укажите остаток в финансах' : v.gapDate && v.lowestBalance ? 'Минимум: ' + money(v.lowestBalance) : 'По внесённым планам'}{v.overdue ? ' · просрочено: ' + v.overdue : ''}</small></div>
  </div>
}

export function FinancePlanning({ onChange }: { onChange: () => void }) {
  const { data, error, setError, load } = usePlanning()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [settling, setSettling] = useState<Plan | null>(null)
  const [actualDate, setActualDate] = useState(today())
  const [actualAmount, setActualAmount] = useState('')
  const [busy, setBusy] = useState(false)
  async function action(plan: Plan, actionName: 'SETTLE' | 'CANCEL' | 'REOPEN', dateValue = today(), amountValue = plan.amount) {
    if (busy) return
    setBusy(true); setError('')
    try {
      await api('/plans/' + plan.id + '/action', put({ revision: plan.revision, action: actionName, date: dateValue, amount: norm(amountValue) }))
      setSettling(null); await load(); onChange()
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось выполнить действие.') } finally { setBusy(false) }
  }
  return <section className="planning-block" aria-labelledby="planning-title">
    <div className="planning-overview-heading"><div><span className="section-kicker">БЮДЖЕТ И ДЕНЕЖНЫЙ ПЛАН</span><h2 id="planning-title">Планирование финансов</h2><p>Бюджет — лимит расходов, доступные деньги указываются отдельно.</p></div><button className="secondary-action" onClick={() => setSettingsOpen(!settingsOpen)}>{settingsOpen ? 'Закрыть настройки' : 'Настроить бюджет и остаток'}</button></div>
    {error && <p className="objects-error" role="alert">{error} <button onClick={() => void load()}>Обновить</button></p>}
    {!data ? <p>Загружаем финансовый план…</p> : <>
      <Summary data={data} />
      {settingsOpen && <SettingsForm key={data.settings.revision} settings={data.settings} onSaved={async () => { setSettingsOpen(false); await load(); onChange() }} />}
      <div className="planning-list-heading"><div><h3>Плановые поступления и выплаты</h3><p>После оплаты проведите план: фактическая операция создастся автоматически.</p></div><button className="primary-action" onClick={() => setPlanOpen(!planOpen)}>{planOpen ? 'Закрыть форму' : '+ Добавить план'}</button></div>
      {planOpen && <PlanForm objects={data.objects} onSaved={async () => { setPlanOpen(false); await load(); onChange() }} />}
      {data.plans.length === 0 ? <p className="planning-caption">Пока нет запланированных операций.</p> : <ul className="planning-list">{data.plans.map((plan) => <li key={plan.id}>
        <div><strong>{plan.kind === 'INCOME' ? 'Поступление' : 'Выплата'} · {money(plan.amount)}</strong><p>{labelDate(plan.date)} · {categories[plan.kind][plan.category]} · {plan.objectName ?? 'Без объекта'}{plan.note ? ' · ' + plan.note : ''}</p><small>{plan.status === 'SETTLED' ? 'Проведено' : plan.status === 'CANCELLED' ? 'Отменено' : plan.date < data.summary.today ? 'Просрочено' : 'Запланировано'}</small></div>
        <div className="planning-actions">{plan.status === 'PLANNED' && <><button className="secondary-action" disabled={busy} onClick={() => { setActualDate(today()); setActualAmount(plan.amount); setSettling(plan) }}>Провести</button><button className="secondary-action" disabled={busy} onClick={() => { if (window.confirm('Отменить этот план? Он исчезнет из прогноза.')) void action(plan, 'CANCEL') }}>Отменить</button></>}{plan.status === 'SETTLED' && <button className="secondary-action" disabled={busy} onClick={() => { if (window.confirm('Вернуть в план? Связанная фактическая операция будет аннулирована.')) void action(plan, 'REOPEN') }}>Вернуть в план</button>}</div>
        {settling?.id === plan.id && <form className="planning-settle" onSubmit={(e) => { e.preventDefault(); void action(plan, 'SETTLE', actualDate, actualAmount) }}><label className="form-field">Фактическая дата<input required type="date" max={today()} value={actualDate} onChange={(e) => setActualDate(e.target.value)} /></label><label className="form-field">Фактическая сумма, ₽<input required value={actualAmount} inputMode="decimal" onChange={(e) => setActualAmount(e.target.value)} /></label><button className="primary-action" disabled={busy}>Подтвердить проведение</button><button type="button" className="secondary-action" onClick={() => setSettling(null)}>Закрыть</button></form>}
      </li>)}</ul>}
      <p className="planning-caption">Просроченные планы учитываются на сегодня. Если вы внесли тот же платёж вручную, отмените соответствующий план, чтобы избежать двойного учёта. Прогноз зависит от полноты введённых данных.</p>
    </>}
  </section>
}

function SettingsForm({ settings, onSaved }: { settings: Settings; onSaved: () => Promise<void> }) {
  const [b, setB] = useState(settings.budget ?? '')
  const [from, setFrom] = useState(settings.budgetFrom ?? '')
  const [to, setTo] = useState(settings.budgetTo ?? '')
  const [cash, setCash] = useState(settings.openingBalance ?? '')
  const [date, setDate] = useState(settings.openingDate ?? today())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(e: FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError('')
    try { await api('/settings', put({ budget: b.trim() ? norm(b) : null, budgetFrom: b.trim() ? from : null, budgetTo: b.trim() ? to : null, openingBalance: cash.trim() ? norm(cash) : null, openingDate: cash.trim() ? date : null, revision: settings.revision }, 'PUT')); await onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка сохранения.') } finally { setBusy(false) }
  }
  return <form className="planning-form" onSubmit={(e) => void save(e)}><h3>Бюджет и остаток</h3><p>Остаток считается автоматически по операциям. Если деньги были до начала учёта, укажите начальный остаток на начало даты, до операций этого дня. Операции с этой даты по сегодня добавляются автоматически.</p>
    <div className="planning-fields"><label className="form-field">Бюджет, ₽<input inputMode="decimal" value={b} onChange={(e) => setB(e.target.value)} placeholder="Не задан" /></label><label className="form-field">Начало периода<input type="date" required={!!b.trim()} value={from} onChange={(e) => setFrom(e.target.value)} /></label><label className="form-field">Конец периода<input type="date" required={!!b.trim()} value={to} onChange={(e) => setTo(e.target.value)} /></label><label className="form-field">Начальный остаток, ₽ (необязательно)<input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="По умолчанию 0" /></label><label className="form-field">Остаток на начало даты<input type="date" max={today()} required={!!cash.trim()} value={date} onChange={(e) => setDate(e.target.value)} /></label></div>
    {error && <p className="form-error" role="alert">{error}</p>}<button className="primary-action" disabled={busy}>Сохранить настройки</button></form>
}

function PlanForm({ objects, onSaved }: { objects: Data['objects']; onSaved: () => Promise<void> }) {
  const [kind, setKind] = useState<Kind>('INCOME')
  const [amountValue, setAmount] = useState('')
  const [dateValue, setDate] = useState(today())
  const [category, setCategory] = useState('ADVANCE')
  const [objectId, setObjectId] = useState('')
  const [note, setNote] = useState('')
  const [requestId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: FormEvent) { e.preventDefault(); if (busy) return; setBusy(true); setError('')
    try { await api('/plans', put({ kind, amount: norm(amountValue), date: dateValue, category, objectId: objectId || null, note, requestId })); await onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка сохранения.') } finally { setBusy(false) }
  }
  return <form className="planning-form" onSubmit={(e) => void save(e)}><h3>Новая плановая операция</h3><div className="planning-fields">
    <label className="form-field">Тип<select value={kind} onChange={(e) => { const next = e.target.value as Kind; setKind(next); setCategory(Object.keys(categories[next])[0]) }}><option value="INCOME">Поступление</option><option value="EXPENSE">Выплата</option></select></label>
    <label className="form-field">Сумма, ₽<input required inputMode="decimal" value={amountValue} onChange={(e) => setAmount(e.target.value)} /></label>
    <label className="form-field">Плановая дата<input required type="date" value={dateValue} onChange={(e) => setDate(e.target.value)} /></label>
    <label className="form-field">Категория<select value={category} onChange={(e) => setCategory(e.target.value)}>{Object.entries(categories[kind]).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
    <label className="form-field">Объект<select value={objectId} onChange={(e) => setObjectId(e.target.value)}><option value="">Без объекта</option>{objects.filter((o) => !o.archived).map((o) => <option value={o.id} key={o.id}>{o.name}</option>)}</select></label>
    <label className="form-field">Комментарий<input maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label></div>
    {error && <p className="form-error" role="alert">{error}</p>}<button className="primary-action" disabled={busy}>Сохранить план</button></form>
}
