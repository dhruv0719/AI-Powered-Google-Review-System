import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp } from './setup.js';
import { FastifyInstance } from 'fastify';
import {
  ErrorCodes,
  AuthConstants,
  CustomerSessionConstants,
  PublicQRResolutionDTO,
} from '@review-system/shared';
import { ephemeralSessions, tenants, locations } from '../src/drizzle/schema.js';
import { eq } from 'drizzle-orm';

describe('Public QR Resolution & Explicit Session Issuance Integration Tests', () => {
  let app: FastifyInstance;
  let db: any;

  beforeEach(async () => {
    const testSetup = await createTestApp();
    app = testSetup.app;
    db = testSetup.db;
  });

  async function setupActiveCampaign() {
    // 1. Register owner
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `owner_${Date.now()}@test.com`,
        password: 'Password123!',
        fullName: 'Test Owner',
        businessName: 'The Artisan Bakery',
      },
    });
    const cookie = regRes.cookies.find((c) => c.name === AuthConstants.COOKIE_NAME)!.value;
    const tenantId = regRes.json().activeTenant.id;

    // 2. Create location with Google URL
    const locRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: cookie },
      payload: {
        name: 'Downtown Bakery',
        address: '100 Main St',
        city: 'Metro',
        googleReviewUrl: 'https://g.page/r/artisan_bakery/review',
        isPrimary: true,
      },
    });
    const locationId = locRes.json().id;

    // 3. Create active service
    await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/services`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: cookie },
      payload: {
        name: 'Sourdough Bread',
        displayOrder: 1,
      },
    });

    // 4. Create campaign
    const campRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/campaigns`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: cookie },
      payload: {
        name: 'Main Counter QR',
      },
    });

    return {
      tenantId,
      locationId,
      campaign: campRes.json(),
      ownerCookie: cookie,
    };
  }

  it('1. should resolve public QR data read-only with ZERO database writes and ZERO cookies', async () => {
    const { campaign } = await setupActiveCampaign();

    // Check count of sessions in DB before GET
    const sessionsBefore = await db.select().from(ephemeralSessions);
    expect(sessionsBefore).toHaveLength(0);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/public/qr/${campaign.code}`,
    });

    expect(res.statusCode).toBe(200);
    const body: PublicQRResolutionDTO = res.json();

    expect(body.tenant.displayName).toBe('The Artisan Bakery');
    expect(body.location.name).toBe('Downtown Bakery');
    expect(body.location.googleReviewUrl).toBe('https://g.page/r/artisan_bakery/review');
    expect(body.services).toHaveLength(1);
    expect(body.services[0].name).toBe('Sourdough Bread');

    // Verify ZERO cookies set
    expect(res.cookies).toHaveLength(0);

    // Verify ZERO session rows created in database
    const sessionsAfter = await db.select().from(ephemeralSessions);
    expect(sessionsAfter).toHaveLength(0);
  });

  it('2. should reject GET resolution for invalid format or non-existent code with 404', async () => {
    // Malformed code
    const resInvalid = await app.inject({
      method: 'GET',
      url: '/api/v1/public/qr/invalid-code',
    });
    expect(resInvalid.statusCode).toBe(404);
    expect(resInvalid.json().error.code).toBe(ErrorCodes.CAMPAIGN_NOT_FOUND);

    // Well-formed but non-existent code
    const resNonExistent = await app.inject({
      method: 'GET',
      url: '/api/v1/public/qr/q_0000000000000000000000',
    });
    expect(resNonExistent.statusCode).toBe(404);
    expect(resNonExistent.json().error.code).toBe(ErrorCodes.CAMPAIGN_NOT_FOUND);
  });

  it('3. should reject GET resolution if campaign is inactive or revoked', async () => {
    const { tenantId, locationId, campaign, ownerCookie } = await setupActiveCampaign();

    // Pause campaign
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/campaigns/${campaign.id}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: ownerCookie },
      payload: { status: 'inactive' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/public/qr/${campaign.code}`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(ErrorCodes.CAMPAIGN_INACTIVE);
  });

  it('4. should reject session issuance when Origin/Referer is absent or untrusted', async () => {
    const { campaign } = await setupActiveCampaign();

    // Absent Origin and Referer
    const resNoOrigin = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/sessions`,
    });
    expect(resNoOrigin.statusCode).toBe(403);
    expect(resNoOrigin.json().error.code).toBe(ErrorCodes.FORBIDDEN);

    // Untrusted Origin
    const resUntrusted = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/sessions`,
      headers: { origin: 'https://evil-phishing-site.com' },
    });
    expect(resUntrusted.statusCode).toBe(403);
    expect(resUntrusted.json().error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it('5. should issue an explicit ephemeral customer session with path-scoped cookie and allow session reuse', async () => {
    const { campaign } = await setupActiveCampaign();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/sessions`,
      headers: { origin: 'http://localhost:5173' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toHaveProperty('expiresAt');

    // Cookie verification
    const sessionCookie = res.cookies.find((c) => c.name === CustomerSessionConstants.COOKIE_NAME);
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie!.httpOnly).toBe(true);
    expect(sessionCookie!.sameSite).toBe('Lax');
    expect(sessionCookie!.path).toBe(`/api/v1/public/qr/${campaign.code}`);

    // DB verification
    const dbSessions = await db.select().from(ephemeralSessions);
    expect(dbSessions).toHaveLength(1);
    expect(dbSessions[0].issuedCode).toBe(campaign.code);
    expect(dbSessions[0].feedbackSubmittedAt).toBeNull();

    // Session reuse: POST again with existing cookie
    const reuseRes = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/sessions`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie!.value },
    });

    expect(reuseRes.statusCode).toBe(200);
    // Verify no new session was added to DB
    const dbSessionsAfter = await db.select().from(ephemeralSessions);
    expect(dbSessionsAfter).toHaveLength(1);
  });

  it('6. should reject request with 403 when Origin is mismatched even if Referer is canonical (Referer never overrides mismatched Origin)', async () => {
    const { campaign } = await setupActiveCampaign();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/sessions`,
      headers: {
        origin: 'https://evil-spoofed-attacker.com',
        referer: 'http://localhost:5173/legitimate-page',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe(ErrorCodes.FORBIDDEN);
  });

  it('7. should reject feedback submissions exceeding 16KB body limit with 413 Payload Too Large', async () => {
    const { campaign } = await setupActiveCampaign();

    // Issue session
    const sessRes = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/sessions`,
      headers: { origin: 'http://localhost:5173' },
    });
    const cookie = sessRes.cookies.find((c) => c.name === CustomerSessionConstants.COOKIE_NAME)!.value;

    // Huge payload > 16KB
    const hugePadding = 'A'.repeat(20 * 1024); // 20KB
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: cookie },
      payload: {
        rating: 5,
        feedbackText: hugePadding,
        consentGiven: true,
      },
    });

    expect(res.statusCode).toBe(413);
  });
});
