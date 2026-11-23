import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp } from './setup.js';
import { FastifyInstance } from 'fastify';
import { ErrorCodes, AuthConstants } from '@review-system/shared';
import { tenants } from '../src/drizzle/schema.js';
import { eq } from 'drizzle-orm';

describe('Tenant Isolation & Multi-Tenancy Integration Tests', () => {
  let app: FastifyInstance;
  let db: any;

  beforeEach(async () => {
    const testSetup = await createTestApp();
    app = testSetup.app;
    db = testSetup.db;
  });

  // Helper to register user and return cookie + body
  async function registerUser(email: string, businessName: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email,
        password: 'Password123!',
        fullName: 'Test User',
        businessName,
      },
    });
    const cookie = res.cookies.find((c) => c.name === AuthConstants.COOKIE_NAME)!;
    return { res, body: res.json(), cookie: cookie.value };
  }

  // 9. Tenant creation and owner membership
  it('9. should assign owner role when user creates a new tenant', async () => {
    const userA = await registerUser('owner_a@test.com', 'Shop A');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/owner/tenants',
      cookies: { [AuthConstants.COOKIE_NAME]: userA.cookie },
      payload: {
        displayName: 'Shop A Secondary Branch',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.displayName).toBe('Shop A Secondary Branch');
    expect(body.role).toBe('owner');
    expect(body.status).toBe('active');
  });

  // 10. One user belonging to multiple tenants
  it('10. should allow one user to belong to multiple tenants and list them all', async () => {
    const userA = await registerUser('multi@test.com', 'Tenant Alpha');

    // Create a second tenant
    await app.inject({
      method: 'POST',
      url: '/api/v1/owner/tenants',
      cookies: { [AuthConstants.COOKIE_NAME]: userA.cookie },
      payload: {
        displayName: 'Tenant Beta',
      },
    });

    // List all tenants
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/owner/tenants',
      cookies: { [AuthConstants.COOKIE_NAME]: userA.cookie },
    });

    expect(listRes.statusCode).toBe(200);
    const tenantsList = listRes.json().tenants;
    expect(tenantsList.length).toBe(2);
    expect(tenantsList.map((t: any) => t.displayName)).toContain('Tenant Alpha');
    expect(tenantsList.map((t: any) => t.displayName)).toContain('Tenant Beta');
  });

  // 11. Unauthorized tenant access rejection (Switching & Access)
  it('11. should reject unauthorized tenant switching if user is not a member', async () => {
    const userA = await registerUser('user_a@test.com', 'Tenant of User A');
    const userB = await registerUser('user_b@test.com', 'Tenant of User B');

    const tenantBId = userB.body.activeTenant.id;

    // User A tries to switch active tenant to User B's tenant
    const switchRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantBId}/switch`,
      cookies: { [AuthConstants.COOKIE_NAME]: userA.cookie },
    });

    expect(switchRes.statusCode).toBe(403);
    expect(switchRes.json().error.code).toBe(ErrorCodes.FORBIDDEN);

    // Verify User A's session is still on Tenant A
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [AuthConstants.COOKIE_NAME]: userA.cookie },
    });
    expect(meRes.json().activeTenant.displayName).toBe('Tenant of User A');
  });

  // 12. Cross-tenant read prevention
  it('12. should prevent User A from reading details of User B tenant', async () => {
    const userA = await registerUser('alice@test.com', 'Alice Motors');
    const userB = await registerUser('bob@test.com', 'Bob Car Spares');

    const bobTenantId = userB.body.activeTenant.id;

    // Alice tries to get Bob's tenant
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${bobTenantId}`,
      cookies: { [AuthConstants.COOKIE_NAME]: userA.cookie },
    });

    expect(getRes.statusCode).toBe(404);
    expect(getRes.json().error.code).toBe(ErrorCodes.TENANT_NOT_FOUND);
  });

  // Tenant Suspension: Blocks access to affected tenant without invalidating user session
  it('should block operations on a suspended tenant without revoking user session or other tenants', async () => {
    const user = await registerUser('suspension_test@test.com', 'Tenant Good');

    // Create second tenant
    const secondTenantRes = await app.inject({
      method: 'POST',
      url: '/api/v1/owner/tenants',
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: {
        displayName: 'Tenant To Be Suspended',
      },
    });
    const suspendedTenantId = secondTenantRes.json().id;

    // Switch active tenant to second tenant
    await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${suspendedTenantId}/switch`,
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });

    // Mark second tenant as suspended directly in DB (simulating admin action)
    await db
      .update(tenants)
      .set({ status: 'suspended' })
      .where(eq(tenants.id, suspendedTenantId));

    // Accessing suspended tenant details returns 403 TENANT_SUSPENDED
    const accessRes = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${suspendedTenantId}`,
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(accessRes.statusCode).toBe(403);
    expect(accessRes.json().error.code).toBe(ErrorCodes.TENANT_SUSPENDED);

    // Crucial check: User session is still valid! User can switch back to Tenant Good
    const goodTenantId = user.body.activeTenant.id;
    const switchBackRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${goodTenantId}/switch`,
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(switchBackRes.statusCode).toBe(200);

    // Accessing Tenant Good succeeds cleanly
    const goodAccess = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${goodTenantId}`,
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(goodAccess.statusCode).toBe(200);
    expect(goodAccess.json().displayName).toBe('Tenant Good');
  });
});
