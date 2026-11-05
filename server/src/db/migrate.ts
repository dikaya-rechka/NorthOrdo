import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pool } from '../db.ts'

const migrationDirectory = resolve(process.cwd(), 'database', 'migrations')

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const migrationFiles = (await readdir(migrationDirectory))
    .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
    .sort()

  for (const migrationFile of migrationFiles) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('LOCK TABLE schema_migrations IN EXCLUSIVE MODE')

      const migrationId = migrationFile.replace(/\.sql$/i, '')
      const applied = await client.query(
        'SELECT 1 FROM schema_migrations WHERE migration_id = $1',
        [migrationId],
      )

      if (applied.rowCount === 0) {
        const migrationSql = await readFile(resolve(migrationDirectory, migrationFile), 'utf8')
        await client.query(migrationSql)
        await client.query('INSERT INTO schema_migrations (migration_id) VALUES ($1)', [migrationId])
      }

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  process.stdout.write('Database migrations are up to date.\n')
} catch (error) {
  const errorCode =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'unknown'
  process.stderr.write(`Database migration failed (code: ${errorCode}).\n`)
  process.exitCode = 1
} finally {
  await pool.end()
}
