import cookie from '@fastify/cookie'
import Fastify from 'fastify'
import { randomBytes } from 'node:crypto'
import { pool } from './db.ts'
import { hashPassword, verifyPassword } from './auth/passwords.ts'
import { createSession, hashSessionToken, sessionCookieName, sessionLifetimeSeconds } from './auth/sessions.ts'
import { normalizeUsername } from './auth/usernames.ts'
import { estimatesRoutes } from './modules/estimates.ts'
import { objectsRoutes } from './modules/objects.ts'
import { worksRoutes } from './modules/works.ts'
import { financeRoutes } from './modules/finance.ts'
import { financePlanningRoutes } from './modules/finance-planning.ts'
import { materialsRoutes } from './modules/materials.ts'
import { materialPurchasesRoutes } from './modules/material-purchases.ts'
import { toolsRoutes } from './modules/tools.ts'
import { documentsRoutes } from './modules/documents.ts'
import type { AppRole, SessionUser } from './auth/types.ts'

const apiPort = 3001
const webOrigin = process.env.NORTHORDO_WEB_ORIGIN || 'http://127.0.0.1:5173'
const secureCookies = process.env.NODE_ENV === 'production'
const loginWindowMs = 60_000
const loginLimitPerWindow = 10

type LoginBody = {
  username: string
  password: string
}

type LoginAttempt = {
  count: number
  resetsAt: number
}

type LoginUser = SessionUser & {
  password_hash: string
  is_active: boolean
}

const loginAttempts = new Map<string, LoginAttempt>()

const server = Fastify({
  bodyLimit: 16 * 1024,
  trustProxy: false,
  logger: {
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
  },
})

server.decorateRequest('currentUser', null)
await server.register(cookie)

function isRateLimited(clientAddress: string): boolean {
  const now = Date.now()
  const attempt = loginAttempts.get(clientAddress)

  if (!attempt || attempt.resetsAt <= now) {
    if (loginAttempts.size >= 10_000) {
      for (const [address, value] of loginAttempts) {
        if (value.resetsAt <= now) loginAttempts.delete(address)
      }
      if (loginAttempts.size >= 10_000) return true
    }
    loginAttempts.set(clientAddress, { count: 1, resetsAt: now + loginWindowMs })
    return false
  }

  attempt.count += 1
  return attempt.count > loginLimitPerWindow
}

async function clearSessionCookieToken(token: string | undefined): Promise<void> {
  if (token) {
    await pool.query('DELETE FROM app_sessions WHERE token_hash = $1', [hashSessionToken(token)])
  }
}

server.addHook('onRequest', async (request, reply) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== webOrigin) {
    return reply.code(403).send({ error: 'origin_not_allowed' })
  }
})

server.addHook('onRequest', async (request, reply) => {
  if (request.routeOptions.config.public) return

  const token = request.cookies[sessionCookieName]
  if (!token) {
    return reply.code(401).send({ error: 'authentication_required' })
  }

  const result = await pool.query<SessionUser>(
    `SELECT u.id, u.username, u.role
       FROM app_sessions AS s
       JOIN app_users AS u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()
        AND u.is_active = true`,
    [hashSessionToken(token)],
  )

  const user = result.rows[0]
  if (!user) {
    return reply.code(401).send({ error: 'authentication_required' })
  }

  request.currentUser = user
  const requiredRoles = request.routeOptions.config.requiredRoles
  if (requiredRoles && !requiredRoles.includes(user.role as AppRole)) {
    return reply.code(403).send({ error: 'forbidden' })
  }
})

server.get('/api/health', {
  config: { public: true },
  schema: {
    response: {
      200: {
        type: 'object',
        properties: { status: { type: 'string' } },
        required: ['status'],
        additionalProperties: false,
      },
      503: {
        type: 'object',
        properties: { status: { type: 'string' } },
        required: ['status'],
        additionalProperties: false,
      },
    },
  },
}, async (_request, reply) => {
  try {
    await pool.query('SELECT 1')
    return { status: 'ok' }
  } catch {
    server.log.error('Database health check failed')
    return reply.code(503).send({ status: 'unavailable' })
  }
})

const dummyPasswordHash = await hashPassword(randomBytes(32).toString('hex'))

