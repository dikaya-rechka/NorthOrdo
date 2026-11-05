export type Kind = 'INCOME' | 'EXPENSE'
export const categories: Record<Kind, Record<string, string>> = {
  INCOME: { ADVANCE: 'Аванс заказчика', PAYMENT: 'Оплата работ', REFUND: 'Возврат средств', OTHER_INCOME: 'Прочее поступление' },
  EXPENSE: { MATERIALS: 'Материалы', LABOR: 'Оплата труда', TOOLS: 'Инструменты', TRANSPORT: 'Транспорт', OTHER_EXPENSE: 'Прочий расход' },
}
export type EntryInput = { kind: Kind; amount: string; date: string; category: string; objectId: string | null; note: string }
export type Entry = EntryInput & { id: string; revision: number; voided: boolean; objectName: string | null; objectArchived: boolean; linkedPlan: boolean }
export type FinanceData = { entries: Entry[]; totals: { income: string; expense: string; net: string }; objects: { id: string; name: string; archived: boolean }[] }
export type Filters = { from: string; to: string; kind: string; objectId: string; includeVoided: boolean }
export type HistoryEvent = { revision: number; action: string; changedFields: string[]; occurredAt: string; actor: string }

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...options })
  if (response.status === 401) { window.location.reload(); throw new Error('Сессия завершилась. Войдите снова.') }
  if (response.status === 409) throw new Error('Запись изменилась или объект недоступен. Закройте форму, обновите список и повторите действие.')
  if (response.status === 400) throw new Error('Проверьте сумму, категорию и даты. Сумма должна быть больше нуля и содержать не более двух знаков после запятой.')
  if (!response.ok) throw new Error('Запрос не выполнен. Попробуйте ещё раз.')
  return response.json() as Promise<T>
}
export function listFinance(filters: Filters, signal?: AbortSignal) {
  const query = new URLSearchParams()
  if (filters.from) query.set('from', filters.from)
  if (filters.to) query.set('to', filters.to)
  if (filters.kind) query.set('kind', filters.kind)
  if (filters.objectId) query.set('objectId', filters.objectId)
  if (filters.includeVoided) query.set('includeVoided', 'true')
  return request<FinanceData>('/api/finance?' + query, { signal })
}
export function entryInput(entry: Entry): EntryInput {
  return { kind: entry.kind, amount: entry.amount, date: entry.date, category: entry.category, objectId: entry.objectId, note: entry.note }
}
export function saveEntry(input: EntryInput, previous?: Entry, voided = previous?.voided ?? false, requestId?: string) {
  return request<Entry>(previous ? '/api/finance/' + previous.id : '/api/finance', {
    method: previous ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, amount: input.amount.trim().replace(',', '.'), note: input.note.trim(),
      ...(previous ? { revision: previous.revision, voided } : { requestId }) }),
  })
}
export function getHistory(id: string) { return request<HistoryEvent[]>('/api/finance/' + id + '/history') }

export function money(amount: string) {
  const [whole, fraction = ''] = amount.split('.')
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + ',' + fraction.padEnd(2, '0') + ' ₽'
}
export function today() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date()) }
