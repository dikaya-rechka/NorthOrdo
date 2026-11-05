import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { pool } from '../db.ts'
import type { AppRole } from '../auth/types.ts'

const objectStatuses = ['PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'] as const
type ObjectStatus = typeof objectStatuses[number]

type ObjectInput = {
  name: string
  address: string
  customerName: string
  customerPhone: string | null
  customerEmail: string | null
  responsibleName: string | null
  status: ObjectStatus
  startDate: string | null
  completionDate: string | null
}

type ObjectRow = {
  id: string
  name: string
  address: string
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
  responsible_name: string | null
  status: ObjectStatus
  start_date: string | null
  completion_date: string | null
  deleted_at: Date | null
  created_at: Date
  updated_at: Date
}

type AuditRow = {
  id: string
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE'
  actor_username: string
  changed_fields: string[]
  occurred_at: Date
}

const objectProperties = {
  id: { type: 'string', format: 'uuid' },
  name: { type: 'string' },
  address: { type: 'string' },
  customerName: { type: 'string' },
  customerPhone: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  customerEmail: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  responsibleName: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  status: { type: 'string', enum: objectStatuses },
  startDate: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
  completionDate: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
  deletedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
}

const objectResponseSchema = {
  type: 'object',
  properties: objectProperties,
  required: Object.keys(objectProperties),
  additionalProperties: false,
}

const nullableString = (maxLength: number) => ({
  anyOf: [
    { type: 'string', maxLength },
    { type: 'null' },
  ],
})

const objectBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 120 },
    address: { type: 'string', minLength: 1, maxLength: 300 },
    customerName: { type: 'string', minLength: 1, maxLength: 120 },
    customerPhone: nullableString(40),
    customerEmail: {
      anyOf: [
        { type: 'string', maxLength: 254, format: 'email' },
        { type: 'null' },
      ],
    },
    responsibleName: nullableString(120),
    status: { type: 'string', enum: objectStatuses },
    startDate: nullableString(10),
    completionDate: nullableString(10),
  },
  required: [
    'name', 'address', 'customerName', 'customerPhone', 'customerEmail',
    'responsibleName', 'status', 'startDate', 'completionDate',
  ],
  additionalProperties: false,
}

const roles: AppRole[] = ['OWNER', 'ADMIN']
const changedFieldNames = [
  'name', 'address', 'customerName', 'customerPhone', 'customerEmail',
  'responsibleName', 'status', 'startDate', 'completionDate',
]

