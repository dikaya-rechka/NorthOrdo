import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import type { AppRole } from '../auth/types.ts'
import { pool } from '../db.ts'

type Input = {
  name: string; type: string; status: string; condition: string; location: string
  objectId: string | null; locationNote: string; responsible: string; model: string
  serialNumber: string; serviceDate: string | null; note: string; revision?: number; requestId?: string
}
type Route = { Body: Input; Params: { id?: string } }
const config = { requiredRoles: ['OWNER','ADMIN'] as AppRole[] }
const uuid = { type: 'string', format: 'uuid' }
const fields = {
  name: { type: 'string', minLength: 1, maxLength: 160 },
  type: { type: 'string', enum: ['POWER','HAND','MEASURING','ACCESS','EQUIPMENT','OTHER'] },
  status: { type: 'string', enum: ['AVAILABLE','IN_USE','REPAIR','LOST','RETIRED'] },
  condition: { type: 'string', enum: ['GOOD','WORN','BROKEN'] },
  location: { type: 'string', enum: ['WAREHOUSE','OBJECT','OTHER'] },
  objectId: { anyOf: [uuid,{ type: 'null' }] },
  locationNote: { type: 'string', maxLength: 240 },
  responsible: { type: 'string', maxLength: 120 },
  model: { type: 'string', maxLength: 120 },
  serialNumber: { type: 'string', maxLength: 120 },
  serviceDate: { anyOf: [{ type: 'string', format: 'date', pattern: '^[1-9][0-9]{3}-' },{ type: 'null' }] },
  note: { type: 'string', maxLength: 1000 },
}
const columns = `t.id,'ИН-'||t.inventory_number::text AS "inventoryCode",t.name,t.type,t.status,t.condition,
  t.location,t.object_id AS "objectId",o.name AS "objectName",(o.deleted_at IS NOT NULL) AS "objectArchived",
  t.location_note AS "locationNote",t.responsible,t.model,t.serial_number AS "serialNumber",
  t.service_date::text AS "serviceDate",t.note,t.revision`
const select = `SELECT ${columns} FROM tool_assets t LEFT JOIN objects o ON o.id=t.object_id`

async function save(request: FastifyRequest<Route>, reply: FastifyReply) {
  const input = request.body
  const normalized = {
    name: input.name.trim(), type: input.type, status: input.status, condition: input.condition,
    location: input.location, objectId: input.objectId, locationNote: input.locationNote.trim(),
    responsible: input.responsible.trim(), model: input.model.trim(), serialNumber: input.serialNumber.trim(),
    serviceDate: input.serviceDate, note: input.note.trim(),
  }
  if (!normalized.name || (normalized.location === 'OBJECT') !== (normalized.objectId !== null) ||
      (normalized.location === 'OTHER' && !normalized.locationNote) ||
      (normalized.condition === 'BROKEN' && ['AVAILABLE','IN_USE'].includes(normalized.status))) {
    return reply.code(400).send({ error: 'invalid_tool' })
  }
  const editing = Boolean(request.params.id)
  const id = request.params.id ?? input.requestId!
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (!editing) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [id])
    const previous = (await client.query(select + ' WHERE t.id=$1 FOR UPDATE OF t', [id])).rows[0]
    if (editing && !previous) {
      await client.query('ROLLBACK')
      return reply.code(404).send({ error: 'tool_not_found' })
    }
    const changed = Object.keys(normalized).filter((key) => normalized[key as keyof typeof normalized] !== previous?.[key])
    if (!editing && previous) {
      await client.query('COMMIT')
      return changed.length ? reply.code(409).send({ error: 'record_changed' }) : previous
    }
    if (editing && previous.revision !== input.revision) {
      await client.query('ROLLBACK')
      return reply.code(409).send({ error: 'record_changed' })
    }
    if (normalized.objectId) {
      const parent = (await client.query('SELECT deleted_at FROM objects WHERE id=$1 FOR SHARE', [normalized.objectId])).rows[0]
      if (!parent || (parent.deleted_at && previous?.objectId !== normalized.objectId)) {
        await client.query('ROLLBACK')
        return reply.code(409).send({ error: 'object_unavailable' })
      }
    }
    if (!changed.length) {
      await client.query('COMMIT')
      return previous
    }
    const values = [id,normalized.name,normalized.type,normalized.status,normalized.condition,
      normalized.location,normalized.objectId,normalized.locationNote,normalized.responsible,
      normalized.model,normalized.serialNumber,normalized.serviceDate,normalized.note]
    if (previous) {
      await client.query(`UPDATE tool_assets SET name=$2,type=$3,status=$4,condition=$5,location=$6,
        object_id=$7,location_note=$8,responsible=$9,model=$10,serial_number=$11,service_date=$12,note=$13,
        revision=revision+1 WHERE id=$1`, values)
    } else {
      await client.query(`INSERT INTO tool_assets(id,name,type,status,condition,location,object_id,location_note,responsible,model,serial_number,service_date,note)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, values)
    }
    const action = !previous ? 'CREATE' : changed.some((field) => ['location','objectId','locationNote'].includes(field)) ? 'MOVE' : 'UPDATE'
    await client.query(`INSERT INTO tool_events(tool_id,revision,actor_id,action,changed_fields,location,object_id,location_note,status,condition)
      SELECT id,revision,$2,$3,$4,location,object_id,location_note,status,condition FROM tool_assets WHERE id=$1`,
      [id,request.currentUser!.id,action,changed])
    const result = (await client.query(select + ' WHERE t.id=$1', [id])).rows[0]
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

export const toolsRoutes: FastifyPluginAsync = async (server) => {
  server.get('/', { config }, async () => {
    const [items,objects] = await Promise.all([
      pool.query(select + ' ORDER BY t.inventory_number DESC'),
      pool.query('SELECT id,name,(deleted_at IS NOT NULL) AS archived FROM objects ORDER BY name,id'),
    ])
    return { items: items.rows, objects: objects.rows }
  })
  server.get('/:id/history', { config, schema: { params: { type: 'object', properties: { id: uuid }, required: ['id'] } } }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!(await pool.query('SELECT 1 FROM tool_assets WHERE id=$1', [id])).rowCount) return reply.code(404).send({ error: 'tool_not_found' })
    const result = await pool.query(`SELECT e.revision,e.action,e.changed_fields AS "changedFields",e.location,
      e.object_id AS "objectId",o.name AS "objectName",e.location_note AS "locationNote",e.status,e.condition,
      e.occurred_at AS "occurredAt",u.username AS actor
      FROM tool_events e JOIN app_users u ON u.id=e.actor_id LEFT JOIN objects o ON o.id=e.object_id
      WHERE tool_id=$1 ORDER BY e.revision DESC`, [id])
    return result.rows
  })
  server.post<Route>('/', { config, schema: { body: {
    type: 'object', properties: { ...fields, requestId: uuid }, required: [...Object.keys(fields),'requestId'], additionalProperties: false,
  } } }, save)
  server.put<Route>('/:id', { config, schema: {
    params: { type: 'object', properties: { id: uuid }, required: ['id'] },
    body: { type: 'object', properties: { ...fields, revision: { type: 'integer', minimum: 1 } }, required: [...Object.keys(fields),'revision'], additionalProperties: false },
  } }, save)
}
