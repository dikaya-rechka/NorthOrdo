import type { EstimateCalculation } from './api'

export function displayMoney(value: string): string {
  const [whole = '0', decimal = '00'] = value.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')
  return `${grouped},${decimal.padEnd(2, '0').slice(0, 2)} ₽`
}

export function displayQuantity(value: string): string {
  return value.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1').replace('.', ',')
}

function displayInput(value: string): string {
  return value.replace('.', ',')
}

export function describeCalculation(calculation: EstimateCalculation): string {
  let description: string
  switch (calculation.mode) {
    case 'manual':
      description = `Вручную: ${displayInput(calculation.quantity)}`
      break
    case 'length':
      description = `Длина: ${displayInput(calculation.length)} м`
      break
    case 'area':
      description = `Площадь: ${displayInput(calculation.length)} × ${displayInput(calculation.width)} м`
      break
    case 'perimeter':
      description = `Периметр: 2 × (${displayInput(calculation.length)} + ${displayInput(calculation.width)}) м`
      break
    case 'volume':
      description = `Объём: ${displayInput(calculation.length)} × ${displayInput(calculation.width)} × ${displayInput(calculation.height)} м`
      break
    case 'circle_area':
      description = `Площадь круга: π × ${displayInput(calculation.radius)}² м²`
      break
    case 'circle_circumference':
      description = `Длина окружности: 2 × π × ${displayInput(calculation.radius)} м`
      break
    case 'triangle_area':
      description = `Площадь треугольника: ${displayInput(calculation.base)} × ${displayInput(calculation.height)} ÷ 2 м²`
      break
    case 'cylinder_volume':
      description = `Объём цилиндра: π × ${displayInput(calculation.radius)}² × ${displayInput(calculation.height)} м³`
      break
    case 'wall_area':
      description = `Стены: (${calculation.wallLengths.map(displayInput).join(' + ')}) × ${displayInput(calculation.height)} − проёмы ${displayInput(calculation.openingsArea)} м²`
      break
    case 'formula':
      description = `${calculation.expression} · ${calculation.variables.map((variable) => `${variable.name}=${displayInput(variable.value)}`).join(', ')}`
      break
  }

  const repetitions = Number(calculation.repetitions)
  const waste = Number(calculation.wastePercent.replace(',', '.'))
  if (repetitions > 1) description += ` · повторить ×${repetitions}`
  if (waste > 0) description += ` · запас ${displayInput(calculation.wastePercent)}%`
  return description
}
