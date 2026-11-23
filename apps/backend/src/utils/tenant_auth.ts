import { FastifyReply } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { tenants, tenantMemberships, locations } from '../drizzle/schema.js';
import { ErrorCodes, Roles } from '@review-system/shared';

export interface TenantOwnerContext {
  membership: typeof tenantMemberships.$inferSelect;
  tenant: typeof tenants.$inferSelect;
}

/**
 * Validates that an authenticated user has active OWNER membership in the target tenant.
 * - Non-existent or non-member: 404 TENANT_NOT_FOUND (non-disclosing).
 * - Suspended tenant: 403 TENANT_SUSPENDED.
 * - Non-owner member: 403 FORBIDDEN.
 */
export async function verifyTenantOwner(
  db: any,
  userId: string,
  tenantId: string,
  reply: FastifyReply
): Promise<TenantOwnerContext | null> {
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
    reply.status(404).send({
      error: {
        code: ErrorCodes.TENANT_NOT_FOUND,
        message: 'Tenant not found or access denied',
      },
    });
    return null;
  }

  if (record.tenant.status === 'suspended') {
    reply.status(403).send({
      error: {
        code: ErrorCodes.TENANT_SUSPENDED,
        message: 'This tenant business is suspended',
      },
    });
    return null;
  }

  if (record.membership.role !== Roles.OWNER) {
    reply.status(403).send({
      error: {
        code: ErrorCodes.FORBIDDEN,
        message: 'Owner role required for this action',
      },
    });
    return null;
  }

  return record;
}

/**
 * Validates that an authenticated user has active OWNER membership in the target tenant
 * and that the specified location exists and belongs to that tenant.
 */
export async function verifyLocationOwnership(
  db: any,
  userId: string,
  tenantId: string,
  locationId: string,
  reply: FastifyReply
): Promise<TenantOwnerContext | null> {
  const ownerContext = await verifyTenantOwner(db, userId, tenantId, reply);
  if (!ownerContext) return null;

  const [loc] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.tenantId, tenantId)))
    .limit(1);

  if (!loc) {
    reply.status(404).send({
      error: {
        code: ErrorCodes.LOCATION_NOT_FOUND,
        message: 'Location not found or does not belong to this business',
      },
    });
    return null;
  }

  return ownerContext;
}
