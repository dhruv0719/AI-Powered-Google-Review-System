import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp } from './setup.js';
import { FastifyInstance } from 'fastify';
import { ErrorCodes, AuthConstants, ServiceDTO } from '@review-system/shared';
import { tenants } from '../src/drizzle/schema.js';
import { eq } from 'drizzle-orm';

describe('Service Catalogue Management Integration Tests', () => {
  let app: FastifyInstance;
  let db: any;

  beforeEach(async () => {
    const testSetup = await createTestApp();
    app = testSetup.app;
    db = testSetup.db;
  });

  // Helper to register user and create a primary location
  async function setupUserAndLocation(email: string, businessName: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email,
        password: 'Password123!',
        fullName: 'Service Owner',
        businessName,
      },
    });
    const cookie = res.cookies.find((c) => c.name === AuthConstants.COOKIE_NAME)!.value;
    const tenantId = res.json().activeTenant.id;

    // Create location
    const locRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: cookie },
      payload: { name: 'Main Service Center' },
    });

    const locationId = locRes.json().id;

    return { cookie, tenantId, locationId };
  }

  // 1. Create service successfully
  it('1. should create a service scoped to a physical location', async () => {
    const { cookie, tenantId, locationId } = await setupUserAndLocation(
      'svc_create@test.com',
      'Apex Garage'
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/services`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: cookie },
      payload: {
        name: 'Oil Change',
        description: 'Complete synthetic oil replacement with new filter',
        displayOrder: 1,
      },
    });

    expect(res.statusCode).toBe(201);
    const body: ServiceDTO = res.json();
    expect(body.name).toBe('Oil Change');
    expect(body.description).toBe('Complete synthetic oil replacement with new filter');
    expect(body.displayOrder).toBe(1);
    expect(body.isActive).toBe(true);
    expect(body.tenantId).toBe(tenantId);
    expect(body.locationId).toBe(locationId);
  });

  // 2. List services ordered by displayOrder
  it('2. should list services ordered by displayOrder ASC', async () => {
    const { cookie, tenantId, locationId } = await setupUserAndLocation(
      'svc_list@test.com',
      'Auto Order Shop'
    );

    // Create services with varying display orders
    await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/services`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: cookie },
      payload: { name: 'Service Order 10', displayOrder: 10 },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/services`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: cookie },
      payload: { name: 'Service Order 1', displayOrder: 1 },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/services`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: cookie },
      payload: { name: 'Service Order 5', displayOrder: 5 },
    });

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/services`,
      cookies: { [AuthConstants.COOKIE_NAME]: cookie },
    });

    expect(listRes.statusCode).toBe(200);
    const items: ServiceDTO[] = listRes.json().services;
    expect(items).toHaveLength(3);
    expect(items[0].name).toBe('Service Order 1');
    expect(items[1].name).toBe('Service Order 5');
    expect(items[2].name).toBe('Service Order 10');
  });

  // 3. Update service details and soft-deactivate
  it('3. should update service details and soft-deactivate via PATCH', async () => {
    const { cookie, tenantId, locationId } = await setupUserAndLocation(
      'svc_patch@test.com',
      'Patch Shop'
    );

    const created = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/services`,
        headers: { origin: 'http://localhost' },
        cookies: { [AuthConstants.COOKIE_NAME]: cookie },
        payload: { name: 'Brake Inspection', displayOrder: 2 },
      })
    ).json();

    // Update details
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/services/${created.id}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: cookie },
      payload: {
        name: 'Brake & Rotor Service',
        displayOrder: 1,
      },
    });

    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().name).toBe('Brake & Rotor Service');
    expect(patchRes.json().displayOrder).toBe(1);

    // Soft-deactivate
    const deactRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/services/${created.id}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: cookie },
      payload: { isActive: false },
    });

    expect(deactRes.statusCode).toBe(200);
    expect(deactRes.json().isActive).toBe(false);

    // Verify active filter omits deactivated service
    const activeList = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/services?status=active`,
      cookies: { [AuthConstants.COOKIE_NAME]: cookie },
    });
    expect(activeList.json().services).toHaveLength(0);

    // Verify all filter includes it
    const allList = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/services?status=all`,
      cookies: { [AuthConstants.COOKIE_NAME]: cookie },
    });
    expect(allList.json().services).toHaveLength(1);
    expect(allList.json().services[0].id).toBe(created.id);
  });

  // 4. Cross-tenant isolation
  it('4. should prevent User A from reading or modifying User B services (404)', async () => {
    const userA = await setupUserAndLocation('alice_svc@test.com', 'Alice Auto');
    const userB = await setupUserAndLocation('bob_svc@test.com', 'Bob Auto');

    // User B creates a service
    const serviceB = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/owner/tenants/${userB.tenantId}/locations/${userB.locationId}/services`,
        headers: { origin: 'http://localhost' },
        cookies: { [AuthConstants.COOKIE_NAME]: userB.cookie },
        payload: { name: 'Bob Private Service' },
      })
    ).json();

    // Alice attempts to access User B's service -> 404
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${userA.tenantId}/locations/${userA.locationId}/services/${serviceB.id}`,
      cookies: { [AuthConstants.COOKIE_NAME]: userA.cookie },
    });
    expect(getRes.statusCode).toBe(404);
    expect(getRes.json().error.code).toBe(ErrorCodes.SERVICE_NOT_FOUND);

    // Alice attempts to PATCH User B's service -> 404
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${userA.tenantId}/locations/${userA.locationId}/services/${serviceB.id}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: userA.cookie },
      payload: { name: 'Alice Tampered Name' },
    });
    expect(patchRes.statusCode).toBe(404);
    expect(patchRes.json().error.code).toBe(ErrorCodes.SERVICE_NOT_FOUND);
  });

  // 5. Tenant suspension enforcement
  it('5. should block all service operations on a suspended tenant with 403 TENANT_SUSPENDED', async () => {
    const { cookie, tenantId, locationId } = await setupUserAndLocation(
      'svc_susp@test.com',
      'Suspended Garage'
    );

    // Suspend tenant in DB
    await db.update(tenants).set({ status: 'suspended' }).where(eq(tenants.id, tenantId));

    // Attempt to create service -> 403
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/services`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: cookie },
      payload: { name: 'Blocked Service' },
    });
    expect(createRes.statusCode).toBe(403);
    expect(createRes.json().error.code).toBe(ErrorCodes.TENANT_SUSPENDED);

    // Attempt to list services -> 403
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/services`,
      cookies: { [AuthConstants.COOKIE_NAME]: cookie },
    });
    expect(listRes.statusCode).toBe(403);
    expect(listRes.json().error.code).toBe(ErrorCodes.TENANT_SUSPENDED);
  });
});
