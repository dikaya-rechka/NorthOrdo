export const categories = { CONTRACT: 'Договор', ESTIMATE: 'Смета', ACT: 'Акт', INVOICE: 'Счёт / накладная', PHOTO: 'Фото', OTHER: 'Другое' }
export const acceptedFiles = '.pdf,.txt,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp'
export const maxFileSize = 10 * 1024 * 1024
export type Metadata = { title: string; category: keyof typeof categories; objectId: string | null; note: string }
export type DocumentItem = Metadata & { id: string; name: string; size: number; archived: boolean; revision: number; actor: string; createdAt: string; objectName: string | null; objectArchived: boolean }
export type ObjectOption = { id: string; name: string; archived: boolean }
export type HistoryEvent = { id: string; action: string; changedFields: string[]; actor: string; occurredAt: string }
async function read<T>(response: Response): Promise<T> {
  if (response.status === 401) { window.location.reload(); throw new Error('Сессия завершилась. Войдите снова.') }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}))
    const messages: Record<string,string> = {
      invalid_document: 'Проверьте название, формат и размер файла. Файл должен быть непустым и соответствовать своему расширению.',
      record_changed: 'Запись изменилась. Закройте форму, обновите список и проверьте сохранённые документы.',
      object_unavailable: 'Объект недоступен. Выберите действующий объект.',
      document_archived: 'Документ находится в архиве. Восстановите его перед скачиванием.',
      document_not_found: 'Документ не найден.',
      storage_unavailable: 'Не удалось прочитать или сохранить вложение. Обратитесь к владельцу системы.',
    }
    throw new Error(response.status === 413 ? 'Размер файла превышает 10 МиБ.' : messages[result.error] ?? 'Запрос не выполнен. Проверьте соединение и попробуйте снова.')
  }
  return response.json() as Promise<T>
}
export async function listDocuments(signal?: AbortSignal) { return read<{ items: DocumentItem[]; objects: ObjectOption[] }>(await fetch('/api/documents', { credentials: 'same-origin', signal })) }
export async function uploadDocument(file: File, meta: Metadata, requestId: string) {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...meta, name: file.name, requestId }))
  const header = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
  return read<DocumentItem>(await fetch('/api/documents', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream', 'X-Document-Meta': header }, body: file,
  }))
}
export function metadata(item: DocumentItem): Metadata { return { title: item.title, category: item.category, objectId: item.objectId, note: item.note } }
export async function saveMetadata(item: DocumentItem, input: Metadata, archived = item.archived) {
  return read<DocumentItem>(await fetch('/api/documents/' + item.id, {
    method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, revision: item.revision, archived }),
  }))
}
export async function downloadDocument(item: DocumentItem) {
  const response = await fetch('/api/documents/' + item.id + '/download', { credentials: 'same-origin' })
  if (!response.ok) { await read(response); return }
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url; link.download = item.name
  document.body.append(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export async function getHistory(id: string) { return read<HistoryEvent[]>(await fetch('/api/documents/' + id + '/history', { credentials: 'same-origin' })) }
export function sizeLabel(size: number) { return size < 1024 ? size + ' Б' : size < 1024 * 1024 ? (size / 1024).toFixed(1) + ' КиБ' : (size / (1024 * 1024)).toFixed(1) + ' МиБ' }
export function timestamp(value: string) { return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow' }).format(new Date(value)) }
