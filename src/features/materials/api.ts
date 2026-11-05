export type Material = { id: string; name: string; unit: string; note: string; revision: number; balance: string; hasMovements: boolean }
export type CardInput = Pick<Material, 'name' | 'unit' | 'note'>
export type ObjectOption = { id: string; name: string; archived: boolean }
export type MovementInput = {
  kind: 'RECEIPT' | 'ISSUE' | 'TRANSFER'; quantity: string; sourceId: string | null; destinationId: string | null
  date: string; unitPrice: string | null; supplier: string; note: string
}
export type Movement = MovementInput & { id: string; materialId: string; sourceName: string | null; destinationName: string | null; total: string | null; actor: string; createdAt: string; revision: number; voided: boolean; linkedPurchase: boolean }
export type Detail = {
  item: Material
  stock: { objectId: string | null; objectName: string | null; archived: boolean; balance: string }[]
  movements: Movement[]
  events: { action: string; actor: string; occurredAt: string; changedFields: string[] }[]
}
export const movementLabels = { RECEIPT: 'Поступление', ISSUE: 'Списание', TRANSFER: 'Перемещение' }
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...options })
  if (response.status === 401) { window.location.reload(); throw new Error('Сессия завершилась. Войдите снова.') }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const messages: Record<string,string> = {
      insufficient_stock: 'Недостаточно материала в выбранном месте хранения. Действие не сохранено.',
      unit_locked: 'После первого движения единицу измерения менять нельзя.',
      purchase_movement_locked: 'Поступление связано с закупкой. Измените её статус в списке закупок.',
      object_unavailable: 'Объект удалён или недоступен. Выберите действующий объект.',
      record_changed: 'Запись уже изменилась. Закройте форму и обновите список.',
      future_date: 'Движение можно записать сегодняшней или прошедшей датой.',
      invalid_quantity: 'Количество должно быть больше нуля.',
      invalid_movement: 'Проверьте места хранения и параметры движения.',
      invalid_material: 'Введите название и единицу измерения.',
    }
    throw new Error(messages[data.error] ?? 'Проверьте поля и соединение с сервером. Количество допускает три знака после запятой, цена — два.')
  }
  return response.json() as Promise<T>
}
const json = (body: unknown, method: string) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
export function listMaterials(signal?: AbortSignal) { return request<{ items: Material[]; objects: ObjectOption[] }>('/api/materials', { signal }) }
export function getMaterial(id: string, signal?: AbortSignal) { return request<Detail>('/api/materials/' + id, { signal }) }
export function saveCard(input: CardInput, requestId: string, previous?: Material) {
  return request<Material>(previous ? '/api/materials/' + previous.id : '/api/materials',
    json({ ...input, ...(previous ? { revision: previous.revision } : { requestId }) }, previous ? 'PUT' : 'POST'))
}
export function saveMovement(materialId: string, input: MovementInput, requestId: string) {
  return request<Movement>('/api/materials/' + materialId + '/movements', json({
    ...input, quantity: input.quantity.trim().replace(',', '.'),
    unitPrice: input.unitPrice?.trim().replace(',', '.') ?? null, requestId,
  }, 'POST'))
}
export function setVoided(materialId: string, movement: Movement) {
  return request<Movement>('/api/materials/' + materialId + '/movements/' + movement.id,
    json({ revision: movement.revision, voided: !movement.voided }, 'PUT'))
}
export function quantity(value: string) { return value.replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1').replace('.', ',') }
export function money(value: string) {
  const [whole, fraction = ''] = value.split('.')
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + ',' + fraction.padEnd(2,'0') + ' ₽'
}
export function today() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date()) }
