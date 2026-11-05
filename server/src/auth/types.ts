export type AppRole = 'OWNER' | 'ADMIN'

export type SessionUser = {
  id: string
  username: string
  role: AppRole
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: SessionUser | null
  }

  interface FastifyContextConfig {
    public?: boolean
    requiredRoles?: AppRole[]
  }
}
