import { useEffect, useState, type FormEvent } from 'react'
import {
  deleteObject,
  getObjectHistory,
  listObjects,
  objectFieldLabels,
  objectStatusLabels,
  restoreObject,
  saveObject,
  type ObjectHistoryEntry,
  type ObjectStatus,
  type WorkObject,
  type WorkObjectInput,
} from './api'
import './ObjectsPage.css'

type StatusFilter = 'ALL' | ObjectStatus
type DialogState =
  | { kind: 'form'; object?: WorkObject }
  | { kind: 'details'; object: WorkObject }
  | { kind: 'history'; object: WorkObject }
  | { kind: 'confirm-delete'; object: WorkObject }
  | null

const statusOrder: ObjectStatus[] = ['PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']

function emptyObjectForm(): WorkObjectInput {
  return {
    name: '',
    address: '',
    customerName: '',
    customerPhone: null,
    customerEmail: null,
    responsibleName: null,
    status: 'PLANNED',
    startDate: null,
    completionDate: null,
  }
}

function objectToForm(object: WorkObject): WorkObjectInput {
  return {
    name: object.name,
    address: object.address,
    customerName: object.customerName,
    customerPhone: object.customerPhone,
    customerEmail: object.customerEmail,
    responsibleName: object.responsibleName,
    status: object.status,
    startDate: object.startDate,
    completionDate: object.completionDate,
  }
}

function displayDate(date: string | null): string {
  if (!date) return 'Не указана'
  const [year, month, day] = date.split('-')
  return `${day}.${month}.${year}`
}

function displayDateTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function ObjectsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20.5V7.8L12 3.5l8 4.3v12.7" />
      <path d="M8 20.5v-7h8v7M8 9h.01M12 9h.01M16 9h.01" />
    </svg>
  )
}

