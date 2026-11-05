import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { categories, entryInput, getHistory, listFinance, money, saveEntry, today,
  type Entry, type EntryInput, type Filters, type FinanceData, type HistoryEvent, type Kind } from './api'
import './FinancePage.css'
import { FinancePlanning } from './FinancePlanning'

type Dialog = { type: 'form'; entry?: Entry } | { type: 'void' | 'history'; entry: Entry }
const empty: FinanceData = { entries: [], objects: [], totals: { income: '0', expense: '0', net: '0' } }
function dateLabel(value: string) { return value.split('-').reverse().join('.') }

export function FinancePage() {
  const [filters, setFilters] = useState<Filters>(() => ({ from: today().slice(0, 7) + '-01', to: today(), kind: '', objectId: '', includeVoided: false }))
  const [data, setData] = useState<FinanceData>(empty)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [dialog, setDialog] = useState<Dialog | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    listFinance(filters, controller.signal)
      .then(setData)
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить финансы.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [filters, refresh])

  function reload() { setLoading(true); setError(''); setRefresh((value) => value + 1) }
  function changeFilters(next: Filters) { setLoading(true); setError(''); setFilters(next) }
  function saved(message: string) { setDialog(null); setNotice(message); reload() }

  return (
    <section className="finance-page" aria-label="Финансовые операции">
      <FinancePlanning onChange={reload} />
      <div className="finance-heading">
        <div><span className="section-kicker">ДВИЖЕНИЕ ДЕНЕГ · РУБЛИ</span><h2>Поступления и расходы</h2><p>Сводка по записанным операциям за выбранный период.</p></div>
        <button className="primary-action" onClick={() => setDialog({ type: 'form' })}>+ Добавить операцию</button>
      </div>
      <div className="finance-filters">
        <label className="form-field">С даты<input type="date" min="1000-01-01" max="9999-12-31" value={filters.from} onChange={(e) => changeFilters({ ...filters, from: e.target.value })} /></label>
        <label className="form-field">По дату<input type="date" min="1000-01-01" max="9999-12-31" value={filters.to} onChange={(e) => changeFilters({ ...filters, to: e.target.value })} /></label>
        <label className="form-field">Тип<select value={filters.kind} onChange={(e) => changeFilters({ ...filters, kind: e.target.value })}><option value="">Все операции</option><option value="INCOME">Поступления</option><option value="EXPENSE">Расходы</option></select></label>
        <label className="form-field">Объект<select value={filters.objectId} onChange={(e) => changeFilters({ ...filters, objectId: e.target.value })}><option value="">Все объекты</option><option value="none">Без объекта</option>{data.objects.map((o) => <option key={o.id} value={o.id}>{o.name}{o.archived ? ' · удалён' : ''}</option>)}</select></label>
      </div>
      <div className="finance-subfilters"><label><input type="checkbox" checked={filters.includeVoided} onChange={(e) => changeFilters({ ...filters, includeVoided: e.target.checked })} /> Показывать аннулированные</label><button className="secondary-action" onClick={() => changeFilters({ from: '', to: '', kind: '', objectId: '', includeVoided: false })}>За всё время</button></div>
      {notice && <p className="objects-notice" role="status">{notice}</p>}
      {error && <div className="objects-error" role="alert"><span>{error}</span><button onClick={reload}>Обновить</button></div>}
      {loading ? <p role="status">Загружаем операции…</p> : !error && <>
        <div className="finance-totals">
          <div><span>Поступления</span><strong>{money(data.totals.income)}</strong></div>
          <div><span>Расходы</span><strong>{money(data.totals.expense)}</strong></div>
          <div><span>Разница поступлений и расходов</span><strong>{money(data.totals.net)}</strong></div>
        </div>
        <p className="finance-caption">Аннулированные операции исключены из сводки. Операции удалённых объектов учитываются.</p>
        {data.entries.length === 0 ? <div className="finance-empty"><h3>Операций за этот период нет</h3><p>Добавьте поступление или расход либо измените фильтры.</p></div> : <ul className="finance-list">
          {data.entries.map((entry) => <li key={entry.id} className={entry.voided ? 'finance-entry is-voided' : 'finance-entry'}>
            <div className="finance-entry-copy">
              <div className="finance-entry-meta"><span className={'finance-kind ' + entry.kind.toLowerCase()}>{entry.kind === 'INCOME' ? 'Поступление' : 'Расход'}</span><span>{dateLabel(entry.date)}</span>{entry.voided && <b>Аннулирована</b>}</div>
              <h3>{categories[entry.kind][entry.category]}</h3><p>{entry.objectName ?? 'Общая операция'}{entry.objectArchived ? ' · объект удалён' : ''}</p>
              {entry.note && <p className="finance-note">{entry.note}</p>}
            </div>
            <div className="finance-entry-side"><strong>{entry.kind === 'EXPENSE' ? '−' : '+'}{money(entry.amount)}</strong>
              <div className="finance-entry-actions">{!entry.linkedPlan && <button onClick={() => setDialog({ type: 'form', entry })}>Изменить</button>}<button onClick={() => setDialog({ type: 'history', entry })}>История</button>{!entry.linkedPlan && <button onClick={() => setDialog({ type: 'void', entry })}>{entry.voided ? 'Восстановить' : 'Аннулировать'}</button>}</div>{entry.linkedPlan && <small>Изменяется через план</small>}
            </div>
          </li>)}
        </ul>}
      </>}
      {dialog?.type === 'form' && <EntryForm entry={dialog.entry} objects={data.objects} onClose={() => setDialog(null)} onSaved={() => saved('Операция сохранена. Список показан за выбранный период.')} />}
      {dialog?.type === 'void' && <VoidForm entry={dialog.entry} onClose={() => setDialog(null)} onSaved={() => saved(dialog.entry.voided ? 'Операция восстановлена.' : 'Операция аннулирована и исключена из сводки.')} />}
      {dialog?.type === 'history' && <History entry={dialog.entry} onClose={() => setDialog(null)} />}
    </section>
  )
}

