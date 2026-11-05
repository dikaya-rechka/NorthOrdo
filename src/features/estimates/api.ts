export type EstimateObjectOption = {
  id: string
  name: string
}

export type EstimateListItem = {
  id: string
  objectId: string
  objectName: string
  title: string
  currentVersion: number
  total: string
  updatedAt: string
}

export type EstimateVersion = {
  versionNumber: number
  note: string
  total: string
  createdAt: string
  createdBy: string
}

export type EstimateDetails = EstimateListItem & {
  updatedBy: string
  versions: EstimateVersion[]
}

export type CalculationBase = {
  repetitions: string
  wastePercent: string
}

export type EstimateCalculation = CalculationBase & (
  | { mode: 'manual'; quantity: string }
  | { mode: 'length'; length: string }
  | { mode: 'area'; length: string; width: string }
  | { mode: 'perimeter'; length: string; width: string }
  | { mode: 'volume'; length: string; width: string; height: string }
  | { mode: 'circle_area'; radius: string }
  | { mode: 'circle_circumference'; radius: string }
  | { mode: 'triangle_area'; base: string; height: string }
  | { mode: 'cylinder_volume'; radius: string; height: string }
  | { mode: 'wall_area'; wallLengths: string[]; height: string; openingsArea: string }
  | { mode: 'formula'; expression: string; variables: { name: string; value: string }[] }
)

export type EstimateLine = {
  id: string
  position: number
  description: string
  quantity: string
  unit: string
  unitPrice: string
  lineTotal: string
  calculation: EstimateCalculation
}

export type EstimateInputLine = {
  description: string
  unit: string
  unitPrice: string
  calculation: EstimateCalculation
}

export type EstimateCalculationPreview = {
  items: { quantity: string; lineTotal: string }[]
  total: string
}

function decimalForApi(value: string): string {
  return value.trim().replace(',', '.')
}

export function normalizeEstimateCalculation(calculation: EstimateCalculation): EstimateCalculation {
  const common = {
    repetitions: calculation.repetitions,
    wastePercent: decimalForApi(calculation.wastePercent),
  }
  switch (calculation.mode) {
    case 'manual':
      return { ...common, mode: calculation.mode, quantity: decimalForApi(calculation.quantity) }
    case 'length':
      return { ...common, mode: calculation.mode, length: decimalForApi(calculation.length) }
    case 'area':
    case 'perimeter':
      return { ...common, mode: calculation.mode, length: decimalForApi(calculation.length), width: decimalForApi(calculation.width) }
    case 'volume':
      return {
        ...common,
        mode: calculation.mode,
        length: decimalForApi(calculation.length),
        width: decimalForApi(calculation.width),
        height: decimalForApi(calculation.height),
      }
    case 'circle_area':
    case 'circle_circumference':
      return { ...common, mode: calculation.mode, radius: decimalForApi(calculation.radius) }
    case 'triangle_area':
      return { ...common, mode: calculation.mode, base: decimalForApi(calculation.base), height: decimalForApi(calculation.height) }
    case 'cylinder_volume':
      return { ...common, mode: calculation.mode, radius: decimalForApi(calculation.radius), height: decimalForApi(calculation.height) }
    case 'wall_area':
      return {
        ...common,
        mode: calculation.mode,
        wallLengths: calculation.wallLengths.map(decimalForApi),
        height: decimalForApi(calculation.height),
        openingsArea: decimalForApi(calculation.openingsArea),
      }
    case 'formula':
      return {
        ...common,
        mode: calculation.mode,
        expression: calculation.expression,
        variables: calculation.variables.map((variable) => ({ ...variable, value: decimalForApi(variable.value) })),
      }
  }
}

export type EstimateInput = {
  objectId: string
  title: string
  note: string
  items: EstimateInputLine[]
}

export type EstimateVersionInput = {
  note: string
  items: EstimateInputLine[]
}

async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    window.location.reload()
    throw new Error('Сессия завершилась. Войдите снова.')
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(data?.error === 'invalid_estimate_data'
      ? 'Проверьте название и позиции сметы.'
      : data?.error === 'object_not_found'
        ? 'Объект уже недоступен. Обновите список и выберите другой.'
        : 'Не удалось выполнить запрос. Попробуйте ещё раз.')
  }
  return response.json() as Promise<T>
}

export async function listEstimates(signal?: AbortSignal): Promise<EstimateListItem[]> {
  const response = await fetch('/api/estimates', { credentials: 'same-origin', signal })
  return readResponse<EstimateListItem[]>(response)
}

export async function listEstimateObjects(signal?: AbortSignal): Promise<EstimateObjectOption[]> {
  const response = await fetch('/api/estimates/objects', { credentials: 'same-origin', signal })
  return readResponse<EstimateObjectOption[]>(response)
}

export async function getEstimate(id: string): Promise<EstimateDetails> {
  const response = await fetch(`/api/estimates/${id}`, { credentials: 'same-origin' })
  return readResponse<EstimateDetails>(response)
}

export async function getEstimateVersion(id: string, versionNumber: number): Promise<{
  version: EstimateVersion
  items: EstimateLine[]
}> {
  const response = await fetch(`/api/estimates/${id}/versions/${versionNumber}`, { credentials: 'same-origin' })
  return readResponse<{ version: EstimateVersion; items: EstimateLine[] }>(response)
}

export async function calculateEstimatePreview(
  items: Pick<EstimateInputLine, 'unitPrice' | 'calculation'>[],
  signal?: AbortSignal,
): Promise<EstimateCalculationPreview> {
  const response = await fetch('/api/estimates/calculate', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: items.map((item) => ({
        ...item,
        unitPrice: decimalForApi(item.unitPrice),
        calculation: normalizeEstimateCalculation(item.calculation),
      })),
    }),
    signal,
  })
  return readResponse<EstimateCalculationPreview>(response)
}

export async function createEstimate(input: EstimateInput): Promise<EstimateDetails> {
  const response = await fetch('/api/estimates', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await readResponse<{ estimate: EstimateDetails }>(response)
  return data.estimate
}

export async function createEstimateVersion(id: string, input: EstimateVersionInput): Promise<EstimateDetails> {
  const response = await fetch(`/api/estimates/${id}/versions`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await readResponse<{ estimate: EstimateDetails }>(response)
  return data.estimate
}
