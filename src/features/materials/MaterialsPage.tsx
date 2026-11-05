import { useEffect, useState, type FormEvent } from 'react'
import { listMaterials, quantity, today, type Material, type ObjectOption } from './api'
import './MaterialsPage.css'
import './Purchases.css'

type Purchase = { id: string; materialId: string; materialName: string; unit: string; objectId: string | null; objectName: string | null; objectArchived: boolean; quantity: string; note: string; status: 'NEEDED' | 'BOUGHT' | 'CANCELLED'; revision: number }
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch('/api/material-purchases' + path, { credentials: 'same-origin', ...options })
  if (response.status === 401) { window.location.reload(); throw new Error('Сессия завершилась.') }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const messages: Record<string, string> = {
      insufficient_stock: 'Не удалось вернуть материал в список: раньше для него были записаны другие движения. Обратитесь к разработчику.',
      object_unavailable: 'Объект удалён или недоступен.',
      record_changed: 'Запись уже изменилась. Обновите страницу.',
      invalid_quantity: 'Введите название, единицу измерения и количество больше нуля.',
    }
    throw new Error(messages[body.error] ?? 'Не удалось сохранить. Проверьте название, количество и соединение.')
  }
  return response.json() as Promise<T>
}
const send = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export function MaterialsPage() {
  const [records, setRecords] = useState<Purchase[] | null>(null)
  const [objects, setObjects] = useState<ObjectOption[]>([])
  const [items, setItems] = useState<Material[]>([])
  const [existing, setExisting] = useState<Material | undefined>()
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  async function load() {
    try {
      const [purchases, materialData] = await Promise.all([api<Purchase[]>('/'), listMaterials()])
      setRecords(purchases); setObjects(materialData.objects); setItems(materialData.items); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось загрузить материалы.') }
  }
  useEffect(() => { void load() }, [])
  async function change(record: Purchase, action: 'BUY' | 'REOPEN' | 'CANCEL') {
    if (busy) return
    setBusy(true); setError('')
    try {
      await api('/' + record.id + '/action', send({ revision: record.revision, action, date: today(), unitPrice: null, supplier: '' }))
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось изменить материал.') } finally { setBusy(false) }
  }
  const visible = records?.filter((r) => r.status !== 'CANCELLED' && (!filter || r.objectId === filter)) ?? []
  const needed = visible.filter((r) => r.status === 'NEEDED')
  const bought = visible.filter((r) => r.status === 'BOUGHT')
  const legacy = items.filter((item) => !records?.some((r) => r.materialId === item.id))
  function list(rows: Purchase[]) {
    return <ul className="simple-material-list">{rows.map((record) => <li key={record.id}>
      <label className="simple-material-check">
        <input type="checkbox" checked={record.status === 'BOUGHT'} disabled={busy} onChange={() => void change(record, record.status === 'BOUGHT' ? 'REOPEN' : 'BUY')} aria-label={record.status === 'BOUGHT' ? 'Вернуть ' + record.materialName + ' в список покупок' : 'Отметить ' + record.materialName + ' купленным'} />
        <span><strong>{record.materialName}</strong><small>{quantity(record.quantity)} {record.unit} · {record.objectName ?? 'Без объекта'}{record.objectArchived ? ' · объект удалён' : ''}</small>{record.note && <small>{record.note}</small>}</span>
      </label>
      {record.status === 'NEEDED' && <button className="simple-material-remove" disabled={busy} onClick={() => { if (window.confirm('Убрать этот материал из списка?')) void change(record, 'CANCEL') }} aria-label={'Убрать ' + record.materialName}>×</button>}
    </li>)}</ul>
  }
  return <section className="materials-page" aria-label="Список материалов">
    <div className="materials-heading"><div><span className="section-kicker">СПИСОК ПОКУПОК</span><h2>Материалы</h2><p>Добавьте материал и отметьте галочкой, когда купите.</p></div>
      <button className="primary-action" onClick={() => { setExisting(undefined); setFormOpen(!formOpen) }}>{formOpen ? 'Закрыть' : '+ Добавить материал'}</button></div>
    {formOpen && <MaterialForm key={existing?.id ?? 'new'} item={existing} objects={objects} onSaved={async () => { setFormOpen(false); setExisting(undefined); await load() }} />}
    <label className="form-field materials-search">Объект<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">Все объекты</option>{objects.map((o) => <option key={o.id} value={o.id}>{o.name}{o.archived ? ' · удалён' : ''}</option>)}</select></label>
    {error && <div className="objects-error" role="alert"><span>{error}</span><button onClick={() => void load()}>Обновить</button></div>}
    {!records ? <p>Загружаем материалы…</p> : <div className="simple-material-columns">
      <section><h3>Нужно купить <span>{needed.length}</span></h3>{needed.length ? list(needed) : <p className="purchase-empty">Здесь появятся материалы, которые нужно купить.</p>}</section>
      <section><h3>Куплено <span>{bought.length}</span></h3>{bought.length ? list(bought) : <p className="purchase-empty">Отметьте материал галочкой, и он появится здесь.</p>}</section>
    </div>}
    {records && legacy.length > 0 && <details className="material-audit"><summary>Ранее созданные карточки · {legacy.length}</summary><p className="materials-caption">Эти карточки созданы до появления списка покупок. При необходимости добавьте их в список.</p><ul>{legacy.map((item) => <li key={item.id}><strong>{item.name} · {item.unit}</strong><button className="secondary-action" onClick={() => { setExisting(item); setFormOpen(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Добавить в список</button></li>)}</ul></details>}
  </section>
}

function MaterialForm({ item, objects, onSaved }: { item?: Material; objects: ObjectOption[]; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(item?.name ?? '')
  const [amount, setAmount] = useState('1')
  const [unit, setUnit] = useState(item?.unit ?? 'шт.')
  const [objectId, setObjectId] = useState('')
  const [note, setNote] = useState('')
  const [requestId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError('')
    try { const common = { requestId, objectId: objectId || null, quantity: amount.trim().replace(',', '.'), note }; await api(item ? '/' : '/quick', send(item ? { ...common, materialId: item.id } : { ...common, name, unit })); await onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось добавить материал.') } finally { setBusy(false) }
  }
  return <form className="purchase-form" onSubmit={(e) => void submit(e)}><h3>Новый материал</h3><div className="purchase-fields">
    <label className="form-field">Название<input autoFocus required readOnly={!!item} maxLength={160} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, грунтовка" /></label>
    <label className="form-field">Объект<select value={objectId} onChange={(e) => setObjectId(e.target.value)}><option value="">Без объекта</option>{objects.filter((o) => !o.archived).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
    <label className="form-field">Количество<input required inputMode="decimal" maxLength={15} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
    <label className="form-field">Единица измерения<input required readOnly={!!item} maxLength={24} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="шт., кг, м²" /></label>
    <label className="form-field">Примечание · необязательно<input maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
  </div>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-action" disabled={busy}>{busy ? 'Сохраняем…' : 'Добавить в список'}</button></form>
}