function validateDate(value: string | null): boolean {
  if (value === null) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function normalizeInput(input: ObjectInput): ObjectInput | null {
  const normalized: ObjectInput = {
    name: input.name.trim(),
    address: input.address.trim(),
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone?.trim() || null,
    customerEmail: input.customerEmail?.trim().toLowerCase() || null,
    responsibleName: input.responsibleName?.trim() || null,
    status: input.status,
    startDate: input.startDate,
    completionDate: input.completionDate,
  }

  if (!normalized.name || !normalized.address || !normalized.customerName) return null
  if (!validateDate(normalized.startDate) || !validateDate(normalized.completionDate)) return null
  if (normalized.startDate && normalized.completionDate && normalized.completionDate < normalized.startDate) {
    return null
  }

  return normalized
}

function mapObject(row: ObjectRow) {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email,
    responsibleName: row.responsible_name,
    status: row.status,
    startDate: row.start_date,
    completionDate: row.completion_date,
    deletedAt: row.deleted_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function toDbValues(input: ObjectInput) {
  return [
    input.name,
    input.address,
    input.customerName,
    input.customerPhone,
    input.customerEmail,
    input.responsibleName,
    input.status,
    input.startDate,
    input.completionDate,
  ]
}

function isObjectId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

async function sendInvalidObject(reply: FastifyReply) {
  return reply.code(400).send({ error: 'invalid_object_data' })
}

const selectObjectColumns = `
  id, name, address, customer_name, customer_phone, customer_email,
  responsible_name, status, start_date::text AS start_date,
  completion_date::text AS completion_date, deleted_at, created_at, updated_at`

export const objectsRoutes: FastifyPluginAsync = async (server) => {
  server.get('/', {
    config: { requiredRoles: roles },
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string', maxLength: 120 },
          status: { type: 'string', enum: objectStatuses },
          deleted: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      response: {
        200: { type: 'array', items: objectResponseSchema },
      },
    },
  }, async (request) => {
    const query = request.query as { q?: string; status?: ObjectStatus; deleted?: boolean }
    const conditions: string[] = [query.deleted ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL']
    const values: string[] = []

    if (query.q?.trim()) {
      values.push(`%${query.q.trim()}%`)
      conditions.push(`(name ILIKE $${values.length} OR address ILIKE $${values.length} OR customer_name ILIKE $${values.length})`)
    }
    if (query.status) {
      values.push(query.status)
      conditions.push(`status = $${values.length}`)
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const result = await pool.query<ObjectRow>(
      `SELECT ${selectObjectColumns}
         FROM objects
         ${whereClause}
        ORDER BY updated_at DESC, id DESC
        LIMIT 500`,
      values,
    )
    return result.rows.map(mapObject)
  })

  server.get('/:id/history', {
    config: { requiredRoles: roles },
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
        additionalProperties: false,
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              action: { type: 'string', enum: ['CREATE', 'UPDATE', 'DELETE', 'RESTORE'] },
              actorUsername: { type: 'string' },
              changedFields: { type: 'array', items: { type: 'string' } },
              occurredAt: { type: 'string', format: 'date-time' },
            },
            required: ['id', 'action', 'actorUsername', 'changedFields', 'occurredAt'],
            additionalProperties: false,
          },
        },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
          additionalProperties: false,
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!isObjectId(id)) return reply.code(404).send({ error: 'object_not_found' })

    const objectResult = await pool.query('SELECT 1 FROM objects WHERE id = $1', [id])
    if (objectResult.rowCount === 0) return reply.code(404).send({ error: 'object_not_found' })

    const history = await pool.query<AuditRow>(
      `SELECT a.id::text AS id, a.action, u.username AS actor_username,
              a.changed_fields, a.occurred_at
         FROM audit_log AS a
         JOIN app_users AS u ON u.id = a.actor_id
        WHERE a.entity_type = 'object' AND a.entity_id = $1
        ORDER BY a.occurred_at DESC, a.id DESC`,
      [id],
    )

    return history.rows.map((entry) => ({
      id: entry.id,
      action: entry.action,
      actorUsername: entry.actor_username,
      changedFields: entry.changed_fields,
      occurredAt: entry.occurred_at.toISOString(),
    }))
  })

  server.get('/:id', {
    config: { requiredRoles: roles },
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
        additionalProperties: false,
      },
      response: {
        200: objectResponseSchema,
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
          additionalProperties: false,
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!isObjectId(id)) return reply.code(404).send({ error: 'object_not_found' })

    const result = await pool.query<ObjectRow>(
      `SELECT ${selectObjectColumns} FROM objects WHERE id = $1`,
      [id],
    )
    const object = result.rows[0]
    if (!object) return reply.code(404).send({ error: 'object_not_found' })
    return mapObject(object)
  })

  server.post<{ Body: ObjectInput }>('/', {
    config: { requiredRoles: roles },
    schema: {
      body: objectBodySchema,
      response: {
        201: {
          type: 'object',
          properties: { object: objectResponseSchema },
          required: ['object'],
          additionalProperties: false,
        },
        400: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
          additionalProperties: false,
        },
      },
    },
  }, async (request, reply) => {
    const input = normalizeInput(request.body)
    if (!input) return sendInvalidObject(reply)

    const id = randomUUID()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query<ObjectRow>(
        `INSERT INTO objects (
           id, name, address, customer_name, customer_phone, customer_email,
           responsible_name, status, start_date, completion_date, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
         RETURNING ${selectObjectColumns}`,
        [id, ...toDbValues(input), request.currentUser!.id],
      )
      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, changed_fields)
         VALUES ($1, 'CREATE', 'object', $2, $3)`,
        [request.currentUser!.id, id, changedFieldNames],
      )
      await client.query('COMMIT')
      reply.code(201)
      return { object: mapObject(result.rows[0]) }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })

  server.patch<{ Body: ObjectInput }>('/:id', {
    config: { requiredRoles: roles },
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
        additionalProperties: false,
      },
      body: objectBodySchema,
      response: {
        200: {
          type: 'object',
          properties: { object: objectResponseSchema },
          required: ['object'],
          additionalProperties: false,
        },
        400: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
          additionalProperties: false,
        },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
          additionalProperties: false,
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!isObjectId(id)) return reply.code(404).send({ error: 'object_not_found' })
    const input = normalizeInput(request.body)
    if (!input) return sendInvalidObject(reply)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const currentResult = await client.query<ObjectRow>(
        `SELECT ${selectObjectColumns} FROM objects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      )
      const current = currentResult.rows[0]
      if (!current) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ error: 'object_not_found' })
      }

      const currentObject = mapObject(current)
      const values = toDbValues(input)
      const changedFields = changedFieldNames.filter((field, index) => {
        const key = field as keyof ObjectInput
        return currentObject[key] !== values[index]
      })

      if (changedFields.length === 0) {
        await client.query('COMMIT')
        return { object: currentObject }
      }

      const result = await client.query<ObjectRow>(
        `UPDATE objects SET
           name = $2, address = $3, customer_name = $4, customer_phone = $5,
           customer_email = $6, responsible_name = $7, status = $8,
           start_date = $9, completion_date = $10, updated_at = now(), updated_by = $11
         WHERE id = $1
         RETURNING ${selectObjectColumns}`,
        [id, ...values, request.currentUser!.id],
      )
      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, changed_fields)
         VALUES ($1, 'UPDATE', 'object', $2, $3)`,
        [request.currentUser!.id, id, changedFields],
      )
      await client.query('COMMIT')
      return { object: mapObject(result.rows[0]) }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })

  server.delete('/:id', {
    config: { requiredRoles: roles },
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
        additionalProperties: false,
      },
      response: {
        200: {
          type: 'object',
          properties: { object: objectResponseSchema },
          required: ['object'],
          additionalProperties: false,
        },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
          additionalProperties: false,
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!isObjectId(id)) return reply.code(404).send({ error: 'object_not_found' })

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const current = await client.query<ObjectRow>(
        `SELECT ${selectObjectColumns}
           FROM objects
          WHERE id = $1 AND deleted_at IS NULL
          FOR UPDATE`,
        [id],
      )
      if (!current.rows[0]) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ error: 'object_not_found' })
      }

      const result = await client.query<ObjectRow>(
        `UPDATE objects
            SET deleted_at = now(), deleted_by = $2, updated_at = now(), updated_by = $2
          WHERE id = $1
          RETURNING ${selectObjectColumns}`,
        [id, request.currentUser!.id],
      )
      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, changed_fields)
         VALUES ($1, 'DELETE', 'object', $2, ARRAY['deletedAt'])`,
        [request.currentUser!.id, id],
      )
      await client.query('COMMIT')
      return { object: mapObject(result.rows[0]) }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })

  server.post('/:id/restore', {
    config: { requiredRoles: roles },
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
        additionalProperties: false,
      },
      response: {
        200: {
          type: 'object',
          properties: { object: objectResponseSchema },
          required: ['object'],
          additionalProperties: false,
        },
        404: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
          additionalProperties: false,
        },
        409: {
          type: 'object',
          properties: { error: { type: 'string' } },
          required: ['error'],
          additionalProperties: false,
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!isObjectId(id)) return reply.code(404).send({ error: 'object_not_found' })

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const current = await client.query<ObjectRow>(
        `SELECT ${selectObjectColumns} FROM objects WHERE id = $1 FOR UPDATE`,
        [id],
      )
      if (!current.rows[0]) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ error: 'object_not_found' })
      }
      if (!current.rows[0].deleted_at) {
        await client.query('ROLLBACK')
        return reply.code(409).send({ error: 'object_not_deleted' })
      }

      const result = await client.query<ObjectRow>(
        `UPDATE objects
            SET deleted_at = NULL, deleted_by = NULL, updated_at = now(), updated_by = $2
          WHERE id = $1
          RETURNING ${selectObjectColumns}`,
        [id, request.currentUser!.id],
      )
      await client.query(
        `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, changed_fields)
         VALUES ($1, 'RESTORE', 'object', $2, ARRAY['deletedAt'])`,
        [request.currentUser!.id, id],
      )
      await client.query('COMMIT')
      return { object: mapObject(result.rows[0]) }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })
}
