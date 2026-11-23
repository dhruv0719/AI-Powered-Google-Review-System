import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp } from './setup.js';
import { FastifyInstance } from 'fastify';
import { ErrorCodes, AuthConstants, CampaignDTO } from '@review-system/shared';

describe('Campaign Management & QR Generation Integration Tests', () => {
  let app: FastifyInstance;
  let db: any;

  beforeEach(async () => {
    const testSetup = await createTestApp();
    app = testSetup.app;
    db = testSetup.db;
  });

  async function registerUser(email: string, businessName: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email,
        password: 'Password123!',
        fullName: 'Campaign Owner',
        businessName,
      },
    });
    const cookie = res.cookies.find((c) => c.name === AuthConstants.COOKIE_NAME)!;
    return { res, body: res.json(), cookie: cookie.value };
  }

  async function createLocation(tenantId: string, cookie: string, googleReviewUrl?: string, isActive = true) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: cookie },
      payload: {
        name: 'Main Store',
        googleReviewUrl: googleReviewUrl || null,
        isPrimary: true,
      },
    });
    return res.json();
  }

  it('1. should reject campaign creation if location does not have a Google Review URL', async () => {
    const user = await registerUser('no_url@test.com', 'No URL Coffee');
    const tenantId = user.body.activeTenant.id;
    const loc = await createLocation(tenantId, user.cookie);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc.id}/campaigns`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: {
        name: 'Front Counter Stand',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe(ErrorCodes.GOOGLE_REVIEW_URL_REQUIRED);
  });

  it('2. should successfully create a campaign when Google Review URL is configured', async () => {
    const user = await registerUser('with_url@test.com', 'Valid Coffee');
    const tenantId = user.body.activeTenant.id;
    const loc = await createLocation(
      tenantId,
      user.cookie,
      'https://g.page/r/CZZZ_test/review'
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc.id}/campaigns`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: {
        name: 'Front Counter Stand',
      },
    });

    expect(res.statusCode).toBe(201);
    const campaign: CampaignDTO = res.json();
    expect(campaign.name).toBe('Front Counter Stand');
    expect(campaign.status).toBe('active');
    expect(campaign.code).toMatch(/^q_[A-Za-z0-9_-]{22}$/);
    expect(campaign.publicUrl).toContain(`/q/${campaign.code}`);
  });

  it('3. should list campaigns for a location', async () => {
    const user = await registerUser('list_c@test.com', 'List Coffee');
    const tenantId = user.body.activeTenant.id;
    const loc = await createLocation(
      tenantId,
      user.cookie,
      'https://g.page/r/CZZZ_test/review'
    );

    // Create 2 campaigns
    await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc.id}/campaigns`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { name: 'Stand 1' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc.id}/campaigns`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { name: 'Stand 2' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc.id}/campaigns`,
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().campaigns).toHaveLength(2);
  });

  it('4. should rotate a campaign code, preserving status as active', async () => {
    const user = await registerUser('rotate_c@test.com', 'Rotate Coffee');
    const tenantId = user.body.activeTenant.id;
    const loc = await createLocation(
      tenantId,
      user.cookie,
      'https://g.page/r/CZZZ_test/review'
    );

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc.id}/campaigns`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { name: 'Rotatable Campaign' },
    });
    const originalCode = createRes.json().code;

    const rotateRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc.id}/campaigns/${createRes.json().id}/rotate`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });

    expect(rotateRes.statusCode).toBe(200);
    const updated = rotateRes.json();
    expect(updated.code).not.toBe(originalCode);
    expect(updated.code).toMatch(/^q_[A-Za-z0-9_-]{22}$/);
    expect(updated.status).toBe('active');
  });

  it('5. should revoke a campaign and reject rotation or reactivation of revoked campaigns', async () => {
    const user = await registerUser('revoke_c@test.com', 'Revoke Coffee');
    const tenantId = user.body.activeTenant.id;
    const loc = await createLocation(
      tenantId,
      user.cookie,
      'https://g.page/r/CZZZ_test/review'
    );

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc.id}/campaigns`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { name: 'Revokable Campaign' },
    });
    const campaignId = createRes.json().id;

    // Revoke
    const revokeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc.id}/campaigns/${campaignId}/revoke`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(revokeRes.statusCode).toBe(200);
    expect(revokeRes.json().status).toBe('revoked');

    // Attempt to reactivate
    const reactivateRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc.id}/campaigns/${campaignId}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { status: 'active' },
    });
    expect(reactivateRes.statusCode).toBe(400);
    expect(reactivateRes.json().error.code).toBe(ErrorCodes.INVALID_STATUS_TRANSITION);

    // Attempt to rotate
    const rotateRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc.id}/campaigns/${campaignId}/rotate`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(rotateRes.statusCode).toBe(400);
    expect(rotateRes.json().error.code).toBe(ErrorCodes.INVALID_STATUS_TRANSITION);
  });

  it('6. should prevent removing Google Review URL if active campaigns exist on location', async () => {
    const user = await registerUser('prevent_url@test.com', 'Prevent URL Coffee');
    const tenantId = user.body.activeTenant.id;
    const loc = await createLocation(
      tenantId,
      user.cookie,
      'https://g.page/r/CZZZ_test/review'
    );

    await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc.id}/campaigns`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { name: 'Active Stand' },
    });

    // Attempt to unset googleReviewUrl on location
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc.id}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { googleReviewUrl: null },
    });

    expect(patchRes.statusCode).toBe(400);
    expect(patchRes.json().error.code).toBe(ErrorCodes.CANNOT_REMOVE_GOOGLE_URL_ACTIVE_CAMPAIGN);
  });

  it('7. should serve printable QR codes in SVG and PNG formats', async () => {
    const user = await registerUser('qr_export@test.com', 'Export Coffee');
    const tenantId = user.body.activeTenant.id;
    const loc = await createLocation(
      tenantId,
      user.cookie,
      'https://g.page/r/CZZZ_test/review'
    );

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc.id}/campaigns`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
      payload: { name: 'Print Me' },
    });
    const campaignId = createRes.json().id;

    // SVG
    const svgRes = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc.id}/campaigns/${campaignId}/qr.svg`,
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(svgRes.statusCode).toBe(200);
    expect(svgRes.headers['content-type']).toContain('image/svg+xml');
    expect(svgRes.body).toContain('<svg');

    // PNG
    const pngRes = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${loc.id}/campaigns/${campaignId}/qr.png?size=512`,
      cookies: { [AuthConstants.COOKIE_NAME]: user.cookie },
    });
    expect(pngRes.statusCode).toBe(200);
    expect(pngRes.headers['content-type']).toBe('image/png');
    expect(pngRes.rawPayload.length).toBeGreaterThan(0);
  });

  it('8. should enforce tenant isolation on campaign endpoints', async () => {
    const ownerA = await registerUser('tenantA_camp@test.com', 'Tenant A');
    const ownerB = await registerUser('tenantB_camp@test.com', 'Tenant B');

    const locA = await createLocation(
      ownerA.body.activeTenant.id,
      ownerA.cookie,
      'https://g.page/r/CZZZ_testA/review'
    );

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${ownerA.body.activeTenant.id}/locations/${locA.id}/campaigns`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: ownerA.cookie },
      payload: { name: 'Secret Stand A' },
    });
    const campaignId = createRes.json().id;

    // Owner B attempts to access Owner A's campaign
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${ownerB.body.activeTenant.id}/locations/${locA.id}/campaigns/${campaignId}`,
      cookies: { [AuthConstants.COOKIE_NAME]: ownerB.cookie },
    });

    expect(res.statusCode).toBe(404);
  });
});
