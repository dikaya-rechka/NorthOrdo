import { randomUUID } from 'node:crypto'
import { hashPassword, isAcceptablePassword } from './passwords.ts'
import { pool } from '../db.ts'

const username = process.env.NORTHORDO_INITIAL_OWNER_USERNAME?.normalize('NFKC').trim().toLowerCase()
const password = process.env.NORTHORDO_INITIAL_OWNER_PASSWORD

if (!username || !password) {
  throw new Error('Owner setup requires a username and password from the local setup script.')
}

if ([...username].length < 3 || [...username].length > 64 || /[\s\p{Cc}]/u.test(username)) {
  throw new Error('Owner username must be 3–64 characters and contain no spaces or control characters.')
}

if (!isAcceptablePassword(password)) {
  throw new Error('Owner password must be 12–128 characters.')
}

try {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('LOCK TABLE app_users IN EXCLUSIVE MODE')

    const existingUsers = await client.query('SELECT 1 FROM app_users LIMIT 1')
    if (existingUsers.rowCount !== 0) {
      throw new Error('An application account already exists. Initial OWNER setup is one-time only.')
    }

    const passwordHash = await hashPassword(password)
    await client.query(
      `INSERT INTO app_users (id, username, password_hash, role)
       VALUES ($1, $2, $3, 'OWNER')`,
      [randomUUID(), username, passwordHash],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  process.stdout.write('Initial OWNER account created.\n')
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown setup error.'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
} finally {
  await pool.end()
}
