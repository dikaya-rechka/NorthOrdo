import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { AppRole } from '../auth/types.ts'
import { pool } from '../db.ts'

const config = { requiredRoles: ['OWNER', 'ADMIN'] as AppRole[] }
const date = { type: 'string', format: 'date', pattern: '^[1-9][0-9]{3}-' }
const amount = { type: 'string', pattern: '^(?:0|[1-9]\\d{0,11})(?:\\.\\d{1,2})?$' }
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] })
const id = { type: 'string', format: 'uuid' }
const categories: Record<string, string[]> = { INCOME: ['ADVANCE', 'PAYMENT', 'REFUND', 'OTHER_INCOME'], EXPENSE: ['MATERIALS', 'LABOR', 'TOOLS', 'TRANSPORT', 'OTHER_EXPENSE'] }
type Settings = { budget: string | null; budgetFrom: string | null; budgetTo: string | null; openingBalance: string | null; openingDate: string | null; revision: number }
type Plan = { kind: 'INCOME' | 'EXPENSE'; amount: string; date: string; category: string; objectId: string | null; note: string; requestId: string }
const settingsFields = { budget: nullable(amount), budgetFrom: nullable(date), budgetTo: nullable(date), openingBalance: nullable(amount), openingDate: nullable(date), revision: { type: 'integer', minimum: 1 } }
const planFields = { kind: { type: 'string', enum: ['INCOME', 'EXPENSE'] }, amount, date, category: { type: 'string' }, objectId: nullable(id), note: { type: 'string', maxLength: 1000 }, requestId: id }

