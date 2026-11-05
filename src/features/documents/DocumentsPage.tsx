import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { acceptedFiles, maxFileSize, categories, listDocuments, uploadDocument, saveMetadata, metadata, downloadDocument, getHistory, sizeLabel, timestamp,
  type Metadata, type DocumentItem, type ObjectOption, type HistoryEvent } from './api'
import './DocumentsPage.css'

type Dialog = { kind: 'form'; item?: DocumentItem } | { kind: 'archive' | 'detail'; item: DocumentItem }
export function DocumentsPage() {
  const [items, setItems] = useState<DocumentItem[]>([])
  const [objects, setObjects] = useState<ObjectOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [objectId, setObjectId] = useState('')
  const [archive, setArchive] = useState(false)
  const [downloading, setDownloading] = useState('')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    listDocuments(controller.signal).then((data) => {
      if (!controller.signal.aborted) { setItems(data.items); setObjects(data.objects) }
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить документы.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [refresh])
  function reload() { setLoading(true); setError(''); setRefresh((value) => value + 1) }
  function saved(upload = false) {
    setDialog(null); setNotice(upload ? 'Файл прикреплён и сохранён на этом компьютере.' : 'Изменения сохранены.')
    if (upload) { setArchive(false); setSearch(''); setCategory(''); setObjectId('') }
    reload()
  }
  async function download(item: DocumentItem) {
    if (downloading) return
    setDownloading(item.id); setError('')
    try { await downloadDocument(item) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось скачать файл.') } finally { setDownloading('') }
  }
  const needle = search.trim().toLocaleLowerCase('ru-RU')
  const visible = items.filter((item) => item.archived === archive && (!category || item.category === category) &&
    (!objectId || (objectId === 'none' ? !item.objectId : item.objectId === objectId)) &&
    [item.title,item.name].some((value) => value.toLocaleLowerCase('ru-RU').includes(needle)))
  return <section className="documents-page" aria-label="Документы и вложения">
    <div className="documents-heading"><div><span className="section-kicker">ЛОКАЛЬНОЕ ХРАНЕНИЕ</span><h2>Документы и вложения</h2><p>Файлы компании и объектов с доступом через Northordo.</p></div><button className="primary-action" onClick={() => setDialog({ kind: 'form' })}>+ Прикрепить файл</button></div>
    <div className="documents-filters">
      <label className="form-field">Поиск<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Название или имя файла" /></label>
      <label className="form-field">Категория<select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Все категории</option>{Object.entries(categories).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="form-field">Объект<select value={objectId} onChange={(e) => setObjectId(e.target.value)}><option value="">Все объекты</option><option value="none">Без объекта</option>{objects.map((object) => <option key={object.id} value={object.id}>{object.name}{object.archived ? ' · удалён' : ''}</option>)}</select></label>
    </div>
    <div className="documents-subfilters"><label><input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} /> Архив</label><span>PDF, Word, Excel, текст и изображения · до 10 МиБ на файл</span></div>
    {notice && <p className="objects-notice" role="status">{notice}</p>}
    {error && <div className="objects-error" role="alert"><span>{error}</span><button onClick={reload}>Обновить</button></div>}
    {loading ? <p role="status">Загружаем документы…</p> : visible.length ? <ul className="documents-list">{visible.map((item) => <li className="document-card" key={item.id}>
      <div className="document-copy"><div className="document-meta"><span>{categories[item.category]}</span><span>{sizeLabel(item.size)}</span>{item.archived && <b>В архиве</b>}</div>
        <h3><button className="document-title" onClick={() => setDialog({ kind: 'detail', item })}>{item.title}</button></h3>
        <p className="document-filename">{item.name}</p><p>{item.objectName ?? 'Общий документ'}{item.objectArchived ? ' · объект удалён' : ''}</p>
        {item.note && <p className="document-note">{item.note}</p>}<small>{item.actor} · {timestamp(item.createdAt)}</small>
      </div><div className="document-actions">{!item.archived && <button className="primary-action" disabled={Boolean(downloading)} onClick={() => void download(item)}>{downloading === item.id ? 'Скачиваем…' : 'Скачать файл'}</button>}
        <button className="secondary-action" onClick={() => setDialog({ kind: 'form', item })}>Изменить карточку</button>
        <button className="secondary-action" onClick={() => setDialog({ kind: 'detail', item })}>История</button>
        <button className="document-archive" onClick={() => setDialog({ kind: 'archive', item })}>{item.archived ? 'Восстановить' : 'В архив'}</button>
      </div>
    </li>)}</ul> : !error && <div className="documents-empty"><h3>{archive ? 'Архив пуст' : 'Документов не найдено'}</h3><p>Прикрепите файл или измените поиск и фильтры.</p></div>}
    {dialog?.kind === 'form' && <DocumentForm item={dialog.item} objects={objects} onClose={() => setDialog(null)} onSaved={() => saved(!dialog.item)} />}
    {dialog?.kind === 'archive' && <ArchiveForm item={dialog.item} onClose={() => setDialog(null)} onSaved={() => saved()} />}
    {dialog?.kind === 'detail' && <DocumentDetail item={dialog.item} onClose={() => setDialog(null)} />}
  </section>
}
function Modal({ title, busy = false, children, onClose }: { title: string; busy?: boolean; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (!ref.current?.open) ref.current?.showModal() }, [])
  return <dialog ref={ref} className="dialog-card documents-dialog" aria-label={title} onClose={onClose} onCancel={(e) => { if (busy) e.preventDefault() }}>
    <header className="dialog-header"><h2>{title}</h2><button className="dialog-close" disabled={busy} aria-label="Закрыть" onClick={() => ref.current?.close()}>×</button></header>{children}
  </dialog>
}
function DocumentForm({ item, objects, onClose, onSaved }: { item?: DocumentItem; objects: ObjectOption[]; onClose: () => void; onSaved: () => void }) {
  const [input, setInput] = useState<Metadata>(() => item ? metadata(item) : { title: '', category: 'OTHER', objectId: null, note: '' })
  const [file, setFile] = useState<File | null>(null)
  const [requestId] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!item && (!file || !file.size || file.size > maxFileSize)) { setError('Выберите непустой файл размером до 10 МиБ.'); return }
    if (!input.title.trim()) { setError('Введите название документа.'); return }
    setBusy(true); setError('')
    try {
      const normalized = { ...input, title: input.title.trim(), note: input.note.trim() }
      if (item) await saveMetadata(item,normalized)
      else await uploadDocument(file!,normalized,requestId)
      onSaved()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить документ.') } finally { setBusy(false) }
  }
  return <Modal title={item ? 'Изменить документ' : 'Прикрепить файл'} busy={busy} onClose={onClose}><form onSubmit={(e) => void submit(e)}>
    <fieldset disabled={busy} className="documents-form">
      {!item ? <label className="form-field document-file-field">Файл<input autoFocus required type="file" accept={acceptedFiles} onChange={(e) => {
        const selected = e.target.files?.[0] ?? null
        setFile(selected); setError('')
        if (selected && !input.title) setInput({ ...input, title: selected.name.replace(/\.[^.]+$/,'').slice(0,160) })
      }} /><small>PDF, TXT, DOC/DOCX, XLS/XLSX, JPG/JPEG, PNG, WEBP. До 10 МиБ.</small>{file && <span>{file.name} · {sizeLabel(file.size)}</span>}</label> : <p className="documents-caption">{item.name} · {sizeLabel(item.size)}</p>}
      <label className="form-field">Название<input required maxLength={160} value={input.title} onChange={(e) => setInput({ ...input, title: e.target.value })} /></label>
      <label className="form-field">Категория<select value={input.category} onChange={(e) => setInput({ ...input, category: e.target.value as Metadata['category'] })}>{Object.entries(categories).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="form-field">Объект · необязательно<select value={input.objectId ?? ''} onChange={(e) => setInput({ ...input, objectId: e.target.value || null })}><option value="">Общий документ, без объекта</option>{objects.filter((object) => !object.archived || object.id === item?.objectId).map((object) => <option key={object.id} value={object.id}>{object.name}{object.archived ? ' · удалён' : ''}</option>)}</select></label>
      <label className="form-field">Примечание<textarea rows={3} maxLength={500} value={input.note} onChange={(e) => setInput({ ...input, note: e.target.value })} /></label>
    </fieldset>{error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" className="secondary-action" disabled={busy} onClick={onClose}>Отмена</button><button className="primary-action" disabled={busy}>{busy ? item ? 'Сохраняем…' : 'Загружаем файл…' : item ? 'Сохранить' : 'Прикрепить'}</button></div>
  </form></Modal>
}
function ArchiveForm({ item, onClose, onSaved }: { item: DocumentItem; onClose: () => void; onSaved: () => void }) {
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  async function confirm() {
    setBusy(true); setError('')
    try { await saveMetadata(item,metadata(item),!item.archived); onSaved() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось изменить документ.') } finally { setBusy(false) }
  }
  return <Modal title={item.archived ? 'Восстановить документ' : 'В архив'} busy={busy} onClose={onClose}>
    <p>{item.title} · {item.name}</p><p>{item.archived ? 'Документ вернётся в основной список, файл снова можно будет скачать.' : 'Файл сохранится. Чтобы скачать его позже, восстановите документ из архива.'}</p>
    {error && <p role="alert" className="form-error">{error}</p>}<div className="dialog-actions"><button className="secondary-action" disabled={busy} onClick={onClose}>Отмена</button><button className="primary-action" disabled={busy} onClick={() => void confirm()}>{busy ? 'Сохраняем…' : item.archived ? 'Восстановить' : 'В архив'}</button></div>
  </Modal>
}
function DocumentDetail({ item,onClose }: { item: DocumentItem; onClose: () => void }) {
  const [events,setEvents] = useState<HistoryEvent[] | null>(null)
  const [error,setError] = useState('')
  useEffect(() => {
    let active = true
    getHistory(item.id).then((result) => { if (active) setEvents(result) }).catch(() => { if (active) setError('Не удалось загрузить историю.') })
    return () => { active = false }
  }, [item.id])
  const actions: Record<string,string> = { UPLOAD: 'Прикрепление файла', EDIT: 'Изменение карточки', ARCHIVE: 'Архивация', RESTORE: 'Восстановление', DOWNLOAD: 'Выдача файла для скачивания' }
  const fields: Record<string,string> = { file: 'Файл', title: 'Название', category: 'Категория', objectId: 'Объект', note: 'Примечание', archived: 'Архив' }
  return <Modal title={item.title} onClose={onClose}><p className="documents-caption">{item.name} · {sizeLabel(item.size)}</p><h3 className="document-history-title">История документа</h3>
    {error && <p role="alert">{error}</p>}{!events && !error && <p>Загружаем историю…</p>}<ol className="document-history">{events?.map((event) => <li key={event.id}><strong>{actions[event.action] ?? event.action}</strong><span>{event.actor} · {timestamp(event.occurredAt)}</span>{event.changedFields.length > 0 && <small>{event.changedFields.map((key) => fields[key] ?? key).join(', ')}</small>}</li>)}</ol>
    <div className="dialog-actions"><button className="secondary-action" onClick={onClose}>Закрыть</button></div>
  </Modal>
}
