import { randomUUID } from 'node:crypto'
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import type { PoolClient } from 'pg'
import type { AppRole } from '../auth/types.ts'
import { pool } from '../db.ts'

const config = { requiredRoles: ['OWNER', 'ADMIN'] as AppRole[] }
const uuid = { type: 'string', format: 'uuid' }
const date = { type: 'string', format: 'date', pattern: '^[1-9][0-9]{3}-' }
const quantity = { type: 'string', pattern: '^(?:0|[1-9]\\d{0,10})(?:\\.\\d{1,3})?$' }
const price = { anyOf: [{ type: 'string', pattern: '^(?:0|[1-9]\\d{0,11})(?:\\.\\d{1,2})?$' }, { type: 'null' }] }
const params = { type: 'object', properties: { id: uuid }, required: ['id'] }
class PurchaseError extends Error {
  status: number
  constructor(message: string, status = 409) { super(message); this.status = status }
}
async function tx(reply: FastifyReply, run: (client: PoolClient) => Promise<unknown>) {
  const client = await pool.connect()
  try { await client.query('BEGIN'); const result = await run(client); await client.query('COMMIT'); return result }
  catch (error) { await client.query('ROLLBACK'); if (error instanceof PurchaseError) return reply.code(error.status).send({ error: error.message }); throw error }
  finally { client.release() }
}
const columns = `p.id,p.material_id AS "materialId",m.name AS "materialName",m.unit,p.object_id AS "objectId",
  o.name AS "objectName",(o.deleted_at IS NOT NULL) AS "objectArchived",p.quantity::text,p.note,p.status,p.revision`

