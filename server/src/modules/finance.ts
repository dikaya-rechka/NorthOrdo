import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import type { AppRole } from '../auth/types.ts'
import { pool } from '../db.ts'

type Input = {
  kind: 'INCOME' | 'EXPENSE'
  amount: string
  date: string
  category: string
  objectId: string | null
  note: string
  voided?: boolean
  revision?: number
  requestId?: string
}
type WriteRoute = { Body: Input; Params: { id?: string } }
type Stored = { kind: string; amount: string; date: string; category: string; objectId: string | null; note: string; voided: boolean; revision: number }
const categories = {
  INCOME: ['ADVANCE', 'PAYMENT', 'REFUND', 'OTHER_INCOME'],
  EXPENSE: ['MATERIALS', 'LABOR', 'TOOLS', 'TRANSPORT', 'OTHER_EXPENSE'],
}
const config = { requiredRoles: ['OWNER', 'ADMIN'] as AppRole[] }
const uuid = { type: 'string', format: 'uuid' }
const dateSchema = { type: 'string', format: 'date', pattern: '^[1-9][0-9]{3}-' }
const fields = {
  kind: { type: 'string', enum: ['INCOME', 'EXPENSE'] },
  amount: { type: 'string', pattern: '^(?:0|[1-9]\\d{0,11})(?:\\.\\d{1,2})?$' },
  date: dateSchema,
  category: { type: 'string', enum: [...categories.INCOME, ...categories.EXPENSE] },
  objectId: { anyOf: [uuid, { type: 'null' }] },
  note: { type: 'string', maxLength: 1000 },
}
const columns = `f.id, f.kind, f.amount::text AS amount, f.operation_date::text AS date,
                 f.category, f.object_id AS "objectId", o.name AS "objectName",
                 (o.deleted_at IS NOT NULL) AS "objectArchived", f.note, f.voided, f.revision,
                 EXISTS(SELECT 1 FROM finance_plan_entries pe WHERE pe.entry_id=f.id) AS "linkedPlan"`

