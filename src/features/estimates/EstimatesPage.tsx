import { useEffect, useState, type FormEvent } from 'react'
import {
  calculateEstimatePreview,
  createEstimate,
  createEstimateVersion,
  getEstimate,
  getEstimateVersion,
  listEstimateObjects,
  listEstimates,
  normalizeEstimateCalculation,
  type EstimateCalculationPreview,
  type EstimateDetails,
  type EstimateInputLine,
  type EstimateLine,
  type EstimateListItem,
  type EstimateObjectOption,
  type EstimateVersion,
} from './api'
import { EstimateLineEditor, type DraftEstimateLine } from './EstimateLineEditor'
import { describeCalculation, displayMoney, displayQuantity } from './format'
import './EstimatesPage.css'

type DraftLine = DraftEstimateLine
type DialogState =
  | { kind: 'form'; estimateId?: string; objectId: string; title: string; note: string; items: DraftLine[] }
  | { kind: 'details'; estimate: EstimateDetails; version: EstimateVersion; items: EstimateLine[] }
  | null

type PreviewState = {
  signature: string
  result?: EstimateCalculationPreview
  error?: string
}

function newLine(): DraftLine {
  return {
    key: crypto.randomUUID(),
    description: '',
    unit: 'шт.',
    unitPrice: '0',
    calculation: { mode: 'manual', quantity: '1', repetitions: '1', wastePercent: '0' },
  }
}

function displayDateTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function EstimatesPage({ initialObjectFilter = '' }: { initialObjectFilter?: string }) {
  const [estimates, setEstimates] = useState<EstimateListItem[]>([])
  const [objects, setObjects] = useState<EstimateObjectOption[]>([])
  const [objectFilter, setObjectFilter] = useState(initialObjectFilter)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [formError, setFormError] = useState('')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [previewState, setPreviewState] = useState<PreviewState | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([listEstimates(controller.signal), listEstimateObjects(controller.signal)])
      .then(([estimateRows, objectRows]) => {
        setEstimates(estimateRows)
        setObjects(objectRows)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'Не удалось загрузить сметы.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [])

  const visibleEstimates = objectFilter
    ? estimates.filter((estimate) => estimate.objectId === objectFilter)
    : estimates

  const previewSignature = dialog?.kind === 'form'
    ? JSON.stringify(dialog.items.map(({ unitPrice, calculation }) => ({ unitPrice, calculation })))
    : ''

  useEffect(() => {
    if (!previewSignature) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      const items = JSON.parse(previewSignature) as Pick<EstimateInputLine, 'unitPrice' | 'calculation'>[]
      void calculateEstimatePreview(items, controller.signal)
        .then((result) => setPreviewState({ signature: previewSignature, result }))
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) {
            setPreviewState({ signature: previewSignature, error: reason instanceof Error ? reason.message : 'Проверьте параметры расчёта.' })
          }
        })
    }, 300)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [previewSignature])

  const currentPreview = previewState?.signature === previewSignature ? previewState : null

  useEffect(() => {
    if (!dialog) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) setDialog(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialog, busy])

  async function reloadEstimates() {
    setError('')
    setLoading(true)
    try {
      setEstimates(await listEstimates())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось обновить список смет.')
    } finally {
      setLoading(false)
    }
  }

  function startCreate() {
    setFormError('')
    setDialog({
      kind: 'form',
      objectId: objectFilter || objects[0]?.id || '',
      title: '',
      note: '',
      items: [newLine()],
    })
  }

  async function openEstimate(id: string) {
    setError('')
    try {
      const estimate = await getEstimate(id)
      const snapshot = await getEstimateVersion(id, estimate.currentVersion)
      setDialog({ kind: 'details', estimate, version: snapshot.version, items: snapshot.items })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось открыть смету.')
    }
  }

  async function openVersion(id: string, versionNumber: number) {
    try {
      const snapshot = await getEstimateVersion(id, versionNumber)
      setDialog((current) => current?.kind === 'details'
        ? { ...current, version: snapshot.version, items: snapshot.items }
        : current)
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Не удалось загрузить версию сметы.')
    }
  }

  function startNewVersion(estimate: EstimateDetails, items: EstimateLine[]) {
    setFormError('')
    setDialog({
      kind: 'form',
      estimateId: estimate.id,
      objectId: estimate.objectId,
      title: estimate.title,
      note: '',
      items: items.map((item) => ({
        key: crypto.randomUUID(),
        description: item.description,
        unit: item.unit,
        unitPrice: item.unitPrice,
        calculation: item.calculation,
      })),
    })
  }

  function updateDraftLine(key: string, update: (line: DraftLine) => DraftLine) {
    setDialog((current) => current?.kind === 'form'
      ? { ...current, items: current.items.map((item) => item.key === key ? update(item) : item) }
      : current)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (dialog?.kind !== 'form') return
    setFormError('')
    setBusy(true)
    const inputLines: EstimateInputLine[] = dialog.items.map(({ description, unit, unitPrice, calculation }) => ({
      description: description.trim(),
      unit: unit.trim(),
      unitPrice: unitPrice.trim().replace(',', '.'),
      calculation: normalizeEstimateCalculation(calculation),
    }))

    try {
      const estimate = dialog.estimateId
        ? await createEstimateVersion(dialog.estimateId, { note: dialog.note.trim(), items: inputLines })
        : await createEstimate({
            objectId: dialog.objectId,
            title: dialog.title.trim(),
            note: dialog.note.trim(),
            items: inputLines,
          })
      await reloadEstimates()
      const snapshot = await getEstimateVersion(estimate.id, estimate.currentVersion)
      setDialog({ kind: 'details', estimate, version: snapshot.version, items: snapshot.items })
      setNotice(dialog.estimateId ? 'Новая версия сметы сохранена.' : 'Смета создана.')
      window.setTimeout(() => setNotice(''), 3500)
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'Не удалось сохранить смету.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="estimates-page" aria-labelledby="estimates-title">
      <div className="estimates-toolbar">
        <div>
          <span className="section-kicker">РАБОЧИЙ МОДУЛЬ</span>
          <h2 id="estimates-title">Сметы</h2>
          <p>Работы, объёмы и стоимость с сохранением каждой версии.</p>
        </div>
        <div className="estimates-toolbar-actions">
          {objects.length > 0 && (
            <label className="estimate-object-filter">Объект
              <select value={objectFilter} onChange={(event) => setObjectFilter(event.target.value)}>
                <option value="">Все объекты</option>
                {objects.map((object) => <option key={object.id} value={object.id}>{object.name}</option>)}
              </select>
            </label>
          )}
          <button className="primary-action" onClick={startCreate} disabled={objects.length === 0}>
            <span aria-hidden="true">+</span> Новая смета
          </button>
        </div>
      </div>

      {notice && <div className="objects-notice" role="status">{notice}</div>}
      {error && (
        <div className="objects-error" role="alert">
          <span>{error}</span>
          <button onClick={() => void reloadEstimates()}>Повторить</button>
        </div>
      )}

      {loading ? (
        <div className="objects-loading">Загружаем сметы…</div>
      ) : visibleEstimates.length > 0 ? (
        <div className="objects-table-wrap">
          <table className="estimates-table">
            <thead>
              <tr><th>Смета</th><th>Объект</th><th>Версия</th><th>Итого</th><th>Изменена</th><th><span className="sr-only">Открыть</span></th></tr>
            </thead>
            <tbody>
              {visibleEstimates.map((estimate) => (
                <tr key={estimate.id}>
                  <td><button className="estimate-open-button" onClick={() => void openEstimate(estimate.id)}>{estimate.title}</button></td>
                  <td>{estimate.objectName}</td>
                  <td><span className="estimate-version-badge">v{estimate.currentVersion}</span></td>
                  <td className="estimate-money">{displayMoney(estimate.total)}</td>
                  <td>{displayDateTime(estimate.updatedAt)}</td>
                  <td><button className="estimate-row-action" onClick={() => void openEstimate(estimate.id)}>Открыть</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : objects.length === 0 ? (
        <div className="estimate-empty">
          <div className="estimate-empty-mark" aria-hidden="true">₽</div>
          <h3>Смету пока не к чему привязать</h3>
          <p>Сначала добавьте объект. После этого здесь можно будет создать для него смету.</p>
        </div>
      ) : (
        <div className="estimate-empty">
          <div className="estimate-empty-mark" aria-hidden="true">₽</div>
          <h3>{objectFilter ? 'У этого объекта пока нет смет' : 'Смет пока нет'}</h3>
          <p>{objectFilter ? 'Создайте первую смету для выбранного объекта.' : 'Создайте первую смету и добавьте работы с объёмами, единицами и ценой.'}</p>
          <button className="primary-action" onClick={startCreate}><span aria-hidden="true">+</span> Новая смета</button>
        </div>
      )}

      {dialog?.kind === 'form' && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDialog(null) }}>
          <section className="dialog-card dialog-wide estimate-dialog" role="dialog" aria-modal="true" aria-labelledby="estimate-form-title">
            <header className="dialog-header">
              <h2 id="estimate-form-title">{dialog.estimateId ? 'Новая версия сметы' : 'Новая смета'}</h2>
              <button className="dialog-close" onClick={() => setDialog(null)} disabled={busy} aria-label="Закрыть">×</button>
            </header>
            <form onSubmit={(event) => void handleSubmit(event)}>
              <div className="estimate-form-meta">
                {dialog.estimateId ? (
                  <>
                    <div className="estimate-meta-card"><span>Объект</span><strong>{objects.find((object) => object.id === dialog.objectId)?.name ?? 'Недоступен'}</strong></div>
                    <div className="estimate-meta-card"><span>Смета</span><strong>{dialog.title}</strong></div>
                  </>
                ) : (
                  <>
                    <label className="form-field">
                      Объект <i aria-hidden="true">*</i>
                      <select required value={dialog.objectId} onChange={(event) => setDialog({ ...dialog, objectId: event.target.value })}>
                        {objects.map((object) => <option key={object.id} value={object.id}>{object.name}</option>)}
                      </select>
                    </label>
                    <label className="form-field">
                      Название сметы <i aria-hidden="true">*</i>
                      <input required maxLength={160} value={dialog.title} onChange={(event) => setDialog({ ...dialog, title: event.target.value })} placeholder="Например, отделочные работы" />
                    </label>
                  </>
                )}
              </div>

              <label className="form-field estimate-note-field">
                Что изменилось в этой версии
                <input maxLength={500} value={dialog.note} onChange={(event) => setDialog({ ...dialog, note: event.target.value })} placeholder={dialog.estimateId ? 'Коротко опишите изменение' : 'Можно оставить пустым'} />
              </label>

              <div className="estimate-lines-heading"><div><span className="section-kicker">ПОЗИЦИИ</span><h3>Работы и стоимость</h3></div><button className="secondary-action" type="button" onClick={() => setDialog({ ...dialog, items: [...dialog.items, newLine()] })} disabled={dialog.items.length >= 500}>Добавить строку</button></div>
              <div className="estimate-line-list">
                {dialog.items.map((item, index) => (
                  <EstimateLineEditor
                    key={item.key}
                    line={item}
                    index={index}
                    preview={currentPreview?.result?.items[index]}
                    previewError={currentPreview?.error}
                    canRemove={dialog.items.length > 1}
                    onChange={(next) => updateDraftLine(item.key, () => next)}
                    onRemove={() => setDialog({ ...dialog, items: dialog.items.filter((line) => line.key !== item.key) })}
                  />
                ))}
              </div>
              <div className={`estimate-preview-summary ${currentPreview?.error ? 'has-error' : ''}`} aria-live="polite">
                <span>{currentPreview?.error ?? 'Предварительный итог — рассчитан сервером'}</span>
                <strong>{currentPreview?.result ? displayMoney(currentPreview.result.total) : 'Считаем…'}</strong>
              </div>
              <p className="estimate-calc-note">Предпросмотр округляет объём до 0,001. При сохранении сервер повторно проверит все формулы, количества и суммы.</p>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="dialog-actions">
                <button className="secondary-action" type="button" onClick={() => setDialog(null)} disabled={busy}>Отмена</button>
                <button className="primary-action" type="submit" disabled={busy}>{busy ? 'Сохраняем…' : dialog.estimateId ? 'Сохранить новую версию' : 'Создать смету'}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {dialog?.kind === 'details' && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null) }}>
          <section className="dialog-card dialog-wide estimate-dialog" role="dialog" aria-modal="true" aria-labelledby="estimate-details-title">
            <header className="dialog-header">
              <div><span className="section-kicker">{dialog.estimate.objectName}</span><h2 id="estimate-details-title">{dialog.estimate.title}</h2></div>
              <button className="dialog-close" onClick={() => setDialog(null)} aria-label="Закрыть">×</button>
            </header>
            <div className="estimate-current-total"><span>Итого · версия {dialog.version.versionNumber}</span><strong>{displayMoney(dialog.version.total)}</strong></div>
            <div className="estimate-snapshot-meta">
              <span>Сохранена {displayDateTime(dialog.version.createdAt)} · {dialog.version.createdBy}</span>
              {dialog.version.note && <p>{dialog.version.note}</p>}
            </div>
            <div className="estimate-lines-scroll estimate-readonly-lines">
              <table className="estimate-edit-table">
                <thead><tr><th>Работа</th><th>Кол-во</th><th>Ед.</th><th>Цена за ед.</th><th>Сумма</th></tr></thead>
                <tbody>
                  {dialog.items.map((item) => (
                    <tr key={item.id}>
                      <td><strong>{item.description}</strong><small className="estimate-calculation-summary">{describeCalculation(item.calculation)}</small></td><td>{displayQuantity(item.quantity)}</td><td>{item.unit}</td>
                      <td>{displayMoney(item.unitPrice)}</td><td className="estimate-money">{displayMoney(item.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <section className="estimate-history" aria-labelledby="estimate-history-title">
              <div className="estimate-history-heading"><h3 id="estimate-history-title">История версий</h3><span>{dialog.estimate.versions.length} {dialog.estimate.versions.length === 1 ? 'версия' : 'версии'}</span></div>
              <ol>
                {dialog.estimate.versions.map((version) => (
                  <li key={version.versionNumber}>
                    <button className={`estimate-history-item ${dialog.version.versionNumber === version.versionNumber ? 'is-current' : ''}`} onClick={() => void openVersion(dialog.estimate.id, version.versionNumber)}>
                      <span className="estimate-version-badge">v{version.versionNumber}</span>
                      <span className="estimate-history-copy"><strong>{displayMoney(version.total)}</strong><small>{displayDateTime(version.createdAt)} · {version.createdBy}{version.note ? ` · ${version.note}` : ''}</small></span>
                      {version.versionNumber === dialog.estimate.currentVersion && <span className="estimate-latest-label">Текущая</span>}
                    </button>
                  </li>
                ))}
              </ol>
            </section>
            {formError && <p className="form-error" role="alert">{formError}</p>}
            <div className="dialog-actions">
              <button className="secondary-action" onClick={() => setDialog(null)}>Закрыть</button>
              {dialog.version.versionNumber === dialog.estimate.currentVersion && (
                <button className="primary-action" onClick={() => startNewVersion(dialog.estimate, dialog.items)}>Создать новую версию</button>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
