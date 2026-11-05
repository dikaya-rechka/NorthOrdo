import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const maxDocumentSize = 10 * 1024 * 1024
const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const extensions = new Set(['.pdf','.txt','.doc','.docx','.xls','.xlsx','.jpg','.jpeg','.png','.webp'])
const projectRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)))

export function validDocumentName(name: string): boolean {
  return name.length > 0 && name.length <= 180 && name === name.trim() &&
    !name.startsWith('.') && !/[<>:"/\\|?*]/.test(name) &&
    !Array.from(name).some((character) => { const code = character.codePointAt(0)!; return code < 32 || (code >= 127 && code <= 159) }) &&
    basename(name) === name && extensions.has(extname(name).toLowerCase())
}
export function documentHash(buffer: Buffer): string { return createHash('sha256').update(buffer).digest('hex') }

export function validDocumentFormat(name: string, buffer: Buffer): boolean {
  if (!validDocumentName(name) || !buffer.length || buffer.length > maxDocumentSize) return false
  const extension = extname(name).toLowerCase()
  const hex = buffer.subarray(0,12).toString('hex')
  if (extension === '.pdf') return buffer.subarray(0,5).toString('ascii') === '%PDF-'
  if (extension === '.png') return hex.startsWith('89504e470d0a1a0a')
  if (extension === '.jpg' || extension === '.jpeg') return hex.startsWith('ffd8ff')
  if (extension === '.webp') return buffer.subarray(0,4).toString('ascii') === 'RIFF' && buffer.subarray(8,12).toString('ascii') === 'WEBP'
  if (extension === '.docx' || extension === '.xlsx') return hex.startsWith('504b0304')
  if (extension === '.doc' || extension === '.xls') return hex.startsWith('d0cf11e0a1b11ae1')
  try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); return !buffer.includes(0) } catch { return false }
}

async function storageRoot() {
  const configured = process.env.NORTHORDO_DOCUMENT_ROOT
  if (configured && !isAbsolute(configured)) throw new Error('Invalid document storage configuration')
  const folder = resolve(configured || join(process.env.LOCALAPPDATA || join(homedir(),'AppData','Local'),'Northordo','documents'))
  const withinProject = relative(projectRoot,folder)
  if (!withinProject || !(withinProject === '..' || withinProject.startsWith('..' + sep) || isAbsolute(withinProject))) throw new Error('Document storage must be outside project')
  await mkdir(folder, { recursive: true, mode: 0o700 })
  if ((await lstat(folder)).isSymbolicLink()) throw new Error('Invalid document storage')
  const actual = await realpath(folder)
  const actualRelative = relative(await realpath(projectRoot), actual)
  if (!actualRelative || !(actualRelative === '..' || actualRelative.startsWith('..' + sep) || isAbsolute(actualRelative))) throw new Error('Invalid document storage')
  return actual
}
async function storagePath(key: string) {
  if (!keyPattern.test(key)) throw new Error('Invalid document key')
  const root = await storageRoot()
  const file = resolve(root,key)
  if (dirname(file) !== root) throw new Error('Invalid document key')
  return { root, file }
}
export async function writeDocument(key: string, buffer: Buffer) {
  const { file } = await storagePath(key)
  const handle = await open(file, 'wx', 0o600)
  try {
    await handle.writeFile(buffer)
    await handle.sync()
  } catch (error) {
    await handle.close()
    await unlink(file).catch(() => {})
    throw error
  }
  await handle.close()
}
export async function removeUncommittedDocument(key: string) {
  const { file } = await storagePath(key)
  await unlink(file).catch(() => {})
}
export async function readDocument(key: string, size: number, hash: string) {
  const { file, root } = await storagePath(key)
  const entry = await lstat(file)
  if (entry.isSymbolicLink() || !entry.isFile() || dirname(await realpath(file)) !== root) throw new Error('Invalid stored document')
  const handle = await open(file, constants.O_RDONLY)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size !== size || size > maxDocumentSize) throw new Error('Invalid stored document')
    const storage = Buffer.alloc(size + 1)
    let received = 0
    while (received < storage.length) {
      const result = await handle.read(storage,received,storage.length - received,received)
      if (!result.bytesRead) break
      received += result.bytesRead
    }
    const buffer = storage.subarray(0,received)
    if (buffer.length !== size || documentHash(buffer) !== hash) throw new Error('Invalid stored document')
    return buffer
  } finally { await handle.close() }
}
export function downloadDisposition(name: string) {
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (value) => '%' + value.charCodeAt(0).toString(16).toUpperCase())
  return 'attachment; filename="document' + extname(name).toLowerCase() + '"; filename*=UTF-8\'\'' + encoded
}
