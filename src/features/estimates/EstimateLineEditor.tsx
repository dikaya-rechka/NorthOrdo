import type { EstimateCalculation, EstimateCalculationPreview, EstimateInputLine } from './api'
import { displayMoney, displayQuantity } from './format'

export type DraftEstimateLine = EstimateInputLine & { key: string }

const modeOptions: { value: EstimateCalculation['mode']; label: string }[] = [
  { value: 'manual', label: 'Количество вручную' },
  { value: 'length', label: 'Длина' },
  { value: 'area', label: 'Площадь · длина × ширина' },
  { value: 'perimeter', label: 'Периметр прямоугольника' },
  { value: 'volume', label: 'Объём · длина × ширина × высота' },
  { value: 'circle_area', label: 'Площадь круга · πr²' },
  { value: 'circle_circumference', label: 'Длина окружности · 2πr' },
  { value: 'triangle_area', label: 'Площадь треугольника' },
  { value: 'cylinder_volume', label: 'Объём цилиндра' },
  { value: 'wall_area', label: 'Площадь стен − проёмы' },
  { value: 'formula', label: 'Своя формула' },
]

function createCalculation(mode: EstimateCalculation['mode'], current: EstimateCalculation): EstimateCalculation {
  const common = { repetitions: current.repetitions, wastePercent: current.wastePercent }
  switch (mode) {
    case 'manual': return { mode, ...common, quantity: '1' }
    case 'length': return { mode, ...common, length: '1' }
    case 'area':
    case 'perimeter': return { mode, ...common, length: '1', width: '1' }
    case 'volume': return { mode, ...common, length: '1', width: '1', height: '1' }
    case 'circle_area':
    case 'circle_circumference': return { mode, ...common, radius: '1' }
    case 'triangle_area': return { mode, ...common, base: '1', height: '1' }
    case 'cylinder_volume': return { mode, ...common, radius: '1', height: '1' }
    case 'wall_area': return { mode, ...common, wallLengths: ['1', '1', '1', '1'], height: '2.7', openingsArea: '0' }
    case 'formula': return { mode, ...common, expression: 'A*B', variables: [{ name: 'A', value: '1' }, { name: 'B', value: '1' }] }
  }
}

function suggestedUnit(mode: EstimateCalculation['mode'], current: string): string {
  switch (mode) {
    case 'length':
    case 'perimeter': return 'м'
    case 'area':
    case 'wall_area':
    case 'circle_area':
    case 'triangle_area': return 'м²'
    case 'volume': return 'м³'
    case 'cylinder_volume': return 'м³'
    case 'circle_circumference': return 'м'
    default: return current
  }
}