async function save(request: FastifyRequest<WriteRoute>, reply: FastifyReply) {
  const input = request.body
  if (!categories[input.kind].includes(input.category) || !/[1-9]/.test(input.amount)) {
    return reply.code(400).send({ error: 'invalid_finance_data' })
  }
  const [whole, fraction = ''] = input.amount.split('.')
  const amount = whole + '.' + fraction.padEnd(2, '0')
  const id = request.params.id ?? input.requestId ?? randomUUID()
  const editing = request.params.id !== undefined
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (!editing && input.requestId) {
      // Serialize retries of one submitted form, including simultaneous requests.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [id])
      const existing = (await client.query(`SELECT ${columns} FROM finance_entries f LEFT JOIN objects o ON o.id=f.object_id WHERE f.id=$1`, [id])).rows[0]
      if (existing) {
        const same = existing.kind === input.kind && existing.amount === amount && existing.date === input.date &&
          existing.category === input.category && existing.objectId === input.objectId &&
          existing.note === input.note.trim() && !existing.voided
        await client.query('COMMIT')
        return reply.code(same ? 200 : 409).send(same ? existing : { error: 'entry_changed' })
      }
    }
    const current = editing ? (await client.query<Stored>(
      `SELECT kind, amount::text AS amount, operation_date::text AS date, category,
              object_id AS "objectId", note, voided, revision
         FROM finance_entries WHERE id=$1 FOR UPDATE`, [id],
    )).rows[0] : undefined
    if (editing && !current) {
      await client.query('ROLLBACK')
      return reply.code(404).send({ error: 'entry_not_found' })
    }
    if (editing && (await client.query('SELECT 1 FROM finance_plan_entries WHERE entry_id=$1', [id])).rowCount) {
      await client.query('ROLLBACK')
      return reply.code(409).send({ error: 'planned_entry_locked' })
    }
    if (current && current.revision !== input.revision) {
      await client.query('ROLLBACK')
      return reply.code(409).send({ error: 'entry_changed' })
    }
    if (input.objectId) {
      const parent = (await client.query<{ deleted_at: Date | null }>(
        'SELECT deleted_at FROM objects WHERE id=$1 FOR SHARE', [input.objectId],
      )).rows[0]
      if (!parent || (parent.deleted_at && current?.objectId !== input.objectId)) {
        await client.query('ROLLBACK')
        return reply.code(409).send({ error: 'object_unavailable' })
      }
    }
    const normalized = {
      kind: input.kind, amount, date: input.date, category: input.category,
      objectId: input.objectId, note: input.note.trim(), voided: input.voided ?? false,
    }
    const changed = current ? Object.keys(normalized).filter((key) =>
      normalized[key as keyof typeof normalized] !== current[key as keyof Stored]) : Object.keys(normalized)
    if (!changed.length) {
      const result = await client.query(`SELECT ${columns} FROM finance_entries f LEFT JOIN objects o ON o.id=f.object_id WHERE f.id=$1`, [id])
      await client.query('COMMIT')
      return result.rows[0]
    }
    const values = [id, normalized.kind, amount, normalized.date, normalized.category, normalized.objectId, normalized.note, normalized.voided]
    if (current) {
      await client.query(`UPDATE finance_entries SET kind=$2, amount=$3, operation_date=$4,
        category=$5, object_id=$6, note=$7, voided=$8, revision=revision+1 WHERE id=$1`, values)
    } else {
      await client.query(`INSERT INTO finance_entries(id,kind,amount,operation_date,category,object_id,note,voided)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, values)
    }
    const action = !current ? 'CREATE' : current.voided !== normalized.voided ? normalized.voided ? 'VOID' : 'RESTORE' : 'EDIT'
    await client.query(`INSERT INTO finance_events(entry_id,revision,actor_id,action,changed_fields)
      SELECT id,revision,$2,$3,$4 FROM finance_entries WHERE id=$1`, [id, request.currentUser!.id, action, changed])
    const result = await client.query(`SELECT ${columns} FROM finance_entries f LEFT JOIN objects o ON o.id=f.object_id WHERE f.id=$1`, [id])
    await client.query('COMMIT')
    return reply.code(editing ? 200 : 201).send(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export const financeRoutes: FastifyPluginAsync = async (server) => {
  server.get('/', {
    config,
    schema: { querystring: {
      type: 'object', properties: {
        from: dateSchema, to: dateSchema,
        kind: { type: 'string', enum: ['INCOME', 'EXPENSE'] },
        objectId: { anyOf: [uuid, { type: 'string', const: 'none' }] },
        includeVoided: { type: 'boolean' },
      }, additionalProperties: false,
    } },
  }, async (request, reply) => {
    const query = request.query as { from?: string; to?: string; kind?: string; objectId?: string; includeVoided?: boolean }
    if (query.from && query.to && query.from > query.to) return reply.code(400).send({ error: 'invalid_period' })
    const conditions: string[] = []
    const values: string[] = []
    const condition = (expression: string, value: string) => { values.push(value); conditions.push(expression + '$' + values.length) }
    if (query.from) condition('f.operation_date >= ', query.from)
    if (query.to) condition('f.operation_date <= ', query.to)
    if (query.kind) condition('f.kind = ', query.kind)
    if (query.objectId === 'none') conditions.push('f.object_id IS NULL')
    else if (query.objectId) condition('f.object_id = ', query.objectId)
    if (!query.includeVoided) conditions.push('f.voided = false')
    const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : ''
    const client = await pool.connect()
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const entries = await client.query(`SELECT ${columns} FROM finance_entries f LEFT JOIN objects o ON o.id=f.object_id
        ${where} ORDER BY f.operation_date DESC, f.id`, values)
      const totals = await client.query(`SELECT
        COALESCE(SUM(amount) FILTER (WHERE kind='INCOME' AND NOT voided),0)::text AS income,
        COALESCE(SUM(amount) FILTER (WHERE kind='EXPENSE' AND NOT voided),0)::text AS expense,
        COALESCE(SUM(CASE WHEN voided THEN 0 WHEN kind='INCOME' THEN amount ELSE -amount END),0)::text AS net
        FROM finance_entries f ${where}`, values)
      const objects = await client.query('SELECT id,name,(deleted_at IS NOT NULL) AS archived FROM objects ORDER BY name,id')
      await client.query('COMMIT')
      return { entries: entries.rows, totals: totals.rows[0], objects: objects.rows }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })
  server.get('/:id/history', {
    config, schema: { params: { type: 'object', properties: { id: uuid }, required: ['id'] } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const exists = await pool.query('SELECT 1 FROM finance_entries WHERE id=$1', [id])
    if (!exists.rowCount) return reply.code(404).send({ error: 'entry_not_found' })
    const result = await pool.query(`SELECT e.revision,e.action,e.changed_fields AS "changedFields",
      e.occurred_at AS "occurredAt",u.username AS actor
      FROM finance_events e JOIN app_users u ON u.id=e.actor_id WHERE entry_id=$1 ORDER BY e.revision DESC`, [id])
    return result.rows
  })
  server.post<WriteRoute>('/', {
    config, schema: { body: { type: 'object', properties: { ...fields, requestId: uuid }, required: Object.keys(fields), additionalProperties: false } },
  }, save)
  server.put<WriteRoute>('/:id', {
    config, schema: {
      params: { type: 'object', properties: { id: uuid }, required: ['id'] },
      body: { type: 'object', properties: { ...fields, revision: { type: 'integer', minimum: 1 }, voided: { type: 'boolean' } },
        required: [...Object.keys(fields), 'revision', 'voided'], additionalProperties: false },
    },
  }, save)
}
