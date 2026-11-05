import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import type { AppRole } from '../auth/types.ts'
import { pool } from '../db.ts'
import { documentHash, downloadDisposition, maxDocumentSize, readDocument, removeUncommittedDocument, validDocumentFormat, validDocumentName, writeDocument } from './document-storage.ts'

const config = { requiredRoles: ['OWNER','ADMIN'] as AppRole[] }
const uuid = { type: 'string', format: 'uuid' }
const params = { type: 'object', properties: { id: uuid }, required: ['id'] }
const categories = ['CONTRACT','ESTIMATE','ACT','INVOICE','PHOTO','OTHER']
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
type Metadata = { title: string; category: string; objectId: string | null; note: string }
type UploadMetadata = Metadata & { name: string; requestId: string }
const metadataFields = {
  title: { type: 'string', minLength: 1, maxLength: 160 },
  category: { type: 'string', enum: categories },
  objectId: { anyOf: [uuid,{ type: 'null' }] },
  note: { type: 'string', maxLength: 500 },
}
const columns = `d.id,d.title,d.category,d.object_id AS "objectId",o.name AS "objectName",
  (o.deleted_at IS NOT NULL) AS "objectArchived",d.note,d.original_name AS name,d.size_bytes AS size,
  d.archived,d.revision,d.created_at AS "createdAt",u.username AS actor`
const selectDocument = `SELECT ${columns} FROM documents d LEFT JOIN objects o ON o.id=d.object_id JOIN app_users u ON u.id=d.created_by`

function uploadMetadata(header: unknown): UploadMetadata | null {
  if (typeof header !== 'string' || header.length > 8000 || !/^[A-Za-z0-9_-]+$/.test(header)) return null
  try {
    const decoded = Buffer.from(header,'base64url')
    if (decoded.toString('base64url') !== header) return null
    const input = JSON.parse(decoded.toString('utf8'))
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some((key) => !['title','category','objectId','note','name','requestId'].includes(key))) return null
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160 ||
      typeof input.category !== 'string' || !categories.includes(input.category) ||
      typeof input.note !== 'string' || input.note.length > 500 ||
      typeof input.name !== 'string' || !validDocumentName(input.name.normalize('NFC')) ||
      typeof input.requestId !== 'string' || !uuidPattern.test(input.requestId) ||
      !(input.objectId === null || (typeof input.objectId === 'string' && uuidPattern.test(input.objectId)))) return null
    return { title: input.title.trim(), category: input.category, objectId: input.objectId,
      note: input.note.trim(), name: input.name.normalize('NFC'), requestId: input.requestId }
  } catch { return null }
}
async function storageUnavailable(reply: FastifyReply) { return reply.code(503).send({ error: 'storage_unavailable' }) }

