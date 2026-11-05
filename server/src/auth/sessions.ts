import { createHash, randomBytes } from 'node:crypto'
import { pool } from '../db.ts'

export const sessionCookieName = 'northordo_session'
export const sessionLifetimeSeconds = 8 * 60 * 60

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await pool.query(
    `INSERT INTO app_sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 * interval '1 second'))`,
    [hashSessionToken(token), userId, sessionLifetimeSeconds],
  )
  return token
}
