export type WorkStatus = 'PLANNED' | 'DONE'
export type WorkInput = {
  title: string
  status: WorkStatus
  objectId: string | null
  dueDate: string | null
  note: string
}
export type Work = WorkInput & {
  id: string
  objectName: string | null
  completedAt: string | null
  revision: number
}
export type ObjectOption = { id: string; name: string }
export type WorkList = { works: Work[]; objects: ObjectOption[] }

export class WorkConflict extends Error {}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...options })
  if (response.status === 401) {
    window.location.reload()
    throw new Error('Сессия завершилась. Войдите снова.')
  }
  if (response.status === 409 || response.status === 404) {
    const result = await response.json().catch(() => ({}))
    throw new WorkConflict(result.error === 'object_unavailable'
      ? 'Объект больше недоступен. Закройте форму и выберите действующий объект.'
      : 'Запись уже изменилась. Закройте форму и откройте работу снова, чтобы увидеть актуальные данные.')
  }
  if (response.status === 400) throw new Error('Проверьте название и срок работы.')
  if (!response.ok) throw new Error('Запрос не выполнен. Попробуйте ещё раз.')
  return response.json() as Promise<T>
}

export function listWorks(signal?: AbortSignal) {
  return request<WorkList>('/api/works', { signal })
}

export function saveWork(input: WorkInput, previous?: Work) {
  return request<Work>(previous ? '/api/works/' + previous.id : '/api/works', {
    method: previous ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, revision: previous?.revision }),
  })
}