export const materialPurchasesRoutes: FastifyPluginAsync = async (server) => {
  server.get('/', { config }, async () => {
    const result = await pool.query(`SELECT ${columns} FROM material_purchases p
      JOIN materials m ON m.id=p.material_id LEFT JOIN objects o ON o.id=p.object_id
      ORDER BY CASE p.status WHEN 'NEEDED' THEN 0 WHEN 'BOUGHT' THEN 1 ELSE 2 END, m.name,p.id`)
    return result.rows
  })
  server.post<{ Body: { requestId: string; name: string; unit: string; objectId: string | null; quantity: string; note: string } }>('/quick', {
    config, schema: { body: { type: 'object', properties: { requestId: uuid, name: { type: 'string', minLength: 1, maxLength: 160 },
      unit: { type: 'string', minLength: 1, maxLength: 24 }, objectId: { anyOf: [uuid,{ type: 'null' }] },
      quantity, note: { type: 'string', maxLength: 1000 } },
      required: ['requestId','name','unit','objectId','quantity','note'], additionalProperties: false } },
  }, async (request, reply) => tx(reply, async (client) => {
    const b = request.body, name = b.name.trim(), unit = b.unit.trim(), note = b.note.trim()
    if (!name || !unit || !/[1-9]/.test(b.quantity)) throw new PurchaseError('invalid_quantity',400)
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [b.requestId])
    const existing = (await client.query(`SELECT m.name,m.unit,p.quantity::text,p.object_id,p.note
      FROM material_purchases p JOIN materials m ON m.id=p.material_id WHERE p.id=$1`,[b.requestId])).rows[0]
    if (existing) {
      const [whole, fraction = ''] = b.quantity.split('.')
      if (existing.name !== name || existing.unit !== unit || existing.object_id !== b.objectId ||
          existing.quantity !== whole + '.' + fraction.padEnd(3,'0') || existing.note !== note) throw new PurchaseError('record_changed')
      return { ok: true }
    }
    if (b.objectId && !(await client.query('SELECT 1 FROM objects WHERE id=$1 AND deleted_at IS NULL FOR SHARE',[b.objectId])).rowCount) throw new PurchaseError('object_unavailable')
    const materialId = randomUUID()
    await client.query("INSERT INTO materials(id,name,unit,note) VALUES($1,$2,$3,'')",[materialId,name,unit])
    await client.query("INSERT INTO material_events(material_id,actor_id,action,changed_fields) VALUES($1,$2,'CREATE',ARRAY['name','unit'])",[materialId,request.currentUser!.id])
    await client.query('INSERT INTO material_purchases(id,material_id,object_id,quantity,note) VALUES($1,$2,$3,$4,$5)',[b.requestId,materialId,b.objectId,b.quantity,note])
    await client.query("INSERT INTO material_purchase_events(purchase_id,actor_id,action) VALUES($1,$2,'CREATE')",[b.requestId,request.currentUser!.id])
    return { ok: true }
  }))
  server.post<{ Body: { requestId: string; materialId: string; objectId: string | null; quantity: string; note: string } }>('/', {
    config, schema: { body: { type: 'object', properties: { requestId: uuid, materialId: uuid,
      objectId: { anyOf: [uuid,{ type: 'null' }] }, quantity, note: { type: 'string', maxLength: 1000 } },
      required: ['requestId','materialId','objectId','quantity','note'], additionalProperties: false } },
  }, async (request, reply) => tx(reply, async (client) => {
    const b = request.body
    if (!/[1-9]/.test(b.quantity)) throw new PurchaseError('invalid_quantity',400)
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [b.requestId])
    const previous = (await client.query('SELECT material_id,object_id,quantity::text,note FROM material_purchases WHERE id=$1', [b.requestId])).rows[0]
    if (previous) {
      const [whole, fraction = ''] = b.quantity.split('.')
      if (previous.material_id !== b.materialId || previous.object_id !== b.objectId || previous.quantity !== whole + '.' + fraction.padEnd(3,'0') || previous.note !== b.note.trim()) throw new PurchaseError('record_changed')
      return { ok: true }
    }
    if (!(await client.query('SELECT 1 FROM materials WHERE id=$1 FOR UPDATE',[b.materialId])).rowCount) throw new PurchaseError('material_unavailable')
    if (b.objectId && !(await client.query('SELECT 1 FROM objects WHERE id=$1 AND deleted_at IS NULL FOR SHARE',[b.objectId])).rowCount) throw new PurchaseError('object_unavailable')
    await client.query('INSERT INTO material_purchases(id,material_id,object_id,quantity,note) VALUES($1,$2,$3,$4,$5)',[b.requestId,b.materialId,b.objectId,b.quantity,b.note.trim()])
    await client.query("INSERT INTO material_purchase_events(purchase_id,actor_id,action) VALUES($1,$2,'CREATE')",[b.requestId,request.currentUser!.id])
    return { ok: true }
  }))
  server.post<{ Params: { id: string }; Body: { revision: number; action: 'BUY' | 'REOPEN' | 'CANCEL'; date: string; unitPrice: string | null; supplier: string } }>('/:id/action', {
    config, schema: { params, body: { type: 'object', properties: { revision: { type: 'integer', minimum: 1 },
      action: { type: 'string', enum: ['BUY','REOPEN','CANCEL'] }, date, unitPrice: price, supplier: { type: 'string', maxLength: 160 } },
      required: ['revision','action','date','unitPrice','supplier'], additionalProperties: false } },
  }, async (request, reply) => tx(reply, async (client) => {
    const b = request.body
    const p = (await client.query('SELECT * FROM material_purchases WHERE id=$1 FOR UPDATE',[request.params.id])).rows[0]
    if (!p || p.revision !== b.revision || (b.action === 'REOPEN' ? p.status !== 'BOUGHT' : p.status !== 'NEEDED')) throw new PurchaseError('record_changed')
    await client.query('SELECT 1 FROM materials WHERE id=$1 FOR UPDATE',[p.material_id])
    if (b.action === 'BUY') {
      if (b.date > new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date())) throw new PurchaseError('future_date',400)
      if (p.object_id && !(await client.query('SELECT 1 FROM objects WHERE id=$1 AND deleted_at IS NULL FOR SHARE',[p.object_id])).rowCount) throw new PurchaseError('object_unavailable')
      const movement = randomUUID()
      await client.query(`INSERT INTO material_movements(id,material_id,kind,quantity,destination_id,movement_date,unit_price,supplier,note,created_by)
        VALUES($1,$2,'RECEIPT',$3,$4,$5,$6,$7,$8,$9)`,[movement,p.material_id,p.quantity,p.object_id,b.date,b.unitPrice,b.supplier.trim(),p.note,request.currentUser!.id])
      await client.query('INSERT INTO material_purchase_movements(purchase_id,movement_id) VALUES($1,$2)',[p.id,movement])
      await client.query("INSERT INTO material_events(material_id,movement_id,actor_id,action,changed_fields) VALUES($1,$2,$3,'MOVEMENT',ARRAY['movement'])",[p.material_id,movement,request.currentUser!.id])
      await client.query("UPDATE material_purchases SET status='BOUGHT',movement_id=$2,revision=revision+1 WHERE id=$1",[p.id,movement])
    } else if (b.action === 'REOPEN') {
      await client.query('UPDATE material_movements SET voided=true,revision=revision+1 WHERE id=$1',[p.movement_id])
      if ((await client.query('SELECT 1 FROM material_stock WHERE material_id=$1 AND balance<0 LIMIT 1',[p.material_id])).rowCount) throw new PurchaseError('insufficient_stock')
      await client.query("INSERT INTO material_events(material_id,movement_id,actor_id,action,changed_fields) VALUES($1,$2,$3,'VOID',ARRAY['voided'])",[p.material_id,p.movement_id,request.currentUser!.id])
      await client.query("UPDATE material_purchases SET status='NEEDED',movement_id=NULL,revision=revision+1 WHERE id=$1",[p.id])
    } else await client.query("UPDATE material_purchases SET status='CANCELLED',revision=revision+1 WHERE id=$1",[p.id])
    await client.query('INSERT INTO material_purchase_events(purchase_id,actor_id,action) VALUES($1,$2,$3)',[p.id,request.currentUser!.id,b.action])
    return { ok: true }
  }))
}
