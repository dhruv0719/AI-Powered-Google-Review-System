import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp } from './setup.js';
import { FastifyInstance } from 'fastify';
import { ErrorCodes, AuthConstants, LocationDTO } from '@review-system/shared';
import { tenants } from '../src/drizzle/schema.js';
import { eq } from 'drizzle-orm';

describe('Location Management & Primary Invariant Integration Tests', () => {
  let app: FastifyInstance;
  let db: any;

  beforeEach(async () => {
    const testSetup = await createTestApp();
    app = testSetup.app;
    db = testSetup.db;
  });

  // Helper to register user
  async function registerUser(email: string, businessName: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email,
        password: 'Password123!',
        fullName: 'Test Owner',
        businessName,
      },
    });
    const cookie = res.cookies.find((c) => c.name === AuthConstants.COOKIE_NAME)!;
    return { res, body: res.json(), cookie: cookie.value };
  }

  // 1. Zero locations initially
  it('1. should show zero locations for a newly registered tenant', async () => {
    const user = await registerUser('loc_zero@test.com', 'Zero Loc Shop');
    const tenantId = user.body.activeTenant.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${tenantId}/locations`,
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().locations).toHaveLength(0);
  });

  // 2. First location automatically becomes primary
  it('2. should automatically force the first created location to be primary', async () => {
    const user = await registerUser('loc_first@test.com', 'First Loc Shop');
    const tenantId = user.body.activeTenant.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: {
        name: 'Downtown Workshop',
        address: '123 Main St',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001',
        phone: '+91 98765 43210',
        googleReviewUrl: 'https://g.page/r/CbGQ2j4example/review',
        isPrimary: false, // Even if requested as false, first location MUST be primary!
      },
    });

    expect(res.statusCode).toBe(201);
    const body: LocationDTO = res.json();
    expect(body.name).toBe('Downtown Workshop');
    expect(body.isPrimary).toBe(true); // Enforced invariant
    expect(body.isActive).toBe(true);
    expect(body.address).toBe('123 Main St');
    expect(body.googleReviewUrl).toBe('https://g.page/r/CbGQ2j4example/review');
  });

  // 3. Second location created with isPrimary: true atomically demotes previous primary
  it('3. should atomically demote existing primary when second location is created with isPrimary = true', async () => {
    const user = await registerUser('loc_multi@test.com', 'Multi Branch Auto');
    const tenantId = user.body.activeTenant.id;

    // Loc 1: Automatically primary
    const loc1Res = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { name: 'Branch Alpha' },
    });
    const loc1Id = loc1Res.json().id;

    // Loc 2: Explicitly created as primary
    const loc2Res = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { name: 'Branch Beta', isPrimary: true },
    });
    expect(loc2Res.statusCode).toBe(201);
    expect(loc2Res.json().isPrimary).toBe(true);

    // Verify Loc 1 is now demoted to false
    const loc1Check = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc1Id}`,
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(loc1Check.json().isPrimary).toBe(false);
  });

  // 4. Primary switching via PATCH /locations/:id
  it('4. should atomically switch primary location via PATCH', async () => {
    const user = await registerUser('loc_switch@test.com', 'Switch Branch Co');
    const tenantId = user.body.activeTenant.id;

    const loc1 = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/owner/tenants/${tenantId}/locations`,
        headers: { origin: 'http://localhost' },
        cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
        payload: { name: 'Branch 1' },
      })
    ).json();

    const loc2 = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/owner/tenants/${tenantId}/locations`,
        headers: { origin: 'http://localhost' },
        cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
        payload: { name: 'Branch 2', isPrimary: false },
      })
    ).json();

    expect(loc1.isPrimary).toBe(true);
    expect(loc2.isPrimary).toBe(false);

    // Switch primary to Branch 2
    const switchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc2.id}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { isPrimary: true },
    });

    expect(switchRes.statusCode).toBe(200);
    expect(switchRes.json().isPrimary).toBe(true);

    // Verify Branch 1 is now false
    const check1 = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc1.id}`,
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(check1.json().isPrimary).toBe(false);
  });

  // 5. Direct unsetting of primary is rejected
  it('5. should reject unsetting isPrimary = false directly on the primary location', async () => {
    const user = await registerUser('loc_unset@test.com', 'Unset Primary Shop');
    const tenantId = user.body.activeTenant.id;

    const loc1 = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/owner/tenants/${tenantId}/locations`,
        headers: { origin: 'http://localhost' },
        cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
        payload: { name: 'Primary Only' },
      })
    ).json();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc1.id}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { isPrimary: false },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(ErrorCodes.CANNOT_UNSET_PRIMARY);
  });

  // 6. Cannot promote an inactive location to primary
  it('6. should reject designating an inactive location as primary', async () => {
    const user = await registerUser('loc_inact_prom@test.com', 'Inactive Promote Shop');
    const tenantId = user.body.activeTenant.id;

    const loc1 = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/owner/tenants/${tenantId}/locations`,
        headers: { origin: 'http://localhost' },
        cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
        payload: { name: 'Active Branch' },
      })
    ).json();

    const loc2 = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/owner/tenants/${tenantId}/locations`,
        headers: { origin: 'http://localhost' },
        cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
        payload: { name: 'Branch to Deactivate' },
      })
    ).json();

    // Deactivate Loc 2
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc2.id}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { isActive: false },
    });

    // Attempt to promote inactive Loc 2 to primary
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc2.id}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { isPrimary: true },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(ErrorCodes.CANNOT_PROMOTE_INACTIVE_LOCATION);
  });

  // 7. Reject deactivating the sole active location
  it('7. should reject deactivating the only active location', async () => {
    const user = await registerUser('loc_sole@test.com', 'Sole Branch Shop');
    const tenantId = user.body.activeTenant.id;

    const loc1 = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/owner/tenants/${tenantId}/locations`,
        headers: { origin: 'http://localhost' },
        cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
        payload: { name: 'Sole Location' },
      })
    ).json();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc1.id}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { isActive: false },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(ErrorCodes.CANNOT_DEACTIVATE_ONLY_LOCATION);
  });

  // 8. Primary deactivation requires valid replacement primary
  it('8. should require newPrimaryLocationId when deactivating primary with other active locations', async () => {
    const user = await registerUser('loc_replace@test.com', 'Replace Primary Shop');
    const tenantId = user.body.activeTenant.id;

    const loc1 = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/owner/tenants/${tenantId}/locations`,
        headers: { origin: 'http://localhost' },
        cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
        payload: { name: 'Branch 1 (Primary)' },
      })
    ).json();

    const loc2 = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/owner/tenants/${tenantId}/locations`,
        headers: { origin: 'http://localhost' },
        cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
        payload: { name: 'Branch 2 (Secondary)' },
      })
    ).json();

    // Attempt 1: Deactivate without newPrimaryLocationId -> Rejected
    const missingRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc1.id}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { isActive: false },
    });
    expect(missingRes.statusCode).toBe(400);
    expect(missingRes.json().error.code).toBe(ErrorCodes.INVALID_PRIMARY_REPLACEMENT);

    // Attempt 2: Deactivate with self as replacement -> Rejected
    const selfRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc1.id}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { isActive: false, newPrimaryLocationId: loc1.id },
    });
    expect(selfRes.statusCode).toBe(400);
    expect(selfRes.json().error.code).toBe(ErrorCodes.INVALID_PRIMARY_REPLACEMENT);

    // Attempt 3: Deactivate with valid replacement (loc2) -> Atomically succeeds
    const validRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc1.id}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { isActive: false, newPrimaryLocationId: loc2.id },
    });
    expect(validRes.statusCode).toBe(200);
    expect(validRes.json().isActive).toBe(false);
    expect(validRes.json().isPrimary).toBe(false);

    // Verify loc2 is now primary
    const loc2Check = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc2.id}`,
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(loc2Check.json().isPrimary).toBe(true);
    expect(loc2Check.json().isActive).toBe(true);
  });

  // 9. Location filtering by status (all / active / inactive)
  it('9. should filter locations correctly by status query parameter', async () => {
    const user = await registerUser('loc_filter@test.com', 'Filter Shop');
    const tenantId = user.body.activeTenant.id;

    const loc1 = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/owner/tenants/${tenantId}/locations`,
        headers: { origin: 'http://localhost' },
        cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
        payload: { name: 'Active Branch' },
      })
    ).json();

    const loc2 = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/owner/tenants/${tenantId}/locations`,
        headers: { origin: 'http://localhost' },
        cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
        payload: { name: 'Branch To Deactivate' },
      })
    ).json();

    // Deactivate loc2
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc2.id}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { isActive: false },
    });

    // Query active only
    const activeRes = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${tenantId}/locations?status=active`,
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(activeRes.json().locations).toHaveLength(1);
    expect(activeRes.json().locations[0].id).toBe(loc1.id);

    // Query inactive only
    const inactiveRes = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${tenantId}/locations?status=inactive`,
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(inactiveRes.json().locations).toHaveLength(1);
    expect(inactiveRes.json().locations[0].id).toBe(loc2.id);

    // Query all
    const allRes = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${tenantId}/locations?status=all`,
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(allRes.json().locations).toHaveLength(2);
  });

  // 10. Cross-tenant isolation on location endpoints
  it('10. should prevent User A from reading or modifying User B location (404)', async () => {
    const userA = await registerUser('alice_loc@test.com', 'Alice Auto');
    const userB = await registerUser('bob_loc@test.com', 'Bob Auto');

    const locB = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/owner/tenants/${userB.body.activeTenant.id}/locations`,
        headers: { origin: 'http://localhost' },
        cookies: { [AuthConstants.COOKIE_NAME]: userB.cookie },
        payload: { name: 'Bob Main Branch' },
      })
    ).json();

    // Alice attempts to GET Bob's location under Alice's tenant ID -> 404
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${userA.body.activeTenant.id}/locations/${locB.id}`,
      cookies: { [AuthConstants.COOKIE_NAME]: userA.cookie },
    });
    expect(getRes.statusCode).toBe(404);
    expect(getRes.json().error.code).toBe(ErrorCodes.LOCATION_NOT_FOUND);

    // Alice attempts to PATCH Bob's location under Alice's tenant ID -> 404
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${userA.body.activeTenant.id}/locations/${locB.id}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: userA.cookie },
      payload: { name: 'Hacked by Alice' },
    });
    expect(patchRes.statusCode).toBe(404);
    expect(patchRes.json().error.code).toBe(ErrorCodes.LOCATION_NOT_FOUND);
  });

  // 11. Google Review URL validation integration
  it('11. should reject invalid or non-Google Review URLs during creation', async () => {
    const user = await registerUser('loc_url_val@test.com', 'URL Validation Shop');
    const tenantId = user.body.activeTenant.id;

    // Insecure HTTP
    const httpRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: {
        name: 'Insecure Link Branch',
        googleReviewUrl: 'http://g.page/r/CbGQ2j4example/review',
      },
    });
    expect(httpRes.statusCode).toBe(400);
    expect(httpRes.json().error.code).toBe(ErrorCodes.VALIDATION_ERROR);

    // Phishing Domain
    const phishRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: {
        name: 'Phishing Link Branch',
        googleReviewUrl: 'https://g.page.evil-phish.com/review',
      },
    });
    expect(phishRes.statusCode).toBe(400);
    expect(phishRes.json().error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  // 12. Tenant suspension enforcement
  it('12. should block all location operations on a suspended tenant with 403 TENANT_SUSPENDED', async () => {
    const user = await registerUser('loc_susp@test.com', 'Suspended Shop');
    const tenantId = user.body.activeTenant.id;

    // Suspend tenant directly in DB
    await db.update(tenants).set({ status: 'suspended' }).where(eq(tenants.id, tenantId));

    // Attempt to create location -> 403
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { name: 'Blocked Branch' },
    });
    expect(createRes.statusCode).toBe(403);
    expect(createRes.json().error.code).toBe(ErrorCodes.TENANT_SUSPENDED);

    // Attempt to list locations -> 403
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${tenantId}/locations`,
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(listRes.statusCode).toBe(403);
    expect(listRes.json().error.code).toBe(ErrorCodes.TENANT_SUSPENDED);
  });
});
