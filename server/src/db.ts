import { Pool } from 'pg'

function requiredEnvironmentVariable(name: 'PGUSER' | 'PGPASSWORD' | 'PGDATABASE'): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

export const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: requiredEnvironmentVariable('PGUSER'),
  password: requiredEnvironmentVariable('PGPASSWORD'),
  database: requiredEnvironmentVariable('PGDATABASE'),
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
})

pool.on('error', () => {
  process.stderr.write('Unexpected error from an idle PostgreSQL connection.\n')
})
