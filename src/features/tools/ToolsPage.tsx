import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { listTools, saveTool, toolInput, getToolHistory, types, statuses, conditions, locations, place,
  type Tool, type ToolInput, type ToolEvent, type ObjectOption } from './api'
import './ToolsPage.css'

type Dialog = { kind: 'form'; tool?: Tool } | { kind: 'detail'; tool: Tool }
function dateLabel(value: string) { return value.split('-').reverse().join('.') }
function options(values: Record<string,string>) { return Object.entries(values).map(([key,label]) => <option key={key} value={key}>{label}</option>) }

export function ToolsPage() {
  const [items, setItems] = useState<Tool[]>([])
  const [objects, setObjects] = useState<ObjectOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [objectId, setObjectId] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    listTools(controller.signal).then((data) => {
      if (!controller.signal.aborted) { setItems(data.items); setObjects(data.objects) }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить инструменты.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [refresh])

  function reload() { setLoading(true); setError(''); setRefresh((value) => value + 1) }
  function saved() { setDialog(null); setNotice('Карточка сохранена. Местонахождение и состояние записаны в историю.'); reload() }
  const needle = search.trim().toLocaleLowerCase('ru-RU')
  const visible = items.filter((item) => (!type || item.type === type) && (!status || item.status === status) &&
    (!objectId || (objectId === 'WAREHOUSE' ? item.location === 'WAREHOUSE' : objectId === 'OTHER' ? item.location === 'OTHER' : item.objectId === objectId)) &&
    [item.name,item.inventoryCode,item.model,item.serialNumber,item.responsible].some((value) => value.toLocaleLowerCase('ru-RU').includes(needle)))
  return <section className="tools-page" aria-label="Учёт инструментов">
    <div className="tools-heading"><div><span className="section-kicker">ИНВЕНТАРЬ КОМАНДЫ</span><h2>Инструменты и оборудование</h2><p>Кто отвечает, где находится и в каком состоянии каждый инструмент.</p></div><button className="primary-action" onClick={() => setDialog({ kind: 'form' })}>+ Новый инструмент</button></div>
    <div className="tools-stats"><span>Всего в каталоге <b>{items.length}</b></span><span>В работе <b>{items.filter((item) => item.status === 'IN_USE').length}</b></span><span>На обслуживании <b>{items.filter((item) => item.status === 'REPAIR').length}</b></span></div>
    <div className="tools-filters">
      <label className="form-field tools-search">Поиск<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Название, номер, модель или ответственный" /></label>
      <label className="form-field">Тип<select value={type} onChange={(e) => setType(e.target.value)}><option value="">Все типы</option>{options(types)}</select></label>
      <label className="form-field">Статус<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Все статусы</option>{options(statuses)}</select></label>
      <label className="form-field">Местонахождение<select value={objectId} onChange={(e) => setObjectId(e.target.value)}><option value="">Все места</option><option value="WAREHOUSE">Общий склад</option><option value="OTHER">Другое место</option>{objects.map((object) => <option key={object.id} value={object.id}>{object.name}{object.archived ? ' · удалён' : ''}</option>)}</select></label>
    </div>
    {notice && <p className="objects-notice" role="status">{notice}</p>}
    {error && <div className="objects-error" role="alert"><span>{error}</span><button onClick={reload}>Обновить</button></div>}
    {loading ? <p role="status">Загружаем инструменты…</p> : !error && (visible.length ? <ul className="tools-list">
      {visible.map((tool) => <li key={tool.id} className={'tool-card tool-' + tool.status.toLowerCase()}>
        <div className="tool-copy"><div className="tool-meta"><span className="tool-code">{tool.inventoryCode}</span><span>{types[tool.type]}</span><b>{statuses[tool.status]}</b></div>
          <h3><button className="tool-name" onClick={() => setDialog({ kind: 'detail', tool })}>{tool.name}</button></h3>
          {tool.model && <p>{tool.model}</p>}
          <div className="tool-info"><span>{tool.status === 'LOST' ? 'Последнее известное место' : 'Местонахождение'}</span><strong>{place(tool)}{tool.objectArchived ? ' · объект удалён' : ''}</strong><span>Ответственный</span><strong>{tool.responsible || 'Не назначен'}</strong></div>
          <div className="tool-footer"><span>{conditions[tool.condition]}</span>{tool.serviceDate && <span>Обслуживание · {dateLabel(tool.serviceDate)}</span>}</div>
        </div>
        <div className="tool-actions"><button className="primary-action" onClick={() => setDialog({ kind: 'form', tool })}>Изменить / переместить</button><button className="secondary-action" onClick={() => setDialog({ kind: 'detail', tool })}>Карточка и история</button></div>
      </li>)}
    </ul> : <div className="tools-empty"><h3>{items.length ? 'Ничего не найдено' : 'Инструментов пока нет'}</h3><p>{items.length ? 'Измените поиск или фильтры.' : 'Создайте карточку для каждого инструмента. Инвентарный номер будет присвоен автоматически.'}</p></div>)}
    {dialog?.kind === 'form' && <ToolForm tool={dialog.tool} objects={objects} onClose={() => setDialog(null)} onSaved={saved} />}
    {dialog?.kind === 'detail' && <ToolDetail tool={dialog.tool} onClose={() => setDialog(null)} onEdit={() => setDialog({ kind: 'form', tool: dialog.tool })} />}
  </section>
}

function Modal({ title, children, busy = false, onClose }: { title: string; children: ReactNode; busy?: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (!ref.current?.open) ref.current?.showModal() }, [])
  return <dialog ref={ref} className="dialog-card tools-dialog" aria-label={title} onClose={onClose} onCancel={(e) => { if (busy) e.preventDefault() }}>
    <header className="dialog-header"><h2>{title}</h2><button className="dialog-close" disabled={busy} aria-label="Закрыть" onClick={() => ref.current?.close()}>×</button></header>{children}
  </dialog>
}

