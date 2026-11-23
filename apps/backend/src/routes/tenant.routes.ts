import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { tenants, tenantMemberships, subscriptions, sessions } from '../drizzle/schema.js';
import {
  CreateTenantSchema,
  ErrorCodes,
  TenantDTO,
  Role,
  TenantStatus,
} from '@review-system/shared';
import { requireAuth } from '../plugins/auth.js';

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  return `${base || 'business'}-${randomSuffix}`;
}

export const tenantRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // All tenant routes require authenticated user
  fastify.addHook('preHandler', requireAuth);

  // 1. List user's tenants
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const db = getDb();
    const userId = request.user!.id;

    const rows = await db
      .select({
        membership: tenantMemberships,
        tenant: tenants,
      })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenantMemberships.tenantId, tenants.id))
      .where(eq(tenantMemberships.userId, userId));

    const list: TenantDTO[] = rows.map((r) => ({
      id: r.tenant.id,
      slug: r.tenant.slug,
      displayName: r.tenant.displayName,
      role: r.membership.role as Role,
      status: r.tenant.status as TenantStatus,
      brandColor: r.tenant.brandColor,
      logoUrl: r.tenant.logoUrl,
    }));

    return reply.status(200).send({ tenants: list });
  });

  // 2. Create a new tenant (assigns creator as owner)
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = CreateTenantSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'Invalid tenant data',
          details: parseResult.error.issues.map((i) => ({
            field: i.path.join('.'),
            issue: i.message,
          })),
        },
      });
    }

    const { displayName, slug: customSlug, brandColor, logoUrl } = parseResult.data;
    const db = getDb();
    const userId = request.user!.id;
    const slug = customSlug || generateSlug(displayName);

    const result = await db.transaction(async (tx) => {
      const [newTenant] = await tx
        .insert(tenants)
        .values({
          displayName,
          slug,
          brandColor: brandColor || '#2563EB',
          logoUrl,
          status: 'active',
        })
        .returning();

      const [newMembership] = await tx
        .insert(tenantMemberships)
        .values({
          userId,
          tenantId: newTenant.id,
          role: 'owner',
        })
        .returning();

      await tx.insert(subscriptions).values({
        tenantId: newTenant.id,
        plan: 'pilot_free',
        status: 'active',
      });

      return { tenant: newTenant, membership: newMembership };
    });

    const tenantDTO: TenantDTO = {
      id: result.tenant.id,
      slug: result.tenant.slug,
      displayName: result.tenant.displayName,
      role: result.membership.role as Role,
      status: result.tenant.status as TenantStatus,
      brandColor: result.tenant.brandColor,
      logoUrl: result.tenant.logoUrl,
    };

    return reply.status(201).send(tenantDTO);
  });

  // 3. Switch active tenant context
  fastify.post('/:tenantId/switch', async (request: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) => {
    const { tenantId } = request.params;
    const db = getDb();
    const userId = request.user!.id;

    // Validate membership in the target tenant
    const [membershipRecord] = await db
      .select({
        membership: tenantMemberships,
        tenant: tenants,
      })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenantMemberships.tenantId, tenants.id))
      .where(
        and(
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.tenantId, tenantId)
        )
      )
      .limit(1);

    if (!membershipRecord) {
      return reply.status(403).send({
        error: {
          code: ErrorCodes.FORBIDDEN,
          message: 'You are not a member of this tenant business',
        },
      });
    }

    // Update active_tenant_id on current session
    // Note: Composite foreign key constraint ensures this update cannot violate user-tenant integrity
    await db
      .update(sessions)
      .set({ activeTenantId: tenantId })
      .where(eq(sessions.tokenHash, request.session!.tokenHash));

    const activeTenantDTO: TenantDTO = {
      id: membershipRecord.tenant.id,
      slug: membershipRecord.tenant.slug,
      displayName: membershipRecord.tenant.displayName,
      role: membershipRecord.membership.role as Role,
      status: membershipRecord.tenant.status as TenantStatus,
      brandColor: membershipRecord.tenant.brandColor,
      logoUrl: membershipRecord.tenant.logoUrl,
    };

    return reply.status(200).send({
      message: 'Active tenant switched successfully',
      activeTenant: activeTenantDTO,
    });
  });

  // 4. Get specific tenant details
  fastify.get('/:tenantId', async (request: FastifyRequest<{ Params: { tenantId: string } }>, reply: FastifyReply) => {
    const { tenantId } = request.params;
    const db = getDb();
    const userId = request.user!.id;

    const [record] = await db
      .select({
        membership: tenantMemberships,
        tenant: tenants,
      })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenantMemberships.tenantId, tenants.id))
      .where(
        and(
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.tenantId, tenantId)
        )
      )
      .limit(1);

    if (!record) {
      return reply.status(404).send({
        error: {
          code: ErrorCodes.TENANT_NOT_FOUND,
          message: 'Tenant not found or access denied',
        },
      });
    }

    // Tenant suspension check: if target tenant is suspended, notify appropriately
    if (record.tenant.status === 'suspended') {
      return reply.status(403).send({
        error: {
          code: ErrorCodes.TENANT_SUSPENDED,
          message: 'This tenant business is suspended',
        },
      });
    }

    const tenantDTO: TenantDTO = {
      id: record.tenant.id,
      slug: record.tenant.slug,
      displayName: record.tenant.displayName,
      role: record.membership.role as Role,
      status: record.tenant.status as TenantStatus,
      brandColor: record.tenant.brandColor,
      logoUrl: record.tenant.logoUrl,
    };

    return reply.status(200).send(tenantDTO);
  });
};
