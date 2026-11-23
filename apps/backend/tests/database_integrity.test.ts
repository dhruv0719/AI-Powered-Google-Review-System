import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp } from './setup.js';
import { tenants, locations, services } from '../src/drizzle/schema.js';

describe('Database-Level Constraints & Invariant Tests', () => {
  let db: any;
  let tenantAId: string;
  let tenantBId: string;

  beforeEach(async () => {
    const testSetup = await createTestApp();
    db = testSetup.db;

    // Create two test tenants
    const [tA] = await db
      .insert(tenants)
      .values({ displayName: 'Tenant Integrity A', slug: 'tenant-integrity-a' })
      .returning();
    const [tB] = await db
      .insert(tenants)
      .values({ displayName: 'Tenant Integrity B', slug: 'tenant-integrity-b' })
      .returning();

    tenantAId = tA.id;
    tenantBId = tB.id;
  });

  // 1. CHECK Constraint: is_primary = false OR is_active = true
  it('1. should reject inserting an inactive primary location via CHECK constraint (check_primary_active)', async () => {
    await expect(
      db.insert(locations).values({
        tenantId: tenantAId,
        name: 'Invalid Inactive Primary',
        isPrimary: true,
        isActive: false, // Violates check_primary_active!
      })
    ).rejects.toThrow();
  });

  // 2. Partial Unique Index: at most ONE primary location per tenant
  it('2. should reject inserting multiple primary locations for the same tenant via partial unique index', async () => {
    // First primary location succeeds
    await db.insert(locations).values({
      tenantId: tenantAId,
      name: 'Primary Branch 1',
      isPrimary: true,
      isActive: true,
    });

    // Second primary location for Tenant A directly in DB violates partial unique index
    await expect(
      db.insert(locations).values({
        tenantId: tenantAId,
        name: 'Primary Branch 2',
        isPrimary: true, // Duplicate primary for same tenant!
        isActive: true,
      })
    ).rejects.toThrow();
  });

  // 3. Composite Foreign Key: (tenant_id, location_id) -> locations(tenant_id, id)
  it('3. should reject inserting a service referencing a location belonging to another tenant via composite FK', async () => {
    // Create Location belonging to Tenant B
    const [locB] = await db
      .insert(locations)
      .values({
        tenantId: tenantBId,
        name: 'Tenant B Branch',
        isPrimary: true,
        isActive: true,
      })
      .returning();

    // Malicious or buggy attempt: Insert service with tenantAId but locationId belonging to Tenant B!
    await expect(
      db.insert(services).values({
        tenantId: tenantAId, // Belongs to Tenant A
        locationId: locB.id, // But location belongs to Tenant B!
        name: 'Cross-Tenant Exploit Service',
        displayOrder: 1,
        isActive: true,
      })
    ).rejects.toThrow(); // Violates composite FK constraint!
  });

  // 4. Composite Foreign Key: Valid insertion succeeding
  it('4. should successfully insert a service when tenant_id and location_id match locations table', async () => {
    const [locA] = await db
      .insert(locations)
      .values({
        tenantId: tenantAId,
        name: 'Tenant A Branch',
        isPrimary: true,
        isActive: true,
      })
      .returning();

    const [svc] = await db
      .insert(services)
      .values({
        tenantId: tenantAId,
        locationId: locA.id,
        name: 'Valid Matching Service',
        displayOrder: 1,
        isActive: true,
      })
      .returning();

    expect(svc).toBeDefined();
    expect(svc.tenantId).toBe(tenantAId);
    expect(svc.locationId).toBe(locA.id);
  });
});