function ToolForm({ tool, objects, onClose, onSaved }: { tool?: Tool; objects: ObjectOption[]; onClose: () => void; onSaved: () => void }) {
  const [input, setInput] = useState<ToolInput>(() => tool ? toolInput(tool) : {
    name: '', type: 'POWER', status: 'AVAILABLE', condition: 'GOOD', location: 'WAREHOUSE', objectId: null,
    locationNote: '', responsible: '', model: '', serialNumber: '', serviceDate: null, note: '',
  })
  const [requestId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try { await saveTool(input, requestId, tool); onSaved() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить инструмент.') } finally { setBusy(false) }
  }
  return <Modal title={tool ? 'Изменить инструмент' : 'Новый инструмент'} busy={busy} onClose={onClose}>
    <p className="tools-caption">{tool ? tool.inventoryCode : 'Одна карточка учитывает один инструмент. Инвентарный номер присвоится автоматически.'}</p>
    <form onSubmit={(e) => void submit(e)}><fieldset disabled={busy} className="tools-form">
      <label className="form-field tools-wide">Название<input autoFocus required maxLength={160} value={input.name} onChange={(e) => setInput({ ...input, name: e.target.value })} /></label>
      <label className="form-field">Тип<select value={input.type} onChange={(e) => setInput({ ...input, type: e.target.value as ToolInput['type'] })}>{options(types)}</select></label>
      <label className="form-field">Статус<select value={input.status} onChange={(e) => setInput({ ...input, status: e.target.value as ToolInput['status'] })}>{options(statuses)}</select></label>
      <label className="form-field">Состояние<select value={input.condition} onChange={(e) => setInput({ ...input, condition: e.target.value as ToolInput['condition'] })}>{options(conditions)}</select></label>
      <label className="form-field">Следующее обслуживание<input type="date" min="1000-01-01" max="9999-12-31" value={input.serviceDate ?? ''} onChange={(e) => setInput({ ...input, serviceDate: e.target.value || null })} /></label>
      <div className="tools-form-section">МЕСТОНАХОЖДЕНИЕ И ОТВЕТСТВЕННЫЙ</div>
      <label className="form-field">Место<select value={input.location} onChange={(e) => setInput({ ...input, location: e.target.value as ToolInput['location'], objectId: null, locationNote: '' })}>{options(locations)}</select></label>
      {input.location === 'OBJECT' && <label className="form-field">Объект<select required value={input.objectId ?? ''} onChange={(e) => setInput({ ...input, objectId: e.target.value || null })}><option value="">Выберите объект</option>{objects.filter((object) => !object.archived || object.id === tool?.objectId).map((object) => <option key={object.id} value={object.id}>{object.name}{object.archived ? ' · удалён' : ''}</option>)}</select></label>}
      <label className="form-field tools-wide">{input.location === 'OTHER' ? 'Где находится — обязательно' : 'Уточнение места'}<input required={input.location === 'OTHER'} maxLength={240} value={input.locationNote} onChange={(e) => setInput({ ...input, locationNote: e.target.value })} placeholder="Мастерская, помещение или полка" /></label>
      {input.status === 'LOST' && <p className="tools-caption tools-wide">Укажите последнее известное местонахождение инструмента.</p>}
      <label className="form-field tools-wide">Ответственный<input maxLength={120} value={input.responsible} onChange={(e) => setInput({ ...input, responsible: e.target.value })} placeholder="Имя или понятное команде обозначение" /></label>
      <div className="tools-form-section">ДОПОЛНИТЕЛЬНО</div>
      <label className="form-field">Марка / модель<input maxLength={120} value={input.model} onChange={(e) => setInput({ ...input, model: e.target.value })} /></label>
      <label className="form-field">Серийный номер<input maxLength={120} value={input.serialNumber} onChange={(e) => setInput({ ...input, serialNumber: e.target.value })} /></label>
      <label className="form-field tools-wide">Примечание<textarea maxLength={1000} rows={3} value={input.note} onChange={(e) => setInput({ ...input, note: e.target.value })} /></label>
    </fieldset>{error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button className="secondary-action" type="button" disabled={busy} onClick={onClose}>Отмена</button><button className="primary-action" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</button></div></form>
  </Modal>
}
const fieldLabels: Record<string,string> = {
  name: 'Название', type: 'Тип', status: 'Статус', condition: 'Состояние', location: 'Место', objectId: 'Объект',
  locationNote: 'Уточнение места', responsible: 'Ответственный', model: 'Модель', serialNumber: 'Серийный номер', serviceDate: 'Обслуживание', note: 'Примечание',
}
function ToolDetail({ tool, onClose, onEdit }: { tool: Tool; onClose: () => void; onEdit: () => void }) {
  const [history, setHistory] = useState<ToolEvent[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    getToolHistory(tool.id).then((events) => { if (active) setHistory(events) }).catch(() => { if (active) setError('Не удалось загрузить историю.') })
    return () => { active = false }
  }, [tool.id])
  return <Modal title={tool.name} onClose={onClose}>
    <p className="tools-caption">{tool.inventoryCode} · {types[tool.type]}</p>
    <dl className="tool-details">
      {Object.entries({
        Статус: statuses[tool.status], Состояние: conditions[tool.condition], Местонахождение: place(tool),
        Ответственный: tool.responsible || 'Не назначен', Модель: tool.model || 'Не указана', 'Серийный номер': tool.serialNumber || 'Не указан',
        'Следующее обслуживание': tool.serviceDate ? dateLabel(tool.serviceDate) : 'Не указано',
      }).map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    {tool.note && <p className="tool-note">{tool.note}</p>}
    <h3 className="tools-history-title">История состояния и перемещений</h3>
    {error && <p role="alert">{error}</p>}{!history && !error && <p>Загружаем историю…</p>}
    <ol className="tools-history">{history?.map((event) => <li key={event.revision}>
      <strong>{{ CREATE: 'Создание карточки', MOVE: 'Перемещение', UPDATE: 'Изменение карточки' }[event.action] ?? event.action}</strong>
      <span>{event.actor} · {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(event.occurredAt))}</span>
      <p>{place(event)} · {statuses[event.status]} · {conditions[event.condition]}</p>
      <small>{event.changedFields.map((field) => fieldLabels[field] ?? field).join(', ')}</small>
    </li>)}</ol>
    <div className="dialog-actions"><button className="secondary-action" onClick={onClose}>Закрыть</button><button className="primary-action" onClick={onEdit}>Изменить / переместить</button></div>
  </Modal>
}