export const financePlanningRoutes: FastifyPluginAsync = async (server) => {
  server.get('/', { config }, async () => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const settings = (await client.query(`SELECT budget::text, budget_from::text AS "budgetFrom", budget_to::text AS "budgetTo",
        opening_balance::text AS "openingBalance", opening_date::text AS "openingDate", revision FROM finance_planning_settings WHERE id`)).rows[0]
      const plans = (await client.query(`SELECT p.id,p.kind,p.amount::text,p.plan_date::text AS date,p.category,p.object_id AS "objectId",
        o.name AS "objectName",p.note,p.status,p.revision FROM finance_plans p LEFT JOIN objects o ON o.id=p.object_id ORDER BY p.plan_date,p.id`)).rows
      const summary = (await client.query(`WITH s AS (SELECT *, (now() AT TIME ZONE 'Europe/Moscow')::date AS today FROM finance_planning_settings WHERE id),
        actual AS (SELECT s.*, COALESCE((SELECT sum(amount) FROM finance_entries WHERE NOT voided AND kind='EXPENSE' AND operation_date BETWEEN s.budget_from AND s.budget_to AND operation_date <= s.today),0) AS spent,
          COALESCE(s.opening_balance,0) + COALESCE((SELECT sum(CASE WHEN kind='INCOME' THEN amount ELSE -amount END) FROM finance_entries
            WHERE NOT voided AND (s.opening_date IS NULL OR operation_date >= s.opening_date) AND operation_date <= s.today),0) AS cash FROM s),
        days AS (SELECT greatest(p.plan_date,a.today) AS day, sum(CASE WHEN p.kind='INCOME' THEN p.amount ELSE -p.amount END) AS change
          FROM finance_plans p CROSS JOIN actual a WHERE p.status='PLANNED' GROUP BY 1),
        projection AS (SELECT day, (SELECT cash FROM actual) + sum(change) OVER (ORDER BY day) AS balance FROM days)
        SELECT a.spent::text, (a.budget-a.spent)::text AS "budgetRemaining", a.cash::text,
          CASE WHEN a.cash < 0 THEN a.today::text ELSE (SELECT day::text FROM projection WHERE balance < 0 ORDER BY day LIMIT 1) END AS "gapDate",
          least(a.cash,(SELECT min(balance) FROM projection))::text AS "lowestBalance",
          (SELECT count(*)::int FROM finance_plans WHERE status='PLANNED' AND plan_date<a.today) AS overdue,
          (SELECT count(*)::int FROM finance_plans WHERE status='PLANNED') AS planned,
          a.today::text AS today FROM actual a`)).rows[0]
      const objects = (await client.query('SELECT id,name,(deleted_at IS NOT NULL) AS archived FROM objects ORDER BY name,id')).rows
      const objectSummaries = (await client.query(`WITH active_objects AS (
          SELECT id,name FROM objects WHERE deleted_at IS NULL
        ), actual AS (
          SELECT o.id,o.name, (now() AT TIME ZONE 'Europe/Moscow')::date AS today,
            COALESCE(sum(f.amount) FILTER (WHERE f.kind='INCOME'),0) AS income,
            COALESCE(sum(f.amount) FILTER (WHERE f.kind='EXPENSE'),0) AS expense
          FROM active_objects o LEFT JOIN finance_entries f ON f.object_id=o.id
            AND NOT f.voided AND f.operation_date <= (now() AT TIME ZONE 'Europe/Moscow')::date
          GROUP BY o.id,o.name
        ), days AS (
          SELECT a.id, greatest(p.plan_date,a.today) AS day,
            sum(CASE WHEN p.kind='INCOME' THEN p.amount ELSE -p.amount END) AS change
          FROM actual a JOIN finance_plans p ON p.object_id=a.id AND p.status='PLANNED'
          GROUP BY a.id, greatest(p.plan_date,a.today)
        ), projection AS (
          SELECT d.id,d.day,a.income-a.expense + sum(d.change) OVER (PARTITION BY d.id ORDER BY d.day) AS balance
          FROM days d JOIN actual a ON a.id=d.id
        )
        SELECT a.id,a.name,a.income::text,a.expense::text,(a.income-a.expense)::text AS net,
          CASE WHEN a.income-a.expense < 0 THEN a.today::text
            ELSE (SELECT day::text FROM projection p WHERE p.id=a.id AND p.balance<0 ORDER BY day LIMIT 1) END AS "gapDate",
          least(a.income-a.expense,(SELECT min(balance) FROM projection p WHERE p.id=a.id))::text AS "lowestBalance",
          (SELECT count(*)::int FROM finance_plans p WHERE p.object_id=a.id AND p.status='PLANNED' AND p.plan_date<a.today) AS overdue,
          (SELECT count(*)::int FROM finance_plans p WHERE p.object_id=a.id AND p.status='PLANNED') AS planned
        FROM actual a ORDER BY a.name,a.id`)).rows
      await client.query('COMMIT')
      return { settings, plans, summary, objects, objectSummaries }
    } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
  })
  server.put<{ Body: Settings }>('/settings', { config, schema: { body: { type: 'object', properties: settingsFields, required: Object.keys(settingsFields), additionalProperties: false } } }, async (request, reply) => {
    const b = request.body
    if ((b.budget === null) !== (b.budgetFrom === null) || (b.budget === null) !== (b.budgetTo === null) || (b.budgetFrom && b.budgetTo && b.budgetFrom > b.budgetTo) ||
        (b.openingBalance === null) !== (b.openingDate === null)) return reply.code(400).send({ error: 'invalid_settings' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query(`UPDATE finance_planning_settings SET budget=$1,budget_from=$2,budget_to=$3,opening_balance=$4,opening_date=$5,revision=revision+1
        WHERE id AND revision=$6 AND ($5::date IS NULL OR $5::date <= (now() AT TIME ZONE 'Europe/Moscow')::date) RETURNING revision`,
      [b.budget,b.budgetFrom,b.budgetTo,b.openingBalance,b.openingDate,b.revision])
      if (!result.rowCount) { await client.query('ROLLBACK'); return reply.code(409).send({ error: 'settings_changed_or_date_invalid' }) }
      await client.query("INSERT INTO finance_planning_events(actor_id,entity_id,action) VALUES($1,'settings','EDIT')", [request.currentUser!.id])
      await client.query('COMMIT'); return { ok: true }
    } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
  })
  server.post<{ Body: Plan }>('/plans', { config, schema: { body: { type: 'object', properties: planFields, required: Object.keys(planFields), additionalProperties: false } } }, async (request, reply) => {
    const b = request.body
    if (!categories[b.kind].includes(b.category) || !/[1-9]/.test(b.amount)) return reply.code(400).send({ error: 'invalid_plan' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [b.requestId])
      const existing = (await client.query('SELECT id FROM finance_plans WHERE id=$1', [b.requestId])).rowCount
      if (existing) { await client.query('COMMIT'); return { ok: true } }
      if (b.objectId && !(await client.query('SELECT 1 FROM objects WHERE id=$1 AND deleted_at IS NULL FOR SHARE', [b.objectId])).rowCount) {
        await client.query('ROLLBACK'); return reply.code(409).send({ error: 'object_unavailable' })
      }
      await client.query('INSERT INTO finance_plans(id,kind,amount,plan_date,category,object_id,note) VALUES($1,$2,$3,$4,$5,$6,$7)', [b.requestId,b.kind,b.amount,b.date,b.category,b.objectId,b.note.trim()])
      await client.query("INSERT INTO finance_planning_events(actor_id,entity_id,action) VALUES($1,$2,'CREATE')", [request.currentUser!.id,b.requestId])
      await client.query('COMMIT'); return reply.code(201).send({ ok: true })
    } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
  })
  server.post<{ Params: { id: string }; Body: { revision: number; action: 'SETTLE' | 'CANCEL' | 'REOPEN'; date: string; amount: string } }>('/plans/:id/action', {
    config, schema: { params: { type: 'object', properties: { id }, required: ['id'] }, body: { type: 'object', properties: {
      revision: { type: 'integer', minimum: 1 }, action: { type: 'string', enum: ['SETTLE','CANCEL','REOPEN'] }, date, amount
    }, required: ['revision','action','date','amount'], additionalProperties: false } },
  }, async (request, reply) => {
    const { action, revision, date: actualDate, amount: actualAmount } = request.body
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const plan = (await client.query('SELECT * FROM finance_plans WHERE id=$1 FOR UPDATE', [request.params.id])).rows[0]
      if (!plan || plan.revision !== revision || (action !== 'REOPEN' && plan.status !== 'PLANNED') || (action === 'REOPEN' && plan.status !== 'SETTLED')) {
        await client.query('ROLLBACK'); return reply.code(409).send({ error: 'plan_changed' })
      }
      if (action === 'SETTLE') {
        const valid = await client.query("SELECT $1::date <= (now() AT TIME ZONE 'Europe/Moscow')::date AS valid", [actualDate])
        if (!valid.rows[0].valid || !/[1-9]/.test(actualAmount)) { await client.query('ROLLBACK'); return reply.code(400).send({ error: 'invalid_actual' }) }
        const entryId = randomUUID()
        await client.query(`INSERT INTO finance_entries(id,kind,amount,operation_date,category,object_id,note) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [entryId,plan.kind,actualAmount,actualDate,plan.category,plan.object_id,plan.note])
        await client.query("INSERT INTO finance_events(entry_id,revision,actor_id,action,changed_fields) VALUES($1,1,$2,'CREATE',ARRAY['kind','amount','date','category','objectId','note'])", [entryId,request.currentUser!.id])
        await client.query('INSERT INTO finance_plan_entries(plan_id,entry_id) VALUES($1,$2)', [plan.id,entryId])
        await client.query("UPDATE finance_plans SET status='SETTLED',settled_entry_id=$2,revision=revision+1 WHERE id=$1", [plan.id,entryId])
      } else if (action === 'REOPEN') {
        await client.query('UPDATE finance_entries SET voided=true,revision=revision+1 WHERE id=$1', [plan.settled_entry_id])
        await client.query("INSERT INTO finance_events(entry_id,revision,actor_id,action,changed_fields) SELECT id,revision,$2,'VOID',ARRAY['voided'] FROM finance_entries WHERE id=$1", [plan.settled_entry_id,request.currentUser!.id])
        await client.query("UPDATE finance_plans SET status='PLANNED',settled_entry_id=NULL,revision=revision+1 WHERE id=$1", [plan.id])
      } else await client.query("UPDATE finance_plans SET status='CANCELLED',revision=revision+1 WHERE id=$1", [plan.id])
      await client.query('INSERT INTO finance_planning_events(actor_id,entity_id,action) VALUES($1,$2,$3)', [request.currentUser!.id,plan.id,action])
      await client.query('COMMIT'); return { ok: true }
    } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
  })
}
