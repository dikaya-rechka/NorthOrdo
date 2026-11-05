import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import type { AppRole } from '../auth/types.ts'
import { pool } from '../db.ts'

type Status = 'PLANNED' | 'DONE'

type Input = {
  title: string
  status: Status
  objectId?: string | null
  dueDate?: string | null
  note?: string
  revision?: number
}

type WriteRoute = { Body: Input; Params: { id?: string } }
const config = { requiredRoles: ['OWNER', 'ADMIN'] as AppRole[] }
const idSchema = { type: 'string', format: 'uuid' }
const fields = {
  title: { type: 'string', minLength: 1, maxLength: 160 },
  status: { type: 'string', enum: ['PLANNED', 'DONE'] },
  objectId: { anyOf: [idSchema, { type: 'null' }] },
  dueDate: { anyOf: [{ type: 'string', format: 'date', pattern: '^[1-9][0-9]{3}-' }, { type: 'null' }] },
  note: { type: 'string', maxLength: 1000 },
}

const selectWork = `SELECT w.id, w.title, w.status, w.object_id AS "objectId", o.name AS "objectName",
                           w.due_date::text AS "dueDate", w.note, w.completed_at AS "completedAt", w.revision
                      FROM work_items w LEFT JOIN objects o ON o.id = w.object_id
                     WHERE o.deleted_at IS NULL`

async function save(request: FastifyRequest<WriteRoute>, reply: FastifyReply) {
  const input = request.body
  const title = input.title.trim()
  if (!title) return reply.code(400).send({ error: 'title_required' })

  const editing = request.params.id !== undefined
  const id = request.params.id ?? randomUUID()
  const objectId = input.objectId ?? null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = editing
      ? (await client.query<{ status: Status; revision: number; object_id: string | null }>(
          'SELECT status, revision, object_id FROM work_items WHERE id = $1 FOR UPDATE', [id],
        )).rows[0]
      : undefined
    if (editing && !current) {
      await client.query('ROLLBACK')
      return reply.code(404).send({ error: 'work_not_found' })
    }

    // Hold both object rows through commit so an archived work cannot be moved or edited.
    const parents = [...new Set([current?.object_id, objectId].filter((value): value is string => Boolean(value)))]
    if (parents.length) {
      const active = await client.query(
        'SELECT id FROM objects WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY id FOR SHARE', [parents],
      )
      if (active.rowCount !== parents.length) {
        await client.query('ROLLBACK')
        return reply.code(409).send({ error: 'object_unavailable' })
      }
    }
    if (current && current.revision !== input.revision) {
      await client.query('ROLLBACK')
      return reply.code(409).send({ error: 'work_changed' })
    }

    const values = [id, title, input.status, objectId, input.dueDate ?? null, input.note?.trim() ?? '']
    let action = 'CREATE'
    if (current) {
      action = current.status === input.status ? 'EDIT' : input.status === 'DONE' ? 'COMPLETE' : 'REOPEN'
      await client.query(
        `UPDATE work_items SET title=$2, status=$3, object_id=$4, due_date=$5, note=$6,
                               completed_at=CASE WHEN $3 = 'DONE' THEN COALESCE(completed_at, now()) END,
                               revision=revision+1
          WHERE id=$1`, values,
      )
    } else {
      await client.query(
        `INSERT INTO work_items (id, title, status, object_id, due_date, note, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $3 = 'DONE' THEN now() END)`, values,
      )
    }
    await client.query(
      `INSERT INTO work_events (work_id, revision, actor_id, action, status)
       SELECT id, revision, $2, $3, status FROM work_items WHERE id=$1`, [id, request.currentUser!.id, action],
    )
    const result = await client.query(selectWork + ' AND w.id=$1', [id])
    await client.query('COMMIT')
    return reply.code(editing ? 200 : 201).send(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export const worksRoutes: FastifyPluginAsync = async (server) => {
  server.get('/', { config }, async () => {
    const [works, objects] = await Promise.all([
      pool.query(selectWork),
      pool.query('SELECT id, name FROM objects WHERE deleted_at IS NULL ORDER BY name, id'),
    ])
    return { works: works.rows, objects: objects.rows }
  })
  server.post<WriteRoute>('/', {
    config,
    schema: { body: { type: 'object', properties: fields, required: ['title', 'status'], additionalProperties: false } },
  }, save)
  server.put<WriteRoute>('/:id', {
    config,
    schema: {
      params: { type: 'object', properties: { id: idSchema }, required: ['id'] },
      body: {
        type: 'object', properties: { ...fields, revision: { type: 'integer', minimum: 1 } },
        required: ['title', 'status', 'objectId', 'dueDate', 'note', 'revision'], additionalProperties: false,
      },
    },
  }, save)
}
