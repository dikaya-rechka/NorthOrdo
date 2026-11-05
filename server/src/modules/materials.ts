import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import type { PoolClient } from 'pg'
import type { AppRole } from '../auth/types.ts'
import { pool } from '../db.ts'

const config = { requiredRoles: ['OWNER', 'ADMIN'] as AppRole[] }
const uuid = { type: 'string', format: 'uuid' }
const location = { anyOf: [uuid, { type: 'null' }] }
const dateSchema = { type: 'string', format: 'date', pattern: '^[1-9][0-9]{3}-' }
const params = { type: 'object', properties: { id: uuid }, required: ['id'] }
const cardFields = {
  name: { type: 'string', minLength: 1, maxLength: 160 },
  unit: { type: 'string', minLength: 1, maxLength: 24 },
  note: { type: 'string', maxLength: 1000 },
}
const movementFields = {
  requestId: uuid,
  kind: { type: 'string', enum: ['RECEIPT', 'ISSUE', 'TRANSFER'] },
  quantity: { type: 'string', pattern: '^(?:0|[1-9]\\d{0,10})(?:\\.\\d{1,3})?$' },
  sourceId: location,
  destinationId: location,
  date: dateSchema,
  unitPrice: { anyOf: [{ type: 'string', pattern: '^(?:0|[1-9]\\d{0,11})(?:\\.\\d{1,2})?$' }, { type: 'null' }] },
  supplier: { type: 'string', maxLength: 160 },
  note: { type: 'string', maxLength: 1000 },
}
type Card = { name: string; unit: string; note: string; revision?: number; requestId?: string }
type Movement = {
  requestId: string; kind: 'RECEIPT' | 'ISSUE' | 'TRANSFER'; quantity: string
  sourceId: string | null; destinationId: string | null; date: string
  unitPrice: string | null; supplier: string; note: string
}
class MaterialError extends Error {
  status: number
  constructor(message: string, status = 409) { super(message); this.status = status }
}
function decimal(value: string, places: number) {
  const [whole, fraction = ''] = value.split('.')
  return whole + '.' + fraction.padEnd(places, '0')
}
async function transaction(reply: FastifyReply, run: (client: PoolClient) => Promise<unknown>, readOnly = false) {
  const client = await pool.connect()
  try {
    await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN')
    const result = await run(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    if (error instanceof MaterialError) return reply.code(error.status).send({ error: error.message })
    throw error
  } finally { client.release() }
}
async function material(client: PoolClient, id: string) {
  const row = (await client.query('SELECT id,name,unit,note,revision FROM materials WHERE id=$1 FOR UPDATE', [id])).rows[0]
  if (!row) throw new MaterialError('material_not_found', 404)
  return row
}
async function audit(client: PoolClient, materialId: string, actor: string, action: string, changed: string[], movementId: string | null = null) {
  await client.query(`INSERT INTO material_events(material_id,movement_id,actor_id,action,changed_fields) VALUES($1,$2,$3,$4,$5)`,
    [materialId, movementId, actor, action, changed])
}
async function validateStock(client: PoolClient, id: string) {
  const negative = await client.query('SELECT 1 FROM material_stock WHERE material_id=$1 AND balance<0 LIMIT 1', [id])
  if (negative.rowCount) throw new MaterialError('insufficient_stock')
}
const movementSelect = `SELECT m.id,m.material_id AS "materialId",m.kind,m.quantity::text AS quantity,
 m.source_id AS "sourceId",s.name AS "sourceName",m.destination_id AS "destinationId",d.name AS "destinationName",
 m.movement_date::text AS date,m.unit_price::text AS "unitPrice",m.total::text AS total,m.supplier,m.note,
 m.created_at AS "createdAt",u.username AS actor,m.voided,m.revision,
 EXISTS(SELECT 1 FROM material_purchase_movements pm WHERE pm.movement_id=m.id) AS "linkedPurchase"
 FROM material_movements m LEFT JOIN objects s ON s.id=m.source_id LEFT JOIN objects d ON d.id=m.destination_id
 JOIN app_users u ON u.id=m.created_by`

export const materialsRoutes: FastifyPluginAsync = async (server) => {
  server.get('/', { config }, async (_request, reply) => transaction(reply, async (client) => {
    const items = await client.query(`SELECT m.id,m.name,m.unit,m.note,m.revision,
      COALESCE((SELECT SUM(balance) FROM material_stock WHERE material_id=m.id),0)::text AS balance,
      (EXISTS(SELECT 1 FROM material_movements WHERE material_id=m.id) OR EXISTS(SELECT 1 FROM material_purchases WHERE material_id=m.id)) AS "hasMovements" FROM materials m ORDER BY name,id`)
    const objects = await client.query('SELECT id,name,(deleted_at IS NOT NULL) AS archived FROM objects ORDER BY name,id')
    return { items: items.rows, objects: objects.rows }
  }, true))

  server.get('/:id', { config, schema: { params } }, async (request, reply) => transaction(reply, async (client) => {
    const { id } = request.params as { id: string }
    const item = (await client.query('SELECT id,name,unit,note,revision FROM materials WHERE id=$1', [id])).rows[0]
    if (!item) throw new MaterialError('material_not_found', 404)
    const stock = await client.query(`SELECT b.object_id AS "objectId",o.name AS "objectName",
      (o.deleted_at IS NOT NULL) AS archived,b.balance::text AS balance FROM material_stock b
      LEFT JOIN objects o ON o.id=b.object_id WHERE b.material_id=$1 ORDER BY o.name NULLS FIRST`, [id])
    const movements = await client.query(movementSelect + ' WHERE m.material_id=$1 ORDER BY m.movement_date DESC,m.created_at DESC,m.id', [id])
    const events = await client.query(`SELECT e.action,e.changed_fields AS "changedFields",e.occurred_at AS "occurredAt",
      u.username AS actor FROM material_events e JOIN app_users u ON u.id=e.actor_id WHERE material_id=$1 ORDER BY e.id DESC`, [id])
    return { item, stock: stock.rows, movements: movements.rows, events: events.rows }
  }, true))

  server.post<{ Body: Card }>('/', { config, schema: { body: {
    type: 'object', properties: { ...cardFields, requestId: uuid }, required: [...Object.keys(cardFields), 'requestId'], additionalProperties: false,
  } } }, async (request, reply) => transaction(reply, async (client) => {
    const input = request.body
    const name = input.name.trim(), unit = input.unit.trim(), note = input.note.trim()
    if (!name || !unit) throw new MaterialError('invalid_material', 400)
    const id = input.requestId!
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [id])
    const existing = (await client.query('SELECT * FROM materials WHERE id=$1', [id])).rows[0]
    if (existing) {
      if (existing.name !== name || existing.unit !== unit || existing.note !== note) throw new MaterialError('record_changed')
      return existing
    }
    const result = await client.query('INSERT INTO materials(id,name,unit,note) VALUES($1,$2,$3,$4) RETURNING *', [id, name, unit, note])
    await audit(client, id, request.currentUser!.id, 'CREATE', ['name','unit','note'])
    return result.rows[0]
  }))

  server.put<{ Params: { id: string }; Body: Card }>('/:id', { config, schema: { params, body: {
    type: 'object', properties: { ...cardFields, revision: { type: 'integer', minimum: 1 } },
    required: [...Object.keys(cardFields), 'revision'], additionalProperties: false,
  } } }, async (request, reply) => transaction(reply, async (client) => {
    const { id } = request.params, input = request.body
    const current = await material(client, id)
    if (current.revision !== input.revision) throw new MaterialError('record_changed')
    const normalized = { name: input.name.trim(), unit: input.unit.trim(), note: input.note.trim() }
    if (!normalized.name || !normalized.unit) throw new MaterialError('invalid_material', 400)
    if (normalized.unit !== current.unit && (await client.query('SELECT 1 FROM material_movements WHERE material_id=$1 UNION ALL SELECT 1 FROM material_purchases WHERE material_id=$1 LIMIT 1', [id])).rowCount) {
      throw new MaterialError('unit_locked')
    }
    const changed = Object.keys(normalized).filter((key) => normalized[key as keyof typeof normalized] !== current[key])
    if (!changed.length) return current
    const result = await client.query('UPDATE materials SET name=$2,unit=$3,note=$4,revision=revision+1 WHERE id=$1 RETURNING *',
      [id, normalized.name, normalized.unit, normalized.note])
    await audit(client, id, request.currentUser!.id, 'EDIT', changed)
    return result.rows[0]
  }))

  server.post<{ Params: { id: string }; Body: Movement }>('/:id/movements', { config, schema: { params, body: {
    type: 'object', properties: movementFields, required: Object.keys(movementFields), additionalProperties: false,
  } } }, async (request, reply) => transaction(reply, async (client) => {
    const { id } = request.params, input = request.body
    await material(client, id)
    if (!/[1-9]/.test(input.quantity)) throw new MaterialError('invalid_quantity', 400)
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date())
    if (input.date > today) throw new MaterialError('future_date', 400)
    if ((input.kind === 'RECEIPT' && input.sourceId !== null) ||
      (input.kind === 'ISSUE' && input.destinationId !== null) ||
      (input.kind === 'TRANSFER' && input.sourceId === input.destinationId) ||
      (input.kind !== 'RECEIPT' && (input.unitPrice !== null || input.supplier.trim() !== ''))) {
      throw new MaterialError('invalid_movement', 400)
    }
    const normalized = {
      kind: input.kind, quantity: decimal(input.quantity,3), sourceId: input.sourceId, destinationId: input.destinationId,
      date: input.date, unitPrice: input.unitPrice === null ? null : decimal(input.unitPrice,2), supplier: input.supplier.trim(), note: input.note.trim(),
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [input.requestId])
    const previous = (await client.query(movementSelect + ' WHERE m.id=$1', [input.requestId])).rows[0]
    if (previous) {
      if (previous.materialId !== id || Object.keys(normalized).some((key) => previous[key] !== normalized[key as keyof typeof normalized])) throw new MaterialError('record_changed')
      return previous
    }
    const locations = [...new Set([input.sourceId,input.destinationId].filter((value): value is string => value !== null))]
    if (locations.length) {
      const active = await client.query('SELECT id FROM objects WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY id FOR SHARE', [locations])
      if (active.rowCount !== locations.length) throw new MaterialError('object_unavailable')
    }
    await client.query(`INSERT INTO material_movements(id,material_id,kind,quantity,source_id,destination_id,movement_date,unit_price,supplier,note,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [input.requestId,id,normalized.kind,normalized.quantity,input.sourceId,input.destinationId,input.date,normalized.unitPrice,normalized.supplier,normalized.note,request.currentUser!.id])
    await validateStock(client, id)
    await audit(client, id, request.currentUser!.id, 'MOVEMENT', ['movement'], input.requestId)
    return (await client.query(movementSelect + ' WHERE m.id=$1', [input.requestId])).rows[0]
  }))

  server.put<{ Params: { id: string; movementId: string }; Body: { voided: boolean; revision: number } }>('/:id/movements/:movementId', {
    config, schema: {
      params: { type: 'object', properties: { id: uuid, movementId: uuid }, required: ['id','movementId'] },
      body: { type: 'object', properties: { voided: { type: 'boolean' }, revision: { type: 'integer', minimum: 1 } }, required: ['voided','revision'], additionalProperties: false },
    },
  }, async (request, reply) => transaction(reply, async (client) => {
    const { id, movementId } = request.params
    await material(client, id)
    const current = (await client.query('SELECT revision,voided FROM material_movements WHERE id=$1 AND material_id=$2 FOR UPDATE', [movementId,id])).rows[0]
    if (!current) throw new MaterialError('movement_not_found', 404)
    if ((await client.query('SELECT 1 FROM material_purchase_movements WHERE movement_id=$1', [movementId])).rowCount) throw new MaterialError('purchase_movement_locked')
    if (current.revision !== request.body.revision) throw new MaterialError('record_changed')
    if (current.voided !== request.body.voided) {
      await client.query('UPDATE material_movements SET voided=$2,revision=revision+1 WHERE id=$1', [movementId,request.body.voided])
      await validateStock(client, id)
      await audit(client, id, request.currentUser!.id, request.body.voided ? 'VOID' : 'RESTORE', ['voided'], movementId)
    }
    return (await client.query(movementSelect + ' WHERE m.id=$1', [movementId])).rows[0]
  }))
}
