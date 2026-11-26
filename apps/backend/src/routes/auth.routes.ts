import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { users, tenants, tenantMemberships, subscriptions, sessions } from '../drizzle/schema.js';
import { hashPassword, verifyPassword, generateSessionToken, hashSessionToken } from '../utils/crypto.js';
import {
  RegisterSchema,
  LoginSchema,
  ErrorCodes,
  AuthConstants,
  UserDTO,
  TenantDTO,
  Role,
  TenantStatus,
} from '@review-system/shared';
import { requireAuth } from '../plugins/auth.js';
import { getEnv } from '../config/env.js';

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  return `${base || 'business'}-${randomSuffix}`;
}

function setSessionCookie(reply: FastifyReply, token: string) {
  const env = getEnv();
  const maxAge = AuthConstants.SESSION_TTL_DAYS * 24 * 60 * 60; // seconds

  reply.setCookie(AuthConstants.COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    domain: env.COOKIE_DOMAIN,
    maxAge,
  });
}

interface AuthRateLimitBucket {
  count: number;
  resetAt: number;
}

/**
 * High-performance, bounded in-memory rate limiter for authentication routes (/login and /register).
 *
 * DESIGN INVARIANTS:
 * 1. Prehandler Independence: Executes its own check without depending on Fastify internal
 *    `kRateLimit` symbols, ensuring it cannot be skipped if other prehandlers or route hooks run.
 * 2. Bounded Storage: Strict 10,000 key ceiling with LRU / expired-bucket eviction, preventing memory exhaustion.
 * 3. Anti-Enumeration: Keys strictly by client IP (`auth:login:ip:${ip}`), never by email or username.
 * 4. Anti-DoS: Uses a 60-second sliding/rolling window; never locks out accounts permanently.
 * 5. Hash Resource Protection: Capped to 5 login attempts and 3 registration attempts per minute per IP
 *    to protect 0.1 vCPU / 512 MB instances from Argon2id CPU/RAM saturation.
 */
export class BoundedAuthRateLimiter {
  private readonly store = new Map<string, AuthRateLimitBucket>();
  private readonly maxKeys: number;
  private readonly windowMs: number;

  constructor(options?: { maxKeys?: number; windowMs?: number }) {
    this.maxKeys = options?.maxKeys ?? 10_000;
    this.windowMs = options?.windowMs ?? 60_000;
  }

  public checkAndIncrement(
    key: string,
    limit: number
  ): { allowed: boolean; retryAfterSeconds: number; remaining: number } {
    if (limit <= 0) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(this.windowMs / 1000),
        remaining: 0,
      };
    }

    const now = Date.now();
    const entry = this.store.get(key);

    if (entry && now < entry.resetAt) {
      if (entry.count >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
          remaining: 0,
        };
      }
      entry.count += 1;
      return {
        allowed: true,
        retryAfterSeconds: 0,
        remaining: limit - entry.count,
      };
    }

    if (this.store.size >= this.maxKeys && !this.store.has(key)) {
      this.evict();
    }

    this.store.set(key, {
      count: 1,
      resetAt: now + this.windowMs,
    });

    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: limit - 1,
    };
  }

  private evict(): void {
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (now >= v.resetAt) {
        this.store.delete(k);
      }
    }
    if (this.store.size >= this.maxKeys) {
      const toDelete = Math.max(1, Math.floor(this.maxKeys * 0.1));
      let count = 0;
      for (const k of this.store.keys()) {
        this.store.delete(k);
        count++;
        if (count >= toDelete) break;
      }
    }
  }

  public clear(): void {
    this.store.clear();
  }

  public get size(): number {
    return this.store.size;
  }
}