export function EstimateLineEditor({
  line,
  index,
  preview,
  previewError,
  canRemove,
  onChange,
  onRemove,
}: {
  line: DraftEstimateLine
  index: number
  preview?: EstimateCalculationPreview['items'][number]
  previewError?: string
  canRemove: boolean
  onChange: (next: DraftEstimateLine) => void
  onRemove: () => void
}) {
  const calculation = line.calculation

  function updateCalculation(patch: Record<string, unknown>) {
    onChange({ ...line, calculation: { ...calculation, ...patch } as EstimateCalculation })
  }

  function decimalField(label: string, value: string, update: (value: string) => void, hint?: string) {
    return (
      <label className="estimate-calc-field">
        <span>{label}</span>
        <input type="text" inputMode="decimal" value={value} onChange={(event) => update(event.target.value)} placeholder="0" />
        {hint && <small>{hint}</small>}
      </label>
    )
  }

  function numberFields() {
    switch (calculation.mode) {
      case 'manual':
        return decimalField('Количество', calculation.quantity, (quantity) => updateCalculation({ quantity }))
      case 'length':
        return decimalField('Длина, м', calculation.length, (length) => updateCalculation({ length }))
      case 'area':
        return <>
          {decimalField('Длина, м', calculation.length, (length) => updateCalculation({ length }))}
          {decimalField('Ширина, м', calculation.width, (width) => updateCalculation({ width }))}
        </>
      case 'perimeter':
        return <>
          {decimalField('Длина помещения, м', calculation.length, (length) => updateCalculation({ length }))}
          {decimalField('Ширина помещения, м', calculation.width, (width) => updateCalculation({ width }))}
        </>
      case 'volume':
        return <>
          {decimalField('Длина, м', calculation.length, (length) => updateCalculation({ length }))}
          {decimalField('Ширина, м', calculation.width, (width) => updateCalculation({ width }))}
          {decimalField('Высота, м', calculation.height, (height) => updateCalculation({ height }))}
        </>
      case 'circle_area':
      case 'circle_circumference':
        return decimalField('Радиус, м', calculation.radius, (radius) => updateCalculation({ radius }))
      case 'triangle_area':
        return <>
          {decimalField('Основание, м', calculation.base, (base) => updateCalculation({ base }))}
          {decimalField('Высота, м', calculation.height, (height) => updateCalculation({ height }))}
        </>
      case 'cylinder_volume':
        return <>
          {decimalField('Радиус, м', calculation.radius, (radius) => updateCalculation({ radius }))}
          {decimalField('Высота, м', calculation.height, (height) => updateCalculation({ height }))}
        </>
      case 'wall_area':
        return <>
          <div className="estimate-wall-lengths">
            <div className="estimate-wall-heading"><span>Длины стен, м</span><button type="button" onClick={() => updateCalculation({ wallLengths: [...calculation.wallLengths, '1'] })} disabled={calculation.wallLengths.length >= 20}>+ Стена</button></div>
            <div className="estimate-wall-list">
              {calculation.wallLengths.map((length, wallIndex) => (
                <div className="estimate-wall-row" key={`${line.key}-wall-${wallIndex}`}>
                  <input type="text" inputMode="decimal" aria-label={`Длина стены ${wallIndex + 1}`} value={length} onChange={(event) => updateCalculation({ wallLengths: calculation.wallLengths.map((item, index) => index === wallIndex ? event.target.value : item) })} />
                  <button type="button" onClick={() => updateCalculation({ wallLengths: calculation.wallLengths.filter((_, index) => index !== wallIndex) })} disabled={calculation.wallLengths.length === 1} aria-label={`Убрать стену ${wallIndex + 1}`}>×</button>
                </div>
              ))}
            </div>
          </div>
          {decimalField('Высота стены, м', calculation.height, (height) => updateCalculation({ height }))}
          {decimalField('Общая площадь проёмов, м²', calculation.openingsArea, (openingsArea) => updateCalculation({ openingsArea }), 'Окна и двери вычитаются из площади стен.')}
        </>
      case 'formula':
        return <>
          <label className="estimate-calc-field estimate-formula-expression">
            <span>Формула</span>
            <input type="text" autoComplete="off" maxLength={200} value={calculation.expression} onChange={(event) => updateCalculation({ expression: event.target.value })} placeholder="A*B" />
            <small>Операции + − × ÷ ^, скобки, PI и функции sqrt, abs, sin, cos, tan, min, max. Тригонометрия принимает радианы; градусы: A*PI/180.</small>
          </label>
          <div className="estimate-formula-variables">
            <div className="estimate-wall-heading"><span>Значения переменных</span><button type="button" onClick={() => {
              const used = new Set(calculation.variables.map((variable) => variable.name.toUpperCase()))
              const nextName = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((name) => !used.has(name))
              if (nextName && calculation.variables.length < 10) updateCalculation({ variables: [...calculation.variables, { name: nextName, value: '1' }] })
            }} disabled={calculation.variables.length >= 10}>+ Переменная</button></div>
            {calculation.variables.map((variable, variableIndex) => (
              <div className="estimate-formula-variable" key={`${line.key}-variable-${variableIndex}`}>
                <input type="text" autoComplete="off" aria-label={`Имя переменной ${variableIndex + 1}`} maxLength={8} value={variable.name} onChange={(event) => updateCalculation({ variables: calculation.variables.map((item, index) => index === variableIndex ? { ...item, name: event.target.value.toUpperCase() } : item) })} />
                <span>=</span>
                <input type="text" inputMode="decimal" aria-label={`Значение переменной ${variableIndex + 1}`} value={variable.value} onChange={(event) => updateCalculation({ variables: calculation.variables.map((item, index) => index === variableIndex ? { ...item, value: event.target.value } : item) })} />
                <button type="button" onClick={() => updateCalculation({ variables: calculation.variables.filter((_, index) => index !== variableIndex) })} aria-label={`Удалить переменную ${variable.name}`}>×</button>
              </div>
            ))}
          </div>
        </>
    }
  }

  return (
    <article className="estimate-line-editor">
      <header className="estimate-line-card-header">
        <span>Позиция {index + 1}</span>
        <button className="estimate-remove-line" type="button" onClick={onRemove} disabled={!canRemove} aria-label={`Удалить позицию ${index + 1}`}>×</button>
      </header>
      <div className="estimate-line-main-fields">
        <label className="estimate-calc-field estimate-description-field">
          <span>Наименование работы</span>
          <input type="text" required maxLength={240} value={line.description} onChange={(event) => onChange({ ...line, description: event.target.value })} placeholder="Например, укладка плитки" />
        </label>
        <label className="estimate-calc-field estimate-mode-field">
          <span>Способ расчёта</span>
          <select value={calculation.mode} onChange={(event) => {
            const mode = event.target.value as EstimateCalculation['mode']
            onChange({ ...line, unit: suggestedUnit(mode, line.unit), calculation: createCalculation(mode, calculation) })
          }}>
            {modeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="estimate-calc-field estimate-unit-field">
          <span>Ед. изм.</span>
          <input type="text" required maxLength={24} value={line.unit} onChange={(event) => onChange({ ...line, unit: event.target.value })} placeholder="м²" />
        </label>
        <label className="estimate-calc-field estimate-price-field">
          <span>Цена за единицу, ₽</span>
          <input type="text" required inputMode="decimal" maxLength={12} value={line.unitPrice} onChange={(event) => onChange({ ...line, unitPrice: event.target.value })} placeholder="0,00" />
        </label>
      </div>

      <div className="estimate-calculation-section">
        <div className="estimate-calculation-fields">{numberFields()}</div>
        <div className="estimate-calculation-common">
          <label className="estimate-calc-field">
            <span>Повторить расчёт, раз</span>
            <input type="text" inputMode="numeric" value={calculation.repetitions} onChange={(event) => updateCalculation({ repetitions: event.target.value })} />
            <small>Например, одинаковые комнаты или участки.</small>
          </label>
          <label className="estimate-calc-field">
            <span>Запас, %</span>
            <input type="text" inputMode="decimal" value={calculation.wastePercent} onChange={(event) => updateCalculation({ wastePercent: event.target.value })} />
            <small>Добавляется к расчётному количеству.</small>
          </label>
        </div>
      </div>

      <div className={`estimate-line-preview ${previewError ? 'has-error' : ''}`} role="status">
        {preview
          ? <><span>Расчётное количество: <strong>{displayQuantity(preview.quantity)} {line.unit}</strong></span><b>{displayMoney(preview.lineTotal)}</b></>
          : previewError
            ? <span>{previewError}</span>
            : <span>Введите размеры и цену — сервер покажет расчёт.</span>}
      </div>
    </article>
  )
}