server.post<{ Body: LoginBody }>('/api/auth/login', {
  config: { public: true },
  schema: {
    body: {
      type: 'object',
      properties: {
        username: { type: 'string', minLength: 1, maxLength: 128 },
        password: { type: 'string', minLength: 1, maxLength: 128 },
      },
      required: ['username', 'password'],
      additionalProperties: false,
    },
    response: {
      200: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              username: { type: 'string' },
              role: { type: 'string', enum: ['OWNER', 'ADMIN'] },
            },
            required: ['id', 'username', 'role'],
            additionalProperties: false,
          },
        },
        required: ['user'],
        additionalProperties: false,
      },
      401: {
        type: 'object',
        properties: { error: { type: 'string' } },
        required: ['error'],
        additionalProperties: false,
      },
      429: {
        type: 'object',
        properties: { error: { type: 'string' } },
        required: ['error'],
        additionalProperties: false,
      },
    },
  },
}, async (request, reply) => {
  if (isRateLimited(request.ip)) {
    return reply.code(429).send({ error: 'too_many_attempts' })
  }

  const username = normalizeUsername(request.body.username)
  let user: LoginUser | undefined
  if (username) {
    const result = await pool.query<LoginUser>(
      `SELECT id, username, role, password_hash, is_active
         FROM app_users
        WHERE username = $1`,
      [username],
    )
    user = result.rows[0]
  }

  const passwordValid = await verifyPassword(request.body.password, user?.password_hash ?? dummyPasswordHash)
  if (!user || !user.is_active || !passwordValid) {
    return reply.code(401).send({ error: 'invalid_credentials' })
  }

  await clearSessionCookieToken(request.cookies[sessionCookieName])
  const token = await createSession(user.id)
  reply.setCookie(sessionCookieName, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'strict',
    path: '/',
    maxAge: sessionLifetimeSeconds,
  })

  loginAttempts.delete(request.ip)
  return { user: { id: user.id, username: user.username, role: user.role } }
})

server.get('/api/auth/me', {
  schema: {
    response: {
      200: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              username: { type: 'string' },
              role: { type: 'string', enum: ['OWNER', 'ADMIN'] },
            },
            required: ['id', 'username', 'role'],
            additionalProperties: false,
          },
        },
        required: ['user'],
        additionalProperties: false,
      },
    },
  },
}, async (request) => ({ user: request.currentUser }))

server.post('/api/auth/logout', {
  config: { public: true },
  schema: {
    response: {
      200: {
        type: 'object',
        properties: { status: { type: 'string' } },
        required: ['status'],
        additionalProperties: false,
      },
    },
  },
}, async (request, reply) => {
  await clearSessionCookieToken(request.cookies[sessionCookieName])
  reply.clearCookie(sessionCookieName, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: 'strict',
    path: '/',
  })
  return { status: 'ok' }
})

await server.register(objectsRoutes, { prefix: '/api/objects' })
await server.register(estimatesRoutes, { prefix: '/api/estimates' })
await server.register(worksRoutes, { prefix: '/api/works' })
await server.register(financeRoutes, { prefix: '/api/finance' })
await server.register(financePlanningRoutes, { prefix: '/api/finance-planning' })
await server.register(materialsRoutes, { prefix: '/api/materials' })
await server.register(materialPurchasesRoutes, { prefix: '/api/material-purchases' })
await server.register(toolsRoutes, { prefix: '/api/tools' })
await server.register(documentsRoutes, { prefix: '/api/documents' })

server.addHook('onClose', async () => {
  await pool.end()
})

async function stopServer(): Promise<void> {
  await server.close()
}

process.once('SIGINT', () => {
  void stopServer()
})
process.once('SIGTERM', () => {
  void stopServer()
})

try {
  await pool.query('SELECT 1')
  const schemaStatus = await pool.query("SELECT to_regclass('public.app_users') IS NOT NULL AS ready")
  if (!schemaStatus.rows[0]?.ready) {
    throw new Error('Database schema is not ready.')
  }
  await server.listen({ host: '127.0.0.1', port: apiPort })
} catch (error) {
  const errorCode =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'unknown'
  server.log.error({ errorCode }, 'API startup failed; check local PostgreSQL, migrations and server/.env values')
  await server.close()
  process.exitCode = 1
}
