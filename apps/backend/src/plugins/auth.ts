import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { eq, and, gt } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { sessions, users, tenants, tenantMemberships } from '../drizzle/schema.js';
import { hashSessionToken } from '../utils/crypto.js';
import { AuthConstants, ErrorCodes, Role, TenantStatus } from '@review-system/shared';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      fullName: string;
      isPlatformAdmin: boolean;
      createdAt: Date;
    };
    session?: {
      tokenHash: string;
      activeTenantId: string;
      expiresAt: Date;
    };
    activeTenant?: {
      id: string;
      slug: string;
      displayName: string;
      status: TenantStatus;
      brandColor: string | null;
      logoUrl: string | null;
    };
    membership?: {
      role: Role;
    };
  }
}

const authPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Hook to parse and validate session on every request
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const rawToken = request.cookies[AuthConstants.COOKIE_NAME];

    if (!rawToken) {
      return;
    }

    const tokenHash = hashSessionToken(rawToken);
    const db = getDb();
    const now = new Date();

    // Query session with user, tenant, and membership in one join query
    const rows = await db
      .select({
        session: sessions,
        user: users,
        tenant: tenants,
        membership: tenantMemberships,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .innerJoin(tenants, eq(sessions.activeTenantId, tenants.id))
      .innerJoin(
        tenantMemberships,
        and(
          eq(tenantMemberships.userId, sessions.userId),
          eq(tenantMemberships.tenantId, sessions.activeTenantId)
        )
      )
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);

    const found = rows[0];

    if (!found) {
      return;
    }

    // Check expiration
    if (found.session.expiresAt <= now) {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
      reply.clearCookie(AuthConstants.COOKIE_NAME, { path: '/' });
      return;
    }

    // CSRF Protection on state-changing requests using cookie
    if (
      request.cookies[AuthConstants.COOKIE_NAME] &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
    ) {
      const originHeader = request.headers.origin || request.headers.referer;
      if (!originHeader) {
        reply.status(403).send({
          error: {
            code: ErrorCodes.FORBIDDEN,
            message: 'Origin or Referer header required for state-changing requests',
          },
        });
        return;
      }

      const host = request.headers.host;
      if (!host) {
        reply.status(403).send({
          error: {
            code: ErrorCodes.FORBIDDEN,
            message: 'Host header missing',
          },
        });
        return;
      }

      try {
        const originUrl = new URL(originHeader);
        const normalizedOriginHost = originUrl.host.replace(/:(80|443)$/, '');
        const normalizedTargetHost = host.replace(/:(80|443)$/, '');

        // Host mismatch (including port mismatch)
        if (normalizedOriginHost !== normalizedTargetHost) {
          reply.status(403).send({
            error: {
              code: ErrorCodes.FORBIDDEN,
              message: 'Cross-Site Request Forgery blocked: host mismatch',
            },
          });
          return;
        }

        // Scheme mismatch check (e.g. http origin vs https request or vice versa)
        if (request.protocol && originUrl.protocol !== `${request.protocol}:`) {
          reply.status(403).send({
            error: {
              code: ErrorCodes.FORBIDDEN,
              message: 'Cross-Site Request Forgery blocked: scheme mismatch',
            },
          });
          return;
        }
      } catch {
        // Malformed origin/referer URL
        reply.status(403).send({
          error: {
            code: ErrorCodes.FORBIDDEN,
            message: 'Invalid origin or referer header',
          },
        });
        return;
      }
    }

    request.user = {
      id: found.user.id,
      email: found.user.email,
      fullName: found.user.fullName,
      isPlatformAdmin: found.user.isPlatformAdmin,
      createdAt: found.user.createdAt,
    };

    request.session = {
      tokenHash: found.session.tokenHash,
      activeTenantId: found.session.activeTenantId,
      expiresAt: found.session.expiresAt,
    };

    request.activeTenant = {
      id: found.tenant.id,
      slug: found.tenant.slug,
      displayName: found.tenant.displayName,
      status: found.tenant.status as TenantStatus,
      brandColor: found.tenant.brandColor,
      logoUrl: found.tenant.logoUrl,
    };

    request.membership = {
      role: found.membership.role as Role,
    };
  });
};

export const requireAuth = async (request: FastifyRequest, reply: FastifyReply) => {
  if (!request.user || !request.session) {
    reply.status(401).send({
      error: {
        code: ErrorCodes.UNAUTHORIZED,
        message: 'Authentication required',
      },
    });
  }
};

export const requireActiveTenant = async (request: FastifyRequest, reply: FastifyReply) => {
  await requireAuth(request, reply);
  if (reply.sent) return;

  if (!request.activeTenant) {
    reply.status(403).send({
      error: {
        code: ErrorCodes.FORBIDDEN,
        message: 'No active tenant selected',
      },
    });
    return;
  }

  // Tenant suspension rule: Blocks access to this tenant without invalidating the user session
  if (request.activeTenant.status === 'suspended') {
    reply.status(403).send({
      error: {
        code: ErrorCodes.TENANT_SUSPENDED,
        message: 'This business account is currently suspended. Please contact support.',
      },
    });
  }
};

export const requireRole = (allowedRoles: Role[]) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireActiveTenant(request, reply);
    if (reply.sent) return;

    if (!request.membership || !allowedRoles.includes(request.membership.role)) {
      reply.status(403).send({
        error: {
          code: ErrorCodes.FORBIDDEN,
          message: 'Insufficient permissions for this action',
        },
      });
    }
  };
};

export default fp(authPlugin);
