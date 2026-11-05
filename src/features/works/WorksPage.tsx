import { useEffect, useRef, useState, type FormEvent } from 'react'
import { listWorks, saveWork, WorkConflict, type ObjectOption, type Work, type WorkInput, type WorkList, type WorkStatus } from './api'
import './WorksPage.css'

const labels: Record<WorkStatus, string> = { PLANNED: 'Предстоит', DONE: 'Выполнена' }

function asInput(work?: Work): WorkInput {
  return {
    title: work?.title ?? '',
    status: work?.status ?? 'PLANNED',
    objectId: work?.objectId ?? null,
    dueDate: work?.dueDate ?? null,
    note: work?.note ?? '',
  }
}

function dateLabel(value: string) {
  return value.split('-').reverse().join('.')
}

function completedLabel(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow',
  }).format(new Date(value))
}

function moscowToday() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date())
}

export function WorksPage() {
  const [data, setData] = useState<WorkList>({ works: [], objects: [] })
  const [status, setStatus] = useState<WorkStatus>('PLANNED')
  const [objectFilter, setObjectFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState('')
  const [dialog, setDialog] = useState<{ work?: Work } | null>(null)
  const [today, setToday] = useState(moscowToday)

  useEffect(() => {
    const timer = window.setInterval(() => setToday(moscowToday()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    listWorks(controller.signal)
      .then(setData)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить работы.')
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  async function refresh() {
    setLoading(true)
    setLoadError('')
    try {
      setData(await listWorks())
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Не удалось обновить работы.')
    } finally {
      setLoading(false)
    }
  }

  function apply(saved: Work) {
    setData((current) => ({
      ...current,
      works: [...current.works.filter((work) => work.id !== saved.id), saved],
    }))
  }

  async function handleSave(input: WorkInput, previous?: Work) {
    try {
      const saved = await saveWork(input, previous)
      apply(saved)
      setStatus(saved.status)
      if (objectFilter && objectFilter !== (saved.objectId ?? 'none')) setObjectFilter('')
      setDialog(null)
      setNotice(previous ? 'Изменения сохранены.' : 'Работа добавлена.')
    } catch (error) {
      if (error instanceof WorkConflict) await refresh()
      throw error
    }
  }

  async function toggle(work: Work) {
    if (busyId) return
    setBusyId(work.id)
    setNotice('')
    setLoadError('')
    try {
      const nextStatus = work.status === 'PLANNED' ? 'DONE' : 'PLANNED'
      const saved = await saveWork({ ...asInput(work), status: nextStatus }, work)
      apply(saved)
      setNotice(nextStatus === 'DONE' ? 'Работа перенесена в выполненные.' : 'Работа возвращена в предстоящие.')
    } catch (error) {
      if (error instanceof WorkConflict) await refresh()
      setLoadError(error instanceof Error ? error.message : 'Не удалось изменить статус.')
    } finally {
      setBusyId('')
    }
  }

  const filtered = data.works.filter((work) => !objectFilter ||
    (objectFilter === 'none' ? !work.objectId : work.objectId === objectFilter))
  const visible = filtered.filter((work) => work.status === status).sort((a, b) => {
    if (status === 'DONE') return (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || a.title.localeCompare(b.title, 'ru')
    return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.title.localeCompare(b.title, 'ru')
  })

  return (
    <section className="works-page" aria-label="План и выполненные работы">
      <div className="works-heading">
        <div><span className="section-kicker">ПЛАН КОМАНДЫ</span><h2>{status === 'PLANNED' ? 'Что предстоит сделать' : 'Что уже выполнено'}</h2><p>Отмечайте готовое и держите ближайшие сроки перед глазами.</p></div>
        <button className="primary-action" onClick={() => { setNotice(''); setDialog({}) }} disabled={loading || Boolean(loadError)}>
          <span aria-hidden="true">+</span> Добавить работу
        </button>
      </div>

      <div className="works-controls">
        <div className="works-switch" role="group" aria-label="Статус работ">
          {(['PLANNED', 'DONE'] as const).map((value) => (
            <button key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>
              {value === 'PLANNED' ? 'Предстоящие' : 'Выполненные'}
              <span>{filtered.filter((work) => work.status === value).length}</span>
            </button>
          ))}
        </div>
        <label className="works-filter"><span>Объект</span>
          <select value={objectFilter} onChange={(event) => setObjectFilter(event.target.value)}>
            <option value="">Все объекты</option>
            <option value="none">Без объекта</option>
            {data.objects.map((object) => <option key={object.id} value={object.id}>{object.name}</option>)}
          </select>
        </label>
      </div>

      {notice && <div className="objects-notice" role="status">{notice}</div>}
      {loadError && <div className="objects-error" role="alert"><span>{loadError}</span><button onClick={() => void refresh()}>Обновить список</button></div>}
      {loading ? <p className="works-loading" role="status">Загружаем работы…</p> : !loadError && visible.length === 0 ? (
        <div className="works-empty">
          <span className="works-empty-mark" aria-hidden="true">✓</span>
          <h3>{status === 'DONE' ? 'Выполненных работ пока нет' : 'Предстоящих работ пока нет'}</h3>
          <p>{status === 'DONE' ? 'После отметки о готовности работа появится здесь вместе с датой выполнения.' : 'Добавьте первую работу. Названия и статуса достаточно, остальные поля можно заполнить позже.'}</p>
        </div>
      ) : (
        <ul className="works-list" aria-label={status === 'DONE' ? 'Выполненные работы' : 'Предстоящие работы'}>
          {visible.map((work) => {
            const overdue = work.status === 'PLANNED' && work.dueDate !== null && work.dueDate < today
            return (
              <li key={work.id} className={'work-card' + (work.status === 'DONE' ? ' is-done' : '')}>
                <div className="work-copy">
                  <div className="work-meta"><span className={'work-status ' + (work.status === 'DONE' ? 'done' : 'planned')}>{labels[work.status]}</span><span>{work.objectName ?? 'Общая работа'}</span></div>
                  <h3>{work.title}</h3>
                  {work.note && <p className="work-note">{work.note}</p>}
                  <div className="work-dates">
                    {work.dueDate && <span className={overdue ? 'is-overdue' : ''}>{overdue ? 'Срок прошёл' : 'Срок'} · {dateLabel(work.dueDate)}</span>}
                    {work.completedAt && <span>Выполнена {completedLabel(work.completedAt)}</span>}
                    {!work.dueDate && !work.completedAt && <span>Срок можно указать позже</span>}
                  </div>
                </div>
                <div className="work-actions">
                  <button className={work.status === 'DONE' ? 'secondary-action' : 'primary-action'} disabled={Boolean(busyId)} onClick={() => void toggle(work)}>
                    {busyId === work.id ? 'Сохраняем…' : work.status === 'DONE' ? 'Вернуть в план' : 'Отметить выполненной'}
                  </button>
                  <button className="work-edit" disabled={Boolean(busyId)} onClick={() => setDialog({ work })}>Изменить</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {dialog && <WorkForm
        work={dialog.work}
        objects={data.objects}
        initialObjectId={objectFilter && objectFilter !== 'none' ? objectFilter : null}
        onClose={() => setDialog(null)}
        onSave={handleSave}
      />}
    </section>
  )
}

function WorkForm({ work, objects, initialObjectId, onClose, onSave }: {
  work?: Work
  objects: ObjectOption[]
  initialObjectId: string | null
  onClose: () => void
  onSave: (input: WorkInput, previous?: Work) => Promise<void>
}) {
  const modal = useRef<HTMLDialogElement>(null)
  const [input, setInput] = useState<WorkInput>(() => ({
    ...asInput(work), objectId: work ? work.objectId : initialObjectId,
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (!modal.current?.open) modal.current?.showModal() }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    if (!input.title.trim()) { setError('Введите название работы.'); return }
    setSaving(true)
    setError('')
    try {
      await onSave({ ...input, title: input.title.trim(), note: input.note.trim() }, work)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить работу.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog ref={modal} className="dialog-card work-dialog" aria-labelledby="work-form-title"
      onClose={onClose} onCancel={(event) => { if (saving) event.preventDefault() }}>
      <header className="dialog-header"><h2 id="work-form-title">{work ? 'Изменить работу' : 'Новая работа'}</h2>
        <button className="dialog-close" type="button" aria-label="Закрыть форму" disabled={saving} onClick={() => modal.current?.close()}>×</button>
      </header>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={saving} className="work-fields">
          <label className="form-field">Название работы
            <input autoFocus required maxLength={160} value={input.title} onChange={(event) => setInput({ ...input, title: event.target.value })} placeholder="Что нужно сделать" />
          </label>
          <div className="work-field-pair">
            <label className="form-field">Статус
              <select value={input.status} onChange={(event) => setInput({ ...input, status: event.target.value as WorkStatus })}>
                <option value="PLANNED">Предстоит</option><option value="DONE">Выполнена</option>
              </select>
            </label>
            <label className="form-field">Срок <small>необязательно</small>
              <input type="date" min="1000-01-01" max="9999-12-31" value={input.dueDate ?? ''} onChange={(event) => setInput({ ...input, dueDate: event.target.value || null })} />
            </label>
          </div>
          <label className="form-field">Объект <small>необязательно</small>
            <select value={input.objectId ?? ''} onChange={(event) => setInput({ ...input, objectId: event.target.value || null })}>
              <option value="">Общая работа, без объекта</option>
              {objects.map((object) => <option key={object.id} value={object.id}>{object.name}</option>)}
            </select>
          </label>
          <label className="form-field">Примечание <small>необязательно</small>
            <textarea maxLength={1000} rows={4} value={input.note} onChange={(event) => setInput({ ...input, note: event.target.value })} placeholder="Детали, которые пригодятся при выполнении" />
          </label>
        </fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="secondary-action" disabled={saving} onClick={() => modal.current?.close()}>Отмена</button>
          <button type="submit" className="primary-action" disabled={saving}>{saving ? 'Сохраняем…' : work ? 'Сохранить' : 'Добавить работу'}</button>
        </div>
      </form>
    </dialog>
  )
}

