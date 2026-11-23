import { eq, sql } from 'drizzle-orm';
import { tenants } from '../drizzle/schema.js';

/**
 * Suspends a tenant with explicit canonical locking:
 * 1. Acquires conflicting row-level exclusive lock: SELECT id FROM tenants WHERE id = :tenantId FOR UPDATE
 * 2. Updates tenants.status = 'suspended'
 * 
 * PostgreSQL Concurrency Guarantee:
 * Conflicting locks ensure mutual exclusion with customer feedback submissions and session issuance:
 * - Public feedback submissions acquire SELECT id FROM tenants WHERE id = :tenantId FOR SHARE.
 * - If suspension runs first, it holds FOR UPDATE. Feedback transactions block waiting for FOR SHARE.
 *   Once suspension commits, feedback unblocks, evaluates tenant.status === 'suspended',
 *   and immediately aborts with 403 TENANT_SUSPENDED. Feedback CANNOT commit after suspension commits!
 * - If feedback runs first, it holds FOR SHARE. Suspension blocks waiting for FOR UPDATE.
 *   Once feedback commits, suspension proceeds.
 */
export async function suspendTenant(db: any, tenantId: string): Promise<void> {
  await db.transaction(async (tx: any) => {
    // 1. Canonical Lock: Acquire conflicting exclusive row lock on tenant
    await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`);

    // 2. Update tenant status to suspended
    await tx
      .update(tenants)
      .set({
        status: 'suspended',
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));
  });
}
