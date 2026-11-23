import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp } from './setup.js';
import { FastifyInstance } from 'fastify';
import { ErrorCodes, AuthConstants, Roles } from '@review-system/shared';
import { tenants, tenantMemberships, sessions } from '../src/drizzle/schema.js';
import { eq, and } from 'drizzle-orm';

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
      headers: { origin: 'http://localhost' },
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
      headers: { origin: 'http://localhost' },
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
      headers: { origin: 'http://localhost' },
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
      headers: { origin: 'http://localhost' },
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
      headers: { origin: 'http://localhost' },
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
      headers: { origin: 'http://localhost' },
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

  // Multi-Tenant Switching: 1 user, 3 tenants, switching across all three
  it('should support 1 user with 3 tenants, switching between all 3 seamlessly', async () => {
    const user = await registerUser('three_tenants@test.com', 'Tenant 1');
    const tenant1Id = user.body.activeTenant.id;

    // Create Tenant 2
    const t2Res = await app.inject({
      method: 'POST',
      url: '/api/v1/owner/tenants',
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { displayName: 'Tenant 2' },
    });
    const tenant2Id = t2Res.json().id;

    // Create Tenant 3
    const t3Res = await app.inject({
      method: 'POST',
      url: '/api/v1/owner/tenants',
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { displayName: 'Tenant 3' },
    });
    const tenant3Id = t3Res.json().id;

    // List all 3 tenants
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/owner/tenants',
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().tenants.length).toBe(3);

    // Switch to Tenant 2
    const switchTo2 = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenant2Id}/switch`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(switchTo2.statusCode).toBe(200);
    expect(switchTo2.json().activeTenant.displayName).toBe('Tenant 2');

    // Verify GET /me reflects Tenant 2
    const me2 = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(me2.json().activeTenant.id).toBe(tenant2Id);

    // Switch to Tenant 3
    const switchTo3 = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenant3Id}/switch`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(switchTo3.statusCode).toBe(200);
    expect(switchTo3.json().activeTenant.displayName).toBe('Tenant 3');

    // Switch back to Tenant 1
    const switchTo1 = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenant1Id}/switch`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(switchTo1.statusCode).toBe(200);
    expect(switchTo1.json().activeTenant.displayName).toBe('Tenant 1');
  });

  // Membership Deletion / Cascade: Deleting tenant_memberships row cascades to sessions
  it('should cascade session deletion when membership row is deleted via composite foreign key', async () => {
    const user = await registerUser('cascade_test@test.com', 'Cascade Tenant');
    const tenantId = user.body.activeTenant.id;
    const userId = user.body.user.id;

    // Verify session exists in DB
    const [existingSession] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), eq(sessions.activeTenantId, tenantId)));
    expect(existingSession).toBeDefined();

    // Verify authenticated request works
    const check1 = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(check1.statusCode).toBe(200);

    // Delete membership row in database
    await db
      .delete(tenantMemberships)
      .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.tenantId, tenantId)));

    // Verify composite foreign key CASCADE deleted the session row
    const [cascadedSession] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), eq(sessions.activeTenantId, tenantId)));
    expect(cascadedSession).toBeUndefined();

    // Verify subsequent request with that session cookie is immediately rejected with 401 UNAUTHORIZED
    const check2 = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(check2.statusCode).toBe(401);
    expect(check2.json().error.code).toBe(ErrorCodes.UNAUTHORIZED);
  });

  // Business Profile Updating & Isolation
  it('should allow owner to update business display name and prevent unauthorized tenant edits', async () => {
    const userA = await registerUser('tenant_profile_a@test.com', 'Initial Name A');
    const userB = await registerUser('tenant_profile_b@test.com', 'Initial Name B');

    const tenantAId = userA.body.activeTenant.id;
    const tenantBId = userB.body.activeTenant.id;

    // User A successfully updates their business name
    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${tenantAId}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: userA.cookie },
      payload: { displayName: 'Updated Business Name A' },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().displayName).toBe('Updated Business Name A');

    // User A attempts to update User B's business name -> 404
    const tamperRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${tenantBId}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: userA.cookie },
      payload: { displayName: 'Hacked Name B' },
    });
    expect(tamperRes.statusCode).toBe(404);
    expect(tamperRes.json().error.code).toBe(ErrorCodes.TENANT_NOT_FOUND);
  });

  // Explicit OWNER Role Guard Regression Test
  it('should reject owner operations when user is a tenant member with non-owner role (403 FORBIDDEN)', async () => {
    const ownerUser = await registerUser('biz_owner@test.com', 'Owner Enterprise');
    const staffUser = await registerUser('biz_staff@test.com', 'Staff Personal Workspace');

    const enterpriseTenantId = ownerUser.body.activeTenant.id;
    const staffUserId = staffUser.body.user.id;

    // Simulate adding staffUser as a 'staff' member to Owner Enterprise in database
    await db.insert(tenantMemberships).values({
      userId: staffUserId,
      tenantId: enterpriseTenantId,
      role: Roles.STAFF,
    });

    // 1. Staff attempts GET /owner/tenants/:tenantId -> 403 FORBIDDEN
    const getTenantRes = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${enterpriseTenantId}`,
      cookies: { [AuthConstants.COOKIE_NAME]: staffUser.cookie },
    });
    expect(getTenantRes.statusCode).toBe(403);
    expect(getTenantRes.json().error.code).toBe(ErrorCodes.FORBIDDEN);

    // 2. Staff attempts PATCH /owner/tenants/:tenantId -> 403 FORBIDDEN
    const patchTenantRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${enterpriseTenantId}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: staffUser.cookie },
      payload: { displayName: 'Staff Attempted Edit' },
    });
    expect(patchTenantRes.statusCode).toBe(403);
    expect(patchTenantRes.json().error.code).toBe(ErrorCodes.FORBIDDEN);

    // 3. Staff attempts GET /owner/tenants/:tenantId/locations -> 403 FORBIDDEN
    const getLocRes = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${enterpriseTenantId}/locations`,
      cookies: { [AuthConstants.COOKIE_NAME]: staffUser.cookie },
    });
    expect(getLocRes.statusCode).toBe(403);
    expect(getLocRes.json().error.code).toBe(ErrorCodes.FORBIDDEN);

    // 4. Staff attempts POST /owner/tenants/:tenantId/locations -> 403 FORBIDDEN
    const postLocRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${enterpriseTenantId}/locations`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: staffUser.cookie },
      payload: { name: 'Staff Unauthorized Branch' },
    });
    expect(postLocRes.statusCode).toBe(403);
    expect(postLocRes.json().error.code).toBe(ErrorCodes.FORBIDDEN);

    // 5. Verify the actual Owner can perform these operations successfully
    const ownerLocRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${enterpriseTenantId}/locations`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: ownerUser.cookie },
      payload: { name: 'Owner Authorized Branch' },
    });
    expect(ownerLocRes.statusCode).toBe(201);
  });

  // Path-Based Multi-Tenant Authorization Policy Regression Test
  it('should allow multi-tenant owner to access any owned tenant via path parameter without switching active session context', async () => {
    const user = await registerUser('multi_path_owner@test.com', 'Tenant Alpha Workspace');
    const tenantAlphaId = user.body.activeTenant.id;

    // Create a second tenant under same user (user is Owner of both)
    const tBetaRes = await app.inject({
      method: 'POST',
      url: '/api/v1/owner/tenants',
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { displayName: 'Tenant Beta Workspace' },
    });
    const tenantBetaId = tBetaRes.json().id;

    // Verify session activeTenantId is still Tenant Alpha
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(meRes.json().activeTenant.id).toBe(tenantAlphaId);

    // Directly access Tenant Beta locations WITHOUT switching activeTenantId in session
    const betaLocListRes = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${tenantBetaId}/locations`,
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(betaLocListRes.statusCode).toBe(200);
    expect(Array.isArray(betaLocListRes.json().locations)).toBe(true);

    // Create a location in Tenant Beta directly
    const betaLocCreateRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantBetaId}/locations`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { name: 'Beta HQ Location' },
    });
    expect(betaLocCreateRes.statusCode).toBe(201);
    expect(betaLocCreateRes.json().name).toBe('Beta HQ Location');

    // Attempting to access an unrelated tenant returns non-disclosing 404
    const unrelatedUser = await registerUser('unrelated@test.com', 'Unrelated Business');
    const unrelatedTenantId = unrelatedUser.body.activeTenant.id;

    const unauthorizedRes = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${unrelatedTenantId}/locations`,
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(unauthorizedRes.statusCode).toBe(404);
    expect(unauthorizedRes.json().error.code).toBe(ErrorCodes.TENANT_NOT_FOUND);
  });
});