function Modal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (!ref.current?.open) ref.current?.showModal() }, [])
  return <dialog ref={ref} className="dialog-card finance-dialog" aria-label={title} onClose={onClose} onCancel={(e) => { if (busy) e.preventDefault() }}>
    <header className="dialog-header"><h2>{title}</h2><button className="dialog-close" disabled={busy} aria-label="Закрыть" onClick={() => ref.current?.close()}>×</button></header>{children}
  </dialog>
}

function EntryForm({ entry, objects, onClose, onSaved }: { entry?: Entry; objects: FinanceData['objects']; onClose: () => void; onSaved: () => void }) {
  const [requestId] = useState(() => crypto.randomUUID())
  const [input, setInput] = useState<EntryInput>(() => entry ? entryInput(entry) : { kind: 'INCOME', amount: '', date: today(), category: 'ADVANCE', objectId: null, note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try { await saveEntry(input, entry, entry?.voided ?? false, requestId); onSaved() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить операцию.') } finally { setBusy(false) }
  }
  return <Modal title={entry ? 'Изменить операцию' : 'Новая операция'} busy={busy} onClose={onClose}>
    {entry?.voided && <p className="finance-caption">Операция аннулирована. Исправление сохранится, для включения в сводку восстановите её.</p>}
    <form onSubmit={(e) => void submit(e)}><fieldset disabled={busy} className="finance-form">
      <label className="form-field">Тип<select value={input.kind} onChange={(e) => { const kind = e.target.value as Kind; setInput({ ...input, kind, category: Object.keys(categories[kind])[0] }) }}><option value="INCOME">Поступление</option><option value="EXPENSE">Расход</option></select></label>
      <label className="form-field">Категория<select value={input.category} onChange={(e) => setInput({ ...input, category: e.target.value })}>{Object.entries(categories[input.kind]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="form-field">Сумма, ₽<input autoFocus required inputMode="decimal" maxLength={15} value={input.amount} onChange={(e) => setInput({ ...input, amount: e.target.value })} placeholder="0,00" /></label>
      <label className="form-field">Дата<input required type="date" min="1000-01-01" max="9999-12-31" value={input.date} onChange={(e) => setInput({ ...input, date: e.target.value })} /></label>
      <label className="form-field finance-form-wide">Объект<select value={input.objectId ?? ''} onChange={(e) => setInput({ ...input, objectId: e.target.value || null })}><option value="">Общая операция, без объекта</option>{objects.filter((o) => !o.archived || o.id === entry?.objectId).map((o) => <option key={o.id} value={o.id}>{o.name}{o.archived ? ' · удалён' : ''}</option>)}</select></label>
      <label className="form-field finance-form-wide">Комментарий<textarea maxLength={1000} rows={3} value={input.note} onChange={(e) => setInput({ ...input, note: e.target.value })} /></label>
    </fieldset>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary-action" disabled={busy} onClick={onClose}>Отмена</button><button className="primary-action" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</button></div></form>
  </Modal>
}

function VoidForm({ entry, onClose, onSaved }: { entry: Entry; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function confirm() {
    setBusy(true)
    try { await saveEntry(entryInput(entry), entry, !entry.voided); onSaved() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось изменить операцию.') } finally { setBusy(false) }
  }
  return <Modal title={entry.voided ? 'Восстановить операцию' : 'Аннулировать операцию'} busy={busy} onClose={onClose}>
    <p>{categories[entry.kind][entry.category]} · {money(entry.amount)} · {dateLabel(entry.date)}</p>
    <p>{entry.voided ? 'Операция снова будет учитываться в сводке.' : 'Операция будет исключена из сводки. Запись и история сохранятся.'}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button className="secondary-action" disabled={busy} onClick={onClose}>Отмена</button><button className="primary-action" disabled={busy} onClick={() => void confirm()}>{busy ? 'Сохраняем…' : entry.voided ? 'Восстановить' : 'Аннулировать'}</button></div>
  </Modal>
}

function History({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const [events, setEvents] = useState<HistoryEvent[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    getHistory(entry.id).then((result) => { if (active) setEvents(result) }).catch(() => { if (active) setError('Не удалось загрузить историю.') })
    return () => { active = false }
  }, [entry.id])
  const actions: Record<string, string> = { CREATE: 'Создание', EDIT: 'Изменение', VOID: 'Аннулирование', RESTORE: 'Восстановление' }
  const fields: Record<string, string> = { kind: 'тип', amount: 'сумма', date: 'дата', category: 'категория', objectId: 'объект', note: 'комментарий', voided: 'учёт в сводке' }
  return <Modal title="История операции" onClose={onClose}>
    {error && <p role="alert">{error}</p>}{!events && !error && <p>Загружаем историю…</p>}
    <ol className="finance-history">{events?.map((event) => <li key={event.revision}><strong>{actions[event.action]}</strong><span>{event.actor} · {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(event.occurredAt))}</span><small>{event.changedFields.map((field) => fields[field] ?? field).join(', ')}</small></li>)}</ol>
  </Modal>
}