export function ObjectsPage({ onOpenEstimates }: { onOpenEstimates: (objectId: string) => void }) {
  const [objects, setObjects] = useState<WorkObject[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [showDeleted, setShowDeleted] = useState(false)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyObjectId, setBusyObjectId] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    listObjects({
      q: search,
      status: statusFilter === 'ALL' ? undefined : statusFilter,
      deleted: showDeleted,
    }, controller.signal)
      .then(setObjects)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить объекты.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [search, statusFilter, showDeleted])

  useEffect(() => {
    if (!dialog) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDialog(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialog])

  async function reloadObjects() {
    setLoading(true)
    setLoadError('')
    try {
      const latest = await listObjects({
        q: search,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        deleted: showDeleted,
      })
      setObjects(latest)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить объекты.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(input: WorkObjectInput, id?: string) {
    const saved = await saveObject(input, id)
    await reloadObjects()
    setDialog({ kind: 'details', object: saved })
    setNotice(id ? 'Изменения сохранены.' : 'Объект добавлен.')
    window.setTimeout(() => setNotice(''), 3500)
  }

  async function handleDelete(id: string) {
    await deleteObject(id)
    await reloadObjects()
    setDialog(null)
    setNotice('Объект перемещён в удалённые. Его можно восстановить.')
    window.setTimeout(() => setNotice(''), 3500)
  }

  async function handleRestore(id: string) {
    setBusyObjectId(id)
    try {
      await restoreObject(id)
      await reloadObjects()
      setDialog(null)
      setNotice('Объект восстановлен.')
      window.setTimeout(() => setNotice(''), 3500)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Не удалось восстановить объект.')
    } finally {
      setBusyObjectId('')
    }
  }

  return (
    <section className="objects-page" aria-labelledby="objects-title">
      <div className="objects-toolbar">
        <div className="objects-toolbar-copy">
          <span className="section-kicker">ЦЕНТРАЛЬНЫЙ МОДУЛЬ</span>
          <h2 id="objects-title">Объекты</h2>
          <p>Карточки работ, заказчики и ответственные.</p>
        </div>
        {!showDeleted && (
          <button className="primary-action" onClick={() => setDialog({ kind: 'form' })}>
            <span aria-hidden="true">+</span> Новый объект
          </button>
        )}
      </div>

      <div className="objects-controls">
        <label className="objects-search">
          <span className="search-icon" aria-hidden="true">⌕</span>
          <span className="sr-only">Поиск объектов</span>
          <input
            type="search"
            value={search}
            maxLength={120}
            placeholder="По названию, адресу или заказчику"
            onChange={(event) => { setSearch(event.target.value); setLoading(true); setLoadError('') }}
          />
        </label>
        <label className="status-filter">
          <span>Статус</span>
          <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as StatusFilter); setLoading(true); setLoadError('') }}>
            <option value="ALL">Все статусы</option>
            {statusOrder.map((status) => <option key={status} value={status}>{objectStatusLabels[status]}</option>)}
          </select>
        </label>
        <button
          className={`archive-toggle ${showDeleted ? 'is-active' : ''}`}
          aria-pressed={showDeleted}
          onClick={() => { setShowDeleted((current) => !current); setLoading(true); setLoadError('') }}
        >
          {showDeleted ? '← К объектам' : 'Удалённые'}
        </button>
        <span className="objects-total">{loading ? 'Загружаем…' : `${objects.length} ${objects.length === 1 ? 'объект' : objects.length < 5 ? 'объекта' : 'объектов'}`}</span>
      </div>

      {notice && <div className="objects-notice" role="status">{notice}</div>}
      {loadError && (
        <div className="objects-error" role="alert">
          <span>{loadError}</span>
          <button onClick={() => void reloadObjects()}>Повторить</button>
        </div>
      )}

      <div className="objects-table-wrap">
        <table className="objects-table">
          <thead>
            <tr>
              <th scope="col">Объект</th>
              <th scope="col">Заказчик</th>
              <th scope="col">Ответственный</th>
              <th scope="col">Сроки</th>
              <th scope="col">Статус</th>
              <th scope="col"><span className="sr-only">Действия</span></th>
            </tr>
          </thead>
          <tbody>
            {!loading && !loadError && objects.map((object) => (
              <tr key={object.id}>
                <td>
                  <button className="object-name-button" onClick={() => setDialog({ kind: 'details', object })}>
                    <strong>{object.name}</strong><span>{object.address}</span>
                  </button>
                </td>
                <td>{object.customerName}</td>
                <td>{object.responsibleName || <span className="muted-value">Не назначен</span>}</td>
                <td className="object-dates">
                  <span>{displayDate(object.startDate)}</span>
                  <small>до {displayDate(object.completionDate)}</small>
                </td>
                <td><span className={`status-pill status-${object.status.toLowerCase()}`}>{objectStatusLabels[object.status]}</span></td>
                <td className="object-row-actions">
                  {object.deletedAt ? (
                    <button disabled={busyObjectId === object.id} onClick={() => void handleRestore(object.id)}>
                      {busyObjectId === object.id ? 'Возвращаем…' : 'Восстановить'}
                    </button>
                  ) : (
                    <>
                      <button aria-label={`Редактировать: ${object.name}`} onClick={() => setDialog({ kind: 'form', object })}>Изменить</button>
                      <button className="delete-object-button" aria-label={`Удалить: ${object.name}`} onClick={() => setDialog({ kind: 'confirm-delete', object })}>Удалить</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && !loadError && objects.length === 0 && (
          <div className="objects-empty">
            <span className="objects-empty-icon"><ObjectsIcon /></span>
            <h3>{showDeleted ? 'Удалённых объектов нет' : search || statusFilter !== 'ALL' ? 'Ничего не найдено' : 'Пока нет объектов'}</h3>
            <p>{showDeleted ? 'Удалённые объекты появятся здесь; их можно будет восстановить.' : search || statusFilter !== 'ALL' ? 'Измените поиск или фильтр статуса.' : 'Добавьте первый объект, чтобы вести по нему рабочую информацию.'}</p>
            {!showDeleted && !search && statusFilter === 'ALL' && <button className="primary-action" onClick={() => setDialog({ kind: 'form' })}>Добавить объект</button>}
          </div>
        )}

        {loading && <div className="objects-loading" role="status">Загружаем список объектов…</div>}
      </div>

      {dialog?.kind === 'form' && (
        <ObjectFormDialog
          object={dialog.object}
          onClose={() => setDialog(null)}
          onSave={handleSave}
        />
      )}
      {dialog?.kind === 'details' && (
        <ObjectDetailsDialog
          object={dialog.object}
          onClose={() => setDialog(null)}
          onEdit={() => setDialog({ kind: 'form', object: dialog.object })}
          onHistory={() => setDialog({ kind: 'history', object: dialog.object })}
          onDelete={() => setDialog({ kind: 'confirm-delete', object: dialog.object })}
          onRestore={() => void handleRestore(dialog.object.id)}
          onOpenEstimates={() => onOpenEstimates(dialog.object.id)}
        />
      )}
      {dialog?.kind === 'history' && (
        <ObjectHistoryDialog object={dialog.object} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'confirm-delete' && (
        <DeleteObjectDialog
          object={dialog.object}
          onCancel={() => setDialog(null)}
          onConfirm={() => handleDelete(dialog.object.id)}
        />
      )}
    </section>
  )
}

function ObjectFormDialog({ object, onClose, onSave }: {
  object?: WorkObject
  onClose: () => void
  onSave: (input: WorkObjectInput, id?: string) => Promise<void>
}) {
  const [form, setForm] = useState<WorkObjectInput>(() => object ? objectToForm(object) : emptyObjectForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function update<K extends keyof WorkObjectInput>(key: K, value: WorkObjectInput[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave({
        ...form,
        customerPhone: form.customerPhone?.trim() || null,
        customerEmail: form.customerEmail?.trim() || null,
        responsibleName: form.responsibleName?.trim() || null,
        startDate: form.startDate || null,
        completionDate: form.completionDate || null,
      }, object?.id)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить объект.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogFrame title={object ? 'Изменить объект' : 'Новый объект'} onClose={onClose}>
      <form className="object-form" onSubmit={(event) => void submit(event)}>
        <div className="form-section-label">ОСНОВНЫЕ СВЕДЕНИЯ</div>
        <label className="form-field form-field-full">
          <span>Название объекта <i>*</i></span>
          <input autoFocus required maxLength={120} value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Например, квартира на Лесной" />
        </label>
        <label className="form-field form-field-full">
          <span>Адрес <i>*</i></span>
          <input required maxLength={300} value={form.address} onChange={(event) => update('address', event.target.value)} placeholder="Город, улица, дом" />
        </label>

        <div className="form-section-label">ЗАКАЗЧИК И КОМАНДА</div>
        <label className="form-field">
          <span>Заказчик <i>*</i></span>
          <input required maxLength={120} value={form.customerName} onChange={(event) => update('customerName', event.target.value)} />
        </label>
        <label className="form-field">
          <span>Ответственный</span>
          <input maxLength={120} value={form.responsibleName ?? ''} onChange={(event) => update('responsibleName', event.target.value || null)} />
        </label>
        <label className="form-field">
          <span>Телефон заказчика</span>
          <input type="tel" autoComplete="off" maxLength={40} value={form.customerPhone ?? ''} onChange={(event) => update('customerPhone', event.target.value || null)} />
        </label>
        <label className="form-field">
          <span>Электронная почта</span>
          <input type="email" autoComplete="off" maxLength={254} value={form.customerEmail ?? ''} onChange={(event) => update('customerEmail', event.target.value || null)} />
        </label>

        <div className="form-section-label">СРОКИ И СТАТУС</div>
        <label className="form-field">
          <span>Дата начала</span>
          <input type="date" value={form.startDate ?? ''} onChange={(event) => update('startDate', event.target.value || null)} />
        </label>
        <label className="form-field">
          <span>Дата завершения</span>
          <input type="date" value={form.completionDate ?? ''} onChange={(event) => update('completionDate', event.target.value || null)} />
        </label>
        <label className="form-field">
          <span>Статус</span>
          <select value={form.status} onChange={(event) => update('status', event.target.value as ObjectStatus)}>
            {statusOrder.map((status) => <option key={status} value={status}>{objectStatusLabels[status]}</option>)}
          </select>
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions form-actions">
          <button type="button" className="secondary-action" onClick={onClose} disabled={saving}>Отмена</button>
          <button type="submit" className="primary-action" disabled={saving}>{saving ? 'Сохраняем…' : object ? 'Сохранить изменения' : 'Создать объект'}</button>
        </div>
      </form>
    </DialogFrame>
  )
}

function ObjectDetailsDialog({ object, onClose, onEdit, onHistory, onDelete, onRestore, onOpenEstimates }: {
  object: WorkObject
  onClose: () => void
  onEdit: () => void
  onHistory: () => void
  onDelete: () => void
  onRestore: () => void
  onOpenEstimates: () => void
}) {
  return (
    <DialogFrame title={object.name} onClose={onClose} wide>
      <div className="object-details">
        <div className="object-details-heading">
          <span className={`status-pill status-${object.status.toLowerCase()}`}>{objectStatusLabels[object.status]}</span>
          {object.deletedAt && <span className="status-pill status-deleted">Удалён</span>}
          <p>{object.address}</p>
        </div>
        <div className="details-grid">
          <Detail label="Заказчик" value={object.customerName} />
          <Detail label="Ответственный" value={object.responsibleName} />
          <Detail label="Телефон" value={object.customerPhone} />
          <Detail label="Электронная почта" value={object.customerEmail} />
          <Detail label="Дата начала" value={displayDate(object.startDate)} />
          <Detail label="Дата завершения" value={displayDate(object.completionDate)} />
        </div>
        <div className="object-related-placeholder">
          <span className="section-kicker">СМЕТЫ ОБЪЕКТА</span>
          <p>{object.deletedAt ? 'Восстановите объект, чтобы открыть связанные сметы.' : 'Создавайте сметы для этого объекта и возвращайтесь к их версиям.'}</p>
          {!object.deletedAt && <button className="object-estimates-link" onClick={onOpenEstimates}>Открыть сметы объекта →</button>}
        </div>
        {object.deletedAt && <p className="deleted-object-note">Удалён {displayDateTime(object.deletedAt)}. История изменений сохранена.</p>}
        <div className="dialog-actions">
          <button className="secondary-action" onClick={onHistory}>История изменений</button>
          <button className="secondary-action" onClick={onClose}>Закрыть</button>
          {object.deletedAt ? (
            <button className="primary-action" onClick={onRestore}>Восстановить</button>
          ) : (
            <>
              <button className="secondary-action" onClick={onDelete}>Удалить</button>
              <button className="primary-action" onClick={onEdit}>Изменить</button>
            </>
          )}
        </div>
      </div>
    </DialogFrame>
  )
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{value || 'Не указано'}</strong>
    </div>
  )
}

function ObjectHistoryDialog({ object, onClose }: { object: WorkObject; onClose: () => void }) {
  const [history, setHistory] = useState<ObjectHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getObjectHistory(object.id)
      .then((entries) => { if (active) setHistory(entries) })
      .catch((historyError: unknown) => {
        if (active) setError(historyError instanceof Error ? historyError.message : 'Не удалось загрузить историю.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [object.id])

  return (
    <DialogFrame title="История изменений" onClose={onClose}>
      <p className="history-object-name">{object.name}</p>
      {loading && <p className="history-message">Загружаем историю…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {!loading && !error && history.length === 0 && <p className="history-message">Записей пока нет.</p>}
      <ol className="history-list">
        {history.map((entry) => (
          <li key={entry.id}>
            <span className="history-marker" />
            <div>
              <strong>{
                entry.action === 'CREATE' ? 'Создан объект'
                  : entry.action === 'UPDATE' ? 'Изменён объект'
                    : entry.action === 'DELETE' ? 'Объект удалён'
                      : 'Объект восстановлен'
              }</strong>
              <span>{entry.actorUsername} · {displayDateTime(entry.occurredAt)}</span>
              <small>{entry.changedFields.map((field) => objectFieldLabels[field] ?? field).join(', ')}</small>
            </div>
          </li>
        ))}
      </ol>
      <div className="dialog-actions"><button className="secondary-action" onClick={onClose}>Закрыть</button></div>
    </DialogFrame>
  )
}

function DeleteObjectDialog({ object, onCancel, onConfirm }: {
  object: WorkObject
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    setDeleting(true)
    setError('')
    try {
      await onConfirm()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Не удалось удалить объект.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <DialogFrame title="Удалить объект?" onClose={onCancel}>
      <div className="delete-confirmation">
        <p>«{object.name}» исчезнет из основного списка. История изменений сохранится, а объект можно будет восстановить из раздела «Удалённые».</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button className="secondary-action" onClick={onCancel} disabled={deleting}>Оставить</button>
          <button className="danger-action" onClick={() => void confirm()} disabled={deleting}>
            {deleting ? 'Удаляем…' : 'Удалить объект'}
          </button>
        </div>
      </div>
    </DialogFrame>
  )
}

function DialogFrame({ title, onClose, children, wide = false }: {
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className={`dialog-card ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="dialog-header">
          <h2>{title}</h2>
          <button autoFocus className="dialog-close" aria-label="Закрыть окно" onClick={onClose}>×</button>
        </header>
        {children}
      </section>
    </div>
  )
}
