export type ObjectStatus = 'PLANNED' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED'

export type WorkObject = {
  id: string
  name: string
  address: string
  customerName: string
  customerPhone: string | null
  customerEmail: string | null
  responsibleName: string | null
  status: ObjectStatus
  startDate: string | null
  completionDate: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export type WorkObjectInput = Omit<WorkObject, 'id' | 'deletedAt' | 'createdAt' | 'updatedAt'>

export type ObjectHistoryEntry = {
  id: string
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE'
  actorUsername: string
  changedFields: string[]
  occurredAt: string
}

export const objectStatusLabels: Record<ObjectStatus, string> = {
  PLANNED: 'Запланирован',
  ACTIVE: 'В работе',
  PAUSED: 'Приостановлен',
  COMPLETED: 'Завершён',
  CANCELLED: 'Отменён',
}

export const objectFieldLabels: Record<string, string> = {
  name: 'Название',
  address: 'Адрес',
  customerName: 'Заказчик',
  customerPhone: 'Телефон заказчика',
  customerEmail: 'Электронная почта',
  responsibleName: 'Ответственный',
  status: 'Статус',
  startDate: 'Дата начала',
  completionDate: 'Дата завершения',
  deletedAt: 'Удаление',
}

async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    window.location.reload()
    throw new Error('Сессия завершилась. Войдите снова.')
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(data?.error === 'invalid_object_data'
      ? 'Проверьте даты и обязательные поля.'
      : 'Не удалось выполнить запрос. Попробуйте ещё раз.')
  }
  return response.json() as Promise<T>
}

export async function listObjects(
  filters: { q?: string; status?: ObjectStatus; deleted?: boolean },
  signal?: AbortSignal,
): Promise<WorkObject[]> {
  const query = new URLSearchParams()
  if (filters.q?.trim()) query.set('q', filters.q.trim())
  if (filters.status) query.set('status', filters.status)
  if (filters.deleted) query.set('deleted', 'true')
  const serializedQuery = query.toString()
  const suffix = serializedQuery ? `?${serializedQuery}` : ''
  const response = await fetch(`/api/objects${suffix}`, { credentials: 'same-origin', signal })
  return readResponse<WorkObject[]>(response)
}

export async function saveObject(input: WorkObjectInput, id?: string): Promise<WorkObject> {
  const response = await fetch(id ? `/api/objects/${id}` : '/api/objects', {
    method: id ? 'PATCH' : 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await readResponse<{ object: WorkObject }>(response)
  return data.object
}

export async function deleteObject(id: string): Promise<WorkObject> {
  const response = await fetch(`/api/objects/${id}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  const data = await readResponse<{ object: WorkObject }>(response)
  return data.object
}

export async function restoreObject(id: string): Promise<WorkObject> {
  const response = await fetch(`/api/objects/${id}/restore`, {
    method: 'POST',
    credentials: 'same-origin',
  })
  const data = await readResponse<{ object: WorkObject }>(response)
  return data.object
}

export async function getObjectHistory(id: string): Promise<ObjectHistoryEntry[]> {
  const response = await fetch(`/api/objects/${id}/history`, { credentials: 'same-origin' })
  return readResponse<ObjectHistoryEntry[]>(response)
}