export interface AuthRoutesOptions {
  rateLimitOverrides?: {
    loginMax?: number;
    registerMax?: number;
  };
  rateLimiter?: BoundedAuthRateLimiter;
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  fastify: FastifyInstance,
  opts?: AuthRoutesOptions
) => {
  const env = getEnv();
  const isTest = env.NODE_ENV === 'test';

  const loginMax = opts?.rateLimitOverrides?.loginMax ?? (isTest ? 1000 : 5);
  const registerMax = opts?.rateLimitOverrides?.registerMax ?? (isTest ? 1000 : 3);
  const rateLimiter = opts?.rateLimiter ?? new BoundedAuthRateLimiter();

  // 1. Register
  fastify.post(
    '/register',
    {
      preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
        const key = `auth:register:ip:${request.clientIp}`;
        const res = rateLimiter.checkAndIncrement(key, registerMax);
        if (!res.allowed) {
          reply.header('Retry-After', String(res.retryAfterSeconds));
          return reply.status(429).send({
            error: {
              code: ErrorCodes.RATE_LIMITED,
              message: 'Too many registration attempts. Please try again in a few minutes.',
            },
          });
        }
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = RegisterSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'Invalid registration input',
            details: parseResult.error.issues.map((i) => ({
              field: i.path.join('.'),
              issue: i.message,
            })),
          },
        });
      }

      const { email, password, fullName, businessName } = parseResult.data;
      const db = getDb();

      // Check if email already exists
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);

      if (existing.length > 0) {
        return reply.status(409).send({
          error: {
            code: ErrorCodes.DUPLICATE_EMAIL,
            message: 'A user with this email address already exists',
          },
        });
      }

      const passwordHash = await hashPassword(password);
      const slug = generateSlug(businessName);
      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);
      const expiresAt = new Date(Date.now() + AuthConstants.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

      // Atomic transaction: user + tenant + membership + subscription + session
      const result = await db.transaction(async (tx) => {
        const [newUser] = await tx
          .insert(users)
          .values({
            email: email.toLowerCase(),
            passwordHash,
            fullName,
            isPlatformAdmin: false, // Strictly false for standard registration
          })
          .returning();

        const [newTenant] = await tx
          .insert(tenants)
          .values({
            displayName: businessName,
            slug,
            status: 'active',
          })
          .returning();

        const [newMembership] = await tx
          .insert(tenantMemberships)
          .values({
            userId: newUser.id,
            tenantId: newTenant.id,
            role: 'owner',
          })
          .returning();

        await tx.insert(subscriptions).values({
          tenantId: newTenant.id,
          plan: 'pilot_free',
          status: 'active',
        });

        await tx.insert(sessions).values({
          tokenHash,
          userId: newUser.id,
          activeTenantId: newTenant.id,
          expiresAt,
        });

        return { user: newUser, tenant: newTenant, membership: newMembership };
      });

      setSessionCookie(reply, rawToken);

      const userDTO: UserDTO = {
        id: result.user.id,
        email: result.user.email,
        fullName: result.user.fullName,
        isPlatformAdmin: result.user.isPlatformAdmin,
        createdAt: result.user.createdAt.toISOString(),
      };

      const tenantDTO: TenantDTO = {
        id: result.tenant.id,
        slug: result.tenant.slug,
        displayName: result.tenant.displayName,
        role: result.membership.role as Role,
        status: result.tenant.status as TenantStatus,
        brandColor: result.tenant.brandColor,
        logoUrl: result.tenant.logoUrl,
      };

      return reply.status(201).send({
        user: userDTO,
        activeTenant: tenantDTO,
        availableTenants: [tenantDTO],
      });
    }
  );

  // 2. Login
  fastify.post(
    '/login',
    {
      preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
        const key = `auth:login:ip:${request.clientIp}`;
        const res = rateLimiter.checkAndIncrement(key, loginMax);
        if (!res.allowed) {
          reply.header('Retry-After', String(res.retryAfterSeconds));
          return reply.status(429).send({
            error: {
              code: ErrorCodes.RATE_LIMITED,
              message: 'Too many login attempts. Please try again in a few minutes.',
            },
          });
        }
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = LoginSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Invalid login input',
          details: parseResult.error.issues.map((i) => ({
            field: i.path.join('.'),
            issue: i.message,
          })),
        },
      });
    }

    const { email, password } = parseResult.data;
    const db = getDb();

    const [foundUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    if (!foundUser) {
      return reply.status(401).send({
        error: {
          code: ErrorCodes.INVALID_CREDENTIALS,
          message: 'Invalid email or password',
        },
      });
    }

    const valid = await verifyPassword(password, foundUser.passwordHash);
    if (!valid) {
      return reply.status(401).send({
        error: {
          code: ErrorCodes.INVALID_CREDENTIALS,
          message: 'Invalid email or password',
        },
      });
    }

    // Get all tenant memberships for this user
    const membershipsWithTenants = await db
      .select({
        membership: tenantMemberships,
        tenant: tenants,
      })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenantMemberships.tenantId, tenants.id))
      .where(eq(tenantMemberships.userId, foundUser.id));

    if (membershipsWithTenants.length === 0) {
      return reply.status(403).send({
        error: {
          code: ErrorCodes.FORBIDDEN,
          message: 'User does not belong to any tenant organization',
        },
      });
    }

    const primaryTenant = membershipsWithTenants[0]!;
    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + AuthConstants.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    // Create session record
    await db.insert(sessions).values({
      tokenHash,
      userId: foundUser.id,
      activeTenantId: primaryTenant.tenant.id,
      expiresAt,
    });

    setSessionCookie(reply, rawToken);

    const userDTO: UserDTO = {
      id: foundUser.id,
      email: foundUser.email,
      fullName: foundUser.fullName,
      isPlatformAdmin: foundUser.isPlatformAdmin,
      createdAt: foundUser.createdAt.toISOString(),
    };

    const activeTenantDTO: TenantDTO = {
      id: primaryTenant.tenant.id,
      slug: primaryTenant.tenant.slug,
      displayName: primaryTenant.tenant.displayName,
      role: primaryTenant.membership.role as Role,
      status: primaryTenant.tenant.status as TenantStatus,
      brandColor: primaryTenant.tenant.brandColor,
      logoUrl: primaryTenant.tenant.logoUrl,
    };

    const availableTenants: TenantDTO[] = membershipsWithTenants.map((m) => ({
      id: m.tenant.id,
      slug: m.tenant.slug,
      displayName: m.tenant.displayName,
      role: m.membership.role as Role,
      status: m.tenant.status as TenantStatus,
      brandColor: m.tenant.brandColor,
      logoUrl: m.tenant.logoUrl,
    }));

    return reply.status(200).send({
      user: userDTO,
      activeTenant: activeTenantDTO,
      availableTenants,
    });
  });

  // 3. Logout
  fastify.post('/logout', { preHandler: [requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const db = getDb();
    const env = getEnv();
    if (request.session) {
      await db.delete(sessions).where(eq(sessions.tokenHash, request.session.tokenHash));
    }
    reply.clearCookie(AuthConstants.COOKIE_NAME, {
      path: '/',
      domain: env.COOKIE_DOMAIN,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
    });
    return reply.status(200).send({ status: 'logged_out' });
  });

  // 4. Me
  fastify.post('/me', { preHandler: [requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    return handleGetMe(request, reply);
  });
  fastify.get('/me', { preHandler: [requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    return handleGetMe(request, reply);
  });
};

async function handleGetMe(request: FastifyRequest, reply: FastifyReply) {
  const db = getDb();
  const userId = request.user!.id;

  const membershipsWithTenants = await db
    .select({
      membership: tenantMemberships,
      tenant: tenants,
    })
    .from(tenantMemberships)
    .innerJoin(tenants, eq(tenantMemberships.tenantId, tenants.id))
    .where(eq(tenantMemberships.userId, userId));

  const availableTenants: TenantDTO[] = membershipsWithTenants.map((m) => ({
    id: m.tenant.id,
    slug: m.tenant.slug,
    displayName: m.tenant.displayName,
    role: m.membership.role as Role,
    status: m.tenant.status as TenantStatus,
    brandColor: m.tenant.brandColor,
    logoUrl: m.tenant.logoUrl,
  }));

  const userDTO: UserDTO = {
    id: request.user!.id,
    email: request.user!.email,
    fullName: request.user!.fullName,
    isPlatformAdmin: request.user!.isPlatformAdmin,
    createdAt: request.user!.createdAt.toISOString(),
  };

  const activeTenantDTO: TenantDTO = {
    id: request.activeTenant!.id,
    slug: request.activeTenant!.slug,
    displayName: request.activeTenant!.displayName,
    role: request.membership!.role,
    status: request.activeTenant!.status,
    brandColor: request.activeTenant!.brandColor,
    logoUrl: request.activeTenant!.logoUrl,
  };

  return reply.status(200).send({
    user: userDTO,
    activeTenant: activeTenantDTO,
    availableTenants,
  });
}
