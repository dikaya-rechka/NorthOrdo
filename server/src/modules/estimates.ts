import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import type { PoolClient } from 'pg'
import { pool } from '../db.ts'
import type { AppRole } from '../auth/types.ts'
import { calculateEstimateQuantity, type EstimateCalculationInput } from './estimate-calculation.ts'

type EstimateItemInput = {
  description: string
  unit: string
  unitPrice: string
  calculation: EstimateCalculationInput
}

type NormalizedEstimateItem = EstimateItemInput & {
  quantity: string
}

type EstimateInput = {
  objectId: string
  title: string
  note?: string
  items: EstimateItemInput[]
}

type VersionInput = {
  note?: string
  items: EstimateItemInput[]
}

type EstimatePreviewInput = {
  items: { unitPrice: string; calculation: EstimateCalculationInput }[]
}

type EstimateListRow = {
  id: string
  object_id: string
  object_name: string
  title: string
  current_version: number
  total: string
  updated_at: Date
}

type EstimateRow = EstimateListRow & {
  updated_by_username: string
}

type VersionRow = {
  version_number: number
  note: string
  total: string
  created_at: Date
  created_by_username: string
}

type ItemRow = {
  id: string
  position: number
  description: string
  quantity: string
  unit: string
  unit_price: string
  line_total: string
  calculation: unknown
}

const roles: AppRole[] = ['OWNER', 'ADMIN']
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const decimalPattern = '^(?:0|[1-9]\\d{0,5})(?:\\.\\d{1,3})?$'
const pricePattern = '^(?:0|[1-9]\\d{0,5})(?:\\.\\d{1,2})?$'

const calculationSchema = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['manual', 'length', 'area', 'perimeter', 'volume', 'circle_area', 'circle_circumference', 'triangle_area', 'cylinder_volume', 'wall_area', 'formula'] },
    quantity: { type: 'string', pattern: decimalPattern },
    length: { type: 'string', pattern: decimalPattern },
    width: { type: 'string', pattern: decimalPattern },
    height: { type: 'string', pattern: decimalPattern },
    radius: { type: 'string', pattern: decimalPattern },
    base: { type: 'string', pattern: decimalPattern },
    wallLengths: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', pattern: decimalPattern } },
    openingsArea: { type: 'string', pattern: decimalPattern },
    expression: { type: 'string', minLength: 1, maxLength: 200 },
    variables: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 8 },
          value: { type: 'string', pattern: decimalPattern },
        },
        required: ['name', 'value'],
        additionalProperties: false,
      },
    },
    repetitions: { type: 'string', pattern: '^[1-9]\\d{0,3}$' },
    wastePercent: { type: 'string', pattern: '^(?:0|[1-9]\\d{0,2})(?:\\.\\d{1,3})?$' },
  },
  required: ['mode'],
  additionalProperties: false,
}

const estimateItemSchema = {
  type: 'object',
  properties: {
    description: { type: 'string', minLength: 1, maxLength: 240 },
    unit: { type: 'string', minLength: 1, maxLength: 24 },
    unitPrice: { type: 'string', pattern: pricePattern },
    calculation: calculationSchema,
  },
  required: ['description', 'unit', 'unitPrice', 'calculation'],
  additionalProperties: false,
}

const estimateBodySchema = {
  type: 'object',
  properties: {
    objectId: { type: 'string', format: 'uuid' },
    title: { type: 'string', minLength: 1, maxLength: 160 },
    note: { type: 'string', maxLength: 500 },
    items: { type: 'array', minItems: 1, maxItems: 500, items: estimateItemSchema },
  },
  required: ['objectId', 'title', 'items'],
  additionalProperties: false,
}

const estimatePreviewBodySchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 500,
      items: {
        type: 'object',
        properties: {
          unitPrice: { type: 'string', pattern: pricePattern },
          calculation: calculationSchema,
        },
        required: ['unitPrice', 'calculation'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
}

const versionBodySchema = {
  type: 'object',
  properties: {
    note: { type: 'string', maxLength: 500 },
    items: { type: 'array', minItems: 1, maxItems: 500, items: estimateItemSchema },
  },
  required: ['items'],
  additionalProperties: false,
}

const versionSummarySchema = {
  type: 'object',
  properties: {
    versionNumber: { type: 'integer' },
    note: { type: 'string' },
    total: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    createdBy: { type: 'string' },
  },
  required: ['versionNumber', 'note', 'total', 'createdAt', 'createdBy'],
  additionalProperties: false,
}

const estimateDetailsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    objectId: { type: 'string', format: 'uuid' },
    objectName: { type: 'string' },
    title: { type: 'string' },
    currentVersion: { type: 'integer' },
    total: { type: 'string' },
    updatedAt: { type: 'string', format: 'date-time' },
    updatedBy: { type: 'string' },
    versions: { type: 'array', items: versionSummarySchema },
  },
  required: [
    'id', 'objectId', 'objectName', 'title', 'currentVersion',
    'total', 'updatedAt', 'updatedBy', 'versions',
  ],
  additionalProperties: false,
}

const estimateSummarySchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    objectId: { type: 'string', format: 'uuid' },
    objectName: { type: 'string' },
    title: { type: 'string' },
    currentVersion: { type: 'integer' },
    total: { type: 'string' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'objectId', 'objectName', 'title', 'currentVersion', 'total', 'updatedAt'],
  additionalProperties: false,
}

const versionItemsSchema = {
  type: 'object',
  properties: {
    version: versionSummarySchema,
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          position: { type: 'integer' },
          description: { type: 'string' },
          quantity: { type: 'string' },
          unit: { type: 'string' },
          unitPrice: { type: 'string' },
          lineTotal: { type: 'string' },
          calculation: calculationSchema,
        },
        required: ['id', 'position', 'description', 'quantity', 'unit', 'unitPrice', 'lineTotal', 'calculation'],
        additionalProperties: false,
      },
    },
  },
  required: ['version', 'items'],
  additionalProperties: false,
}

function normalizeUnitPrice(value: string): string | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(normalized)) return null
  return Number(normalized).toFixed(2)
}

function normalizeItems(items: EstimateItemInput[]): NormalizedEstimateItem[] | null {
  const normalized: NormalizedEstimateItem[] = []
  for (const item of items) {
    const description = item.description.trim()
    const unit = item.unit.trim()
    const unitPrice = normalizeUnitPrice(item.unitPrice)
    const calculated = calculateEstimateQuantity(item.calculation)
    if (!description || !unit || !unitPrice || !calculated) return null
    normalized.push({ description, unit, unitPrice, calculation: calculated.calculation, quantity: calculated.quantity })
  }
  return normalized
}

function mapStoredCalculation(value: unknown, quantity: string): EstimateCalculationInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { mode: 'manual', quantity, repetitions: '1', wastePercent: '0' }
  }
  const stored = value as Record<string, unknown>
  if (stored.mode === 'manual') {
    return {
      mode: 'manual',
      quantity: typeof stored.quantity === 'string' ? stored.quantity : quantity,
      repetitions: typeof stored.repetitions === 'string' ? stored.repetitions : '1',
      wastePercent: typeof stored.wastePercent === 'string' ? stored.wastePercent : '0',
    }
  }
  return value as EstimateCalculationInput
}

function mapVersion(row: VersionRow) {
  return {
    versionNumber: row.version_number,
    note: row.note,
    total: row.total,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by_username,
  }
}

async function addItems(client: PoolClient, versionId: string, items: NormalizedEstimateItem[]): Promise<void> {
  const parameters: (string | number)[] = [versionId]
  const tuples = items.map((item, index) => {
    const firstParameter = parameters.length + 1
    parameters.push(index + 1, item.description, item.quantity, item.unit, item.unitPrice, JSON.stringify(item.calculation))
    return `($1, $${firstParameter}, $${firstParameter + 1}, $${firstParameter + 2}, $${firstParameter + 3}, $${firstParameter + 4}, $${firstParameter + 5})`
  })

  await client.query(
    `INSERT INTO estimate_items (version_id, position, description, quantity, unit, unit_price, calculation)
     VALUES ${tuples.join(', ')}`,
    parameters,
  )
}

async function setVersionTotal(client: PoolClient, versionId: string): Promise<void> {
  await client.query(
    `UPDATE estimate_versions
        SET total = (SELECT COALESCE(SUM(line_total), 0) FROM estimate_items WHERE version_id = $1)
      WHERE id = $1`,
    [versionId],
  )
}

async function getEstimateDetails(id: string) {
  const result = await pool.query<EstimateRow>(
    `SELECT e.id, e.object_id, o.name AS object_name, e.title,
            e.current_version, v.total::text AS total, e.updated_at,
            u.username AS updated_by_username
       FROM estimates AS e
       JOIN objects AS o ON o.id = e.object_id AND o.deleted_at IS NULL
       JOIN estimate_versions AS v
         ON v.estimate_id = e.id AND v.version_number = e.current_version
       JOIN app_users AS u ON u.id = e.updated_by
      WHERE e.id = $1`,
    [id],
  )
  const estimate = result.rows[0]
  if (!estimate) return null

  const versions = await pool.query<VersionRow>(
    `SELECT v.version_number, v.note, v.total::text AS total, v.created_at,
            u.username AS created_by_username
       FROM estimate_versions AS v
       JOIN app_users AS u ON u.id = v.created_by
      WHERE v.estimate_id = $1
      ORDER BY v.version_number DESC`,
    [id],
  )

  return {
    id: estimate.id,
    objectId: estimate.object_id,
    objectName: estimate.object_name,
    title: estimate.title,
    currentVersion: estimate.current_version,
    total: estimate.total,
    updatedAt: estimate.updated_at.toISOString(),
    updatedBy: estimate.updated_by_username,
    versions: versions.rows.map(mapVersion),
  }
}