export const documentsRoutes: FastifyPluginAsync = async (server) => {
  server.addHook('onSend', async (_request,reply,payload) => {
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff')
    return payload
  })
  server.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: maxDocumentSize }, (_request,body,done) => done(null,body))

  server.get('/', { config }, async () => {
    const [items,objects] = await Promise.all([
      pool.query(selectDocument + ' ORDER BY d.created_at DESC,d.id'),
      pool.query('SELECT id,name,(deleted_at IS NOT NULL) AS archived FROM objects ORDER BY name,id'),
    ])
    return { items: items.rows, objects: objects.rows }
  })

  server.post<{ Body: Buffer }>('/', { config, bodyLimit: maxDocumentSize }, async (request, reply) => {
    const meta = uploadMetadata(request.headers['x-document-meta'])
    if (!meta || !Buffer.isBuffer(request.body) || !validDocumentFormat(meta.name,request.body)) {
      return reply.code(400).send({ error: 'invalid_document' })
    }
    const hash = documentHash(request.body)
    const client = await pool.connect()
    let createdKey: string | null = null
    let committing = false
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [meta.requestId])
      const existing = (await client.query('SELECT * FROM documents WHERE id=$1', [meta.requestId])).rows[0]
      if (existing) {
        const same = existing.sha256 === hash && existing.original_name === meta.name && existing.title === meta.title &&
          existing.category === meta.category && existing.object_id === meta.objectId && existing.note === meta.note && !existing.archived
        const result = same ? (await client.query(selectDocument + ' WHERE d.id=$1', [meta.requestId])).rows[0] : null
        await client.query('COMMIT')
        return same ? result : reply.code(409).send({ error: 'record_changed' })
      }
      if (meta.objectId) {
        const object = await client.query('SELECT id FROM objects WHERE id=$1 AND deleted_at IS NULL FOR SHARE', [meta.objectId])
        if (!object.rowCount) {
          await client.query('ROLLBACK')
          return reply.code(409).send({ error: 'object_unavailable' })
        }
      }
      const key = randomUUID()
      try { await writeDocument(key,request.body); createdKey = key } catch {
        await client.query('ROLLBACK')
        server.log.error('Document storage write failed')
        return storageUnavailable(reply)
      }
      await client.query(`INSERT INTO documents(id,title,category,object_id,note,original_name,file_key,size_bytes,sha256,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [meta.requestId,meta.title,meta.category,meta.objectId,meta.note,meta.name,key,request.body.length,hash,request.currentUser!.id])
      await client.query(`INSERT INTO document_events(document_id,actor_id,action,changed_fields) VALUES($1,$2,'UPLOAD',$3)`,
        [meta.requestId,request.currentUser!.id,['file','title','category','objectId','note']])
      const result = (await client.query(selectDocument + ' WHERE d.id=$1', [meta.requestId])).rows[0]
      committing = true
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      if (createdKey && !committing) await removeUncommittedDocument(createdKey).catch(() => {})
      throw error
    } finally { client.release() }
  })

  server.get('/:id/download', { config, schema: { params } }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const item = (await client.query('SELECT file_key,size_bytes,sha256,original_name,archived FROM documents WHERE id=$1 FOR SHARE', [id])).rows[0]
      if (!item || item.archived) {
        await client.query('ROLLBACK')
        return reply.code(item ? 409 : 404).send({ error: item ? 'document_archived' : 'document_not_found' })
      }
      let buffer: Buffer
      try { buffer = await readDocument(item.file_key,item.size_bytes,item.sha256) } catch {
        await client.query('ROLLBACK')
        server.log.error('Document storage read failed')
        return storageUnavailable(reply)
      }
      await client.query(`INSERT INTO document_events(document_id,actor_id,action) VALUES($1,$2,'DOWNLOAD')`, [id,request.currentUser!.id])
      await client.query('COMMIT')
      return reply.header('Content-Type','application/octet-stream')
        .header('Content-Disposition',downloadDisposition(item.original_name))
        .header('X-Content-Type-Options','nosniff').header('Cache-Control','no-store')
        .header('Content-Security-Policy',"sandbox; default-src 'none'").send(buffer)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally { client.release() }
  })

  server.put<{ Params: { id: string }; Body: Metadata & { revision: number; archived: boolean } }>('/:id', {
    config, schema: { params, body: {
      type: 'object', properties: { ...metadataFields, revision: { type: 'integer', minimum: 1 }, archived: { type: 'boolean' } },
      required: [...Object.keys(metadataFields),'revision','archived'], additionalProperties: false,
    } },
  }, async (request,reply) => {
    const input = request.body, id = request.params.id
    if (!input.title.trim()) return reply.code(400).send({ error: 'invalid_document' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const existing = (await client.query('SELECT title,category,object_id AS "objectId",note,archived,revision FROM documents WHERE id=$1 FOR UPDATE', [id])).rows[0]
      if (!existing || existing.revision !== input.revision) {
        await client.query('ROLLBACK')
        return reply.code(existing ? 409 : 404).send({ error: 'record_changed' })
      }
      if (input.objectId) {
        const object = (await client.query('SELECT deleted_at FROM objects WHERE id=$1 FOR SHARE', [input.objectId])).rows[0]
        if (!object || (object.deleted_at && input.objectId !== existing.objectId)) {
          await client.query('ROLLBACK')
          return reply.code(409).send({ error: 'object_unavailable' })
        }
      }
      const values = { title: input.title.trim(), category: input.category, objectId: input.objectId, note: input.note.trim(), archived: input.archived }
      const changed = Object.keys(values).filter((key) => values[key as keyof typeof values] !== existing[key])
      if (changed.length) {
        await client.query('UPDATE documents SET title=$2,category=$3,object_id=$4,note=$5,archived=$6,revision=revision+1 WHERE id=$1',
          [id,values.title,values.category,values.objectId,values.note,values.archived])
        const action = existing.archived !== values.archived ? values.archived ? 'ARCHIVE' : 'RESTORE' : 'EDIT'
        await client.query('INSERT INTO document_events(document_id,actor_id,action,changed_fields) VALUES($1,$2,$3,$4)', [id,request.currentUser!.id,action,changed])
      }
      const result = (await client.query(selectDocument + ' WHERE d.id=$1', [id])).rows[0]
      await client.query('COMMIT')
      return result
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  })

  server.get('/:id/history', { config, schema: { params } }, async (request,reply) => {
    const { id } = request.params as { id: string }
    if (!(await pool.query('SELECT 1 FROM documents WHERE id=$1', [id])).rowCount) return reply.code(404).send({ error: 'document_not_found' })
    return (await pool.query(`SELECT e.id::text,e.action,e.changed_fields AS "changedFields",e.occurred_at AS "occurredAt",
      u.username AS actor FROM document_events e JOIN app_users u ON u.id=e.actor_id WHERE document_id=$1 ORDER BY e.id DESC`, [id])).rows
  })
}
