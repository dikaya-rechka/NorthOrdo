export const types = { POWER: 'Электроинструмент', HAND: 'Ручной инструмент', MEASURING: 'Измерительный', ACCESS: 'Лестницы и подмости', EQUIPMENT: 'Оборудование', OTHER: 'Другое' }
export const statuses = { AVAILABLE: 'Доступен', IN_USE: 'В работе', REPAIR: 'На обслуживании', LOST: 'Потерян', RETIRED: 'Списан' }
export const conditions = { GOOD: 'Исправен', WORN: 'Есть износ', BROKEN: 'Неисправен' }
export const locations = { WAREHOUSE: 'Общий склад', OBJECT: 'Объект', OTHER: 'Другое место' }
export type ToolInput = {
  name: string; type: keyof typeof types; status: keyof typeof statuses; condition: keyof typeof conditions
  location: keyof typeof locations; objectId: string | null; locationNote: string; responsible: string
  model: string; serialNumber: string; serviceDate: string | null; note: string
}
export type Tool = ToolInput & { id: string; inventoryCode: string; objectName: string | null; objectArchived: boolean; revision: number }
export type ObjectOption = { id: string; name: string; archived: boolean }
export type ToolEvent = Pick<Tool,'location' | 'objectId' | 'objectName' | 'locationNote' | 'status' | 'condition'> & {
  revision: number; action: string; changedFields: string[]; occurredAt: string; actor: string
}
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...options })
  if (response.status === 401) { window.location.reload(); throw new Error('Сессия завершилась. Войдите снова.') }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const messages: Record<string,string> = {
      record_changed: 'Запись уже изменилась. Закройте форму, обновите список и откройте карточку снова.',
      object_unavailable: 'Объект удалён или недоступен. Выберите действующий объект.',
      invalid_tool: 'Проверьте название и местонахождение. Неисправный инструмент может иметь статус «На обслуживании», «Потерян» или «Списан».',
    }
    throw new Error(messages[data.error] ?? 'Не удалось выполнить запрос. Проверьте поля и соединение с сервером.')
  }
  return response.json() as Promise<T>
}
export function listTools(signal?: AbortSignal) { return request<{ items: Tool[]; objects: ObjectOption[] }>('/api/tools', { signal }) }
export function toolInput(tool: Tool): ToolInput {
  return {
    name: tool.name, type: tool.type, status: tool.status, condition: tool.condition, location: tool.location,
    objectId: tool.objectId, locationNote: tool.locationNote, responsible: tool.responsible,
    model: tool.model, serialNumber: tool.serialNumber, serviceDate: tool.serviceDate, note: tool.note,
  }
}
export function saveTool(input: ToolInput, requestId: string, previous?: Tool) {
  return request<Tool>(previous ? '/api/tools/' + previous.id : '/api/tools', {
    method: previous ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, ...(previous ? { revision: previous.revision } : { requestId }) }),
  })
}
export function getToolHistory(id: string) { return request<ToolEvent[]>('/api/tools/' + id + '/history') }
export function place(item: Pick<Tool, 'location' | 'objectName' | 'locationNote'>) {
  return (item.location === 'OBJECT' ? item.objectName ?? 'Объект недоступен' : locations[item.location]) + (item.locationNote ? ' · ' + item.locationNote : '')
}