async function sendInvalidEstimate(reply: FastifyReply) {
  return reply.code(400).send({ error: 'invalid_estimate_data' })
}

export const estimatesRoutes: FastifyPluginAsync = async (server) => {
  server.post<{ Body: EstimatePreviewInput }>('/calculate', {
    config: { requiredRoles: roles },
    schema: {
      body: estimatePreviewBodySchema,
      response: {
        200: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  quantity: { type: 'string' },
                  lineTotal: { type: 'string' },
                },
                required: ['quantity', 'lineTotal'],
                additionalProperties: false,
              },
            },
            total: { type: 'string' },
          },
          required: ['items', 'total'],
          additionalProperties: false,
        },
        400: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false },
      },
    },
  }, async (request, reply) => {
    const calculatedItems = request.body.items.map((item) => {
      const unitPrice = normalizeUnitPrice(item.unitPrice)
      const calculated = calculateEstimateQuantity(item.calculation)
      return unitPrice && calculated ? { quantity: calculated.quantity, unitPrice } : null
    })
    if (calculatedItems.some((item) => item === null)) return sendInvalidEstimate(reply)

    const safeItems = calculatedItems as { quantity: string; unitPrice: string }[]
    const parameters: (string | number)[] = []
    const tuples = safeItems.map((item, index) => {
      const firstParameter = parameters.length + 1
      parameters.push(index + 1, item.quantity, item.unitPrice)
      return `($${firstParameter}::integer, $${firstParameter + 1}::numeric, $${firstParameter + 2}::numeric)`
    })
    const result = await pool.query<{ quantity: string; line_total: string; total: string }>(
      `WITH estimate_input(position, quantity, unit_price) AS (VALUES ${tuples.join(', ')})
       SELECT quantity::text AS quantity,
              ROUND(quantity * unit_price, 2)::text AS line_total,
              SUM(ROUND(quantity * unit_price, 2)) OVER ()::text AS total
         FROM estimate_input
        ORDER BY position`,
      parameters,
    )

    return {
      items: result.rows.map((row) => ({ quantity: row.quantity, lineTotal: row.line_total })),
      total: result.rows[0]?.total ?? '0.00',
    }
  })

  server.get('/objects', {
    config: { requiredRoles: roles },
    schema: {
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } },
            required: ['id', 'name'],
            additionalProperties: false,
          },
        },
      },
    },
  }, async () => {
    const result = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM objects WHERE deleted_at IS NULL ORDER BY name, id LIMIT 500`,
    )
    return result.rows
  })

  server.get('/', {
    config: { requiredRoles: roles },
    schema: { response: { 200: { type: 'array', items: estimateSummarySchema } } },
  }, async () => {
    const result = await pool.query<EstimateListRow>(
      `SELECT e.id, e.object_id, o.name AS object_name, e.title,
              e.current_version, v.total::text AS total, e.updated_at
         FROM estimates AS e
         JOIN objects AS o ON o.id = e.object_id AND o.deleted_at IS NULL
         JOIN estimate_versions AS v
           ON v.estimate_id = e.id AND v.version_number = e.current_version
        ORDER BY e.updated_at DESC, e.id DESC
        LIMIT 500`,
    )
    return result.rows.map((row) => ({
      id: row.id,
      objectId: row.object_id,
      objectName: row.object_name,
      title: row.title,
      currentVersion: row.current_version,
      total: row.total,
      updatedAt: row.updated_at.toISOString(),
    }))
  })

  server.get('/:id/versions/:versionNumber', {
    config: { requiredRoles: roles },
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          versionNumber: { type: 'integer', minimum: 1 },
        },
        required: ['id', 'versionNumber'],
        additionalProperties: false,
      },
      response: {
        200: versionItemsSchema,
        404: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false },
      },
    },
  }, async (request, reply) => {
    const { id, versionNumber } = request.params as { id: string; versionNumber: number }
    if (!idPattern.test(id)) return reply.code(404).send({ error: 'estimate_not_found' })

    const versionResult = await pool.query<VersionRow>(
      `SELECT v.version_number, v.note, v.total::text AS total, v.created_at,
              u.username AS created_by_username
         FROM estimate_versions AS v
         JOIN estimates AS e ON e.id = v.estimate_id
         JOIN objects AS o ON o.id = e.object_id AND o.deleted_at IS NULL
         JOIN app_users AS u ON u.id = v.created_by
        WHERE v.estimate_id = $1 AND v.version_number = $2`,
      [id, versionNumber],
    )
    const version = versionResult.rows[0]
    if (!version) return reply.code(404).send({ error: 'estimate_version_not_found' })

    const itemsResult = await pool.query<ItemRow>(
      `SELECT id::text, position, description, quantity::text AS quantity, unit,
              unit_price::text AS unit_price, line_total::text AS line_total, calculation
         FROM estimate_items WHERE version_id = (
           SELECT id FROM estimate_versions WHERE estimate_id = $1 AND version_number = $2
         )
        ORDER BY position, id`,
      [id, versionNumber],
    )

    return {
      version: mapVersion(version),
      items: itemsResult.rows.map((item) => ({
        id: item.id,
        position: item.position,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unit_price,
        lineTotal: item.line_total,
        calculation: mapStoredCalculation(item.calculation, item.quantity),
      })),
    }
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
        200: estimateDetailsSchema,
        404: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!idPattern.test(id)) return reply.code(404).send({ error: 'estimate_not_found' })
    const estimate = await getEstimateDetails(id)
    if (!estimate) return reply.code(404).send({ error: 'estimate_not_found' })
    return estimate
  })

  server.post<{ Body: EstimateInput }>('/', {
    config: { requiredRoles: roles },
    schema: {
      body: estimateBodySchema,
      response: {
        201: { type: 'object', properties: { estimate: estimateDetailsSchema }, required: ['estimate'], additionalProperties: false },
        400: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false },
        404: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false },
      },
    },
  }, async (request, reply) => {
    const title = request.body.title.trim()
    const note = request.body.note?.trim() ?? ''
    const items = normalizeItems(request.body.items)
    if (!title || !items) return sendInvalidEstimate(reply)

    const id = randomUUID()
    const versionId = randomUUID()
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const objectResult = await client.query(
        `SELECT id FROM objects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [request.body.objectId],
      )
      if (!objectResult.rows[0]) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ error: 'object_not_found' })
      }

      await client.query(
        `INSERT INTO estimates (id, object_id, title, current_version, created_by, updated_by)
         VALUES ($1, $2, $3, 1, $4, $4)`,
        [id, request.body.objectId, title, request.currentUser!.id],
      )
      await client.query(
        `INSERT INTO estimate_versions (id, estimate_id, version_number, note, created_by)
         VALUES ($1, $2, 1, $3, $4)`,
        [versionId, id, note, request.currentUser!.id],
      )
      await addItems(client, versionId, items)
      await setVersionTotal(client, versionId)
      await client.query('COMMIT')

      const estimate = await getEstimateDetails(id)
      if (!estimate) throw new Error('Created estimate could not be loaded.')
      reply.code(201)
      return { estimate }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })

  server.post<{ Body: VersionInput }>('/:id/versions', {
    config: { requiredRoles: roles },
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
        additionalProperties: false,
      },
      body: versionBodySchema,
      response: {
        201: { type: 'object', properties: { estimate: estimateDetailsSchema }, required: ['estimate'], additionalProperties: false },
        400: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false },
        404: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!idPattern.test(id)) return reply.code(404).send({ error: 'estimate_not_found' })
    const note = request.body.note?.trim() ?? ''
    const items = normalizeItems(request.body.items)
    if (!items) return sendInvalidEstimate(reply)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const currentResult = await client.query<{ current_version: number }>(
        `SELECT e.current_version
           FROM estimates AS e
           JOIN objects AS o ON o.id = e.object_id AND o.deleted_at IS NULL
          WHERE e.id = $1
          FOR UPDATE OF e, o`,
        [id],
      )
      const current = currentResult.rows[0]
      if (!current) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ error: 'estimate_not_found' })
      }

      const nextVersion = current.current_version + 1
      const versionId = randomUUID()
      await client.query(
        `INSERT INTO estimate_versions (id, estimate_id, version_number, note, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [versionId, id, nextVersion, note, request.currentUser!.id],
      )
      await addItems(client, versionId, items)
      await setVersionTotal(client, versionId)
      await client.query(
        `UPDATE estimates
            SET current_version = $2, updated_at = now(), updated_by = $3
          WHERE id = $1`,
        [id, nextVersion, request.currentUser!.id],
      )
      await client.query('COMMIT')

      const estimate = await getEstimateDetails(id)
      if (!estimate) throw new Error('Updated estimate could not be loaded.')
      reply.code(201)
      return { estimate }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })
}
