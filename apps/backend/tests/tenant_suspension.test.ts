import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp } from './setup.js';
import {
  tenants,
  locations,
  qrCampaigns,
  ephemeralSessions,
} from '../src/drizzle/schema.js';
import { CustomerSessionConstants, ErrorCodes } from '@review-system/shared';
import { generateSessionToken, hashSessionToken } from '../src/utils/crypto.js';
import { generateCampaignCode } from '../src/utils/qr.js';
import { suspendTenant } from '../src/utils/tenant_lifecycle.js';
import { eq } from 'drizzle-orm';

describe('Tenant Suspension Concurrency & Canonical Locks', () => {
  let app: any;
  let db: any;

  beforeEach(async () => {
    const testSetup = await createTestApp();
    app = testSetup.app;
    db = testSetup.db;
  });

  async function seedActiveTenantAndCampaign() {
    const [t] = await db
      .insert(tenants)
      .values({ displayName: 'Suspension Test Corp', slug: `susp-${Date.now()}` })
      .returning();

    const [l] = await db
      .insert(locations)
      .values({
        tenantId: t.id,
        name: 'Headquarters',
        googleReviewUrl: 'https://g.page/r/suspension/review',
        isPrimary: true,
      })
      .returning();

    const [c] = await db
      .insert(qrCampaigns)
      .values({
        tenantId: t.id,
        locationId: l.id,
        name: 'Main QR',
        code: generateCampaignCode(),
        status: 'active',
      })
      .returning();

    return { tenant: t, location: l, campaign: c };
  }

  it('1. should acquire exclusive row lock on tenant and update status to suspended', async () => {
    const { tenant } = await seedActiveTenantAndCampaign();

    // Call canonical suspendTenant helper
    await suspendTenant(db, tenant.id);

    const [reloaded] = await db.select().from(tenants).where(eq(tenants.id, tenant.id));
    expect(reloaded.status).toBe('suspended');
  });

  it('2. should block session creation immediately once tenant is suspended with 403 TENANT_SUSPENDED', async () => {
    const { tenant, campaign } = await seedActiveTenantAndCampaign();

    await suspendTenant(db, tenant.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/sessions`,
      headers: {
        origin: 'http://localhost:3000',
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe(ErrorCodes.TENANT_SUSPENDED);
    expect(res.json().error.message).toBe('This service is currently unavailable.');
  });

  it('3. should prevent feedback from committing after suspension has committed', async () => {
    const { tenant, location, campaign } = await seedActiveTenantAndCampaign();

    // Customer obtains valid session prior to suspension
    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);

    await db.insert(ephemeralSessions).values({
      tenantId: tenant.id,
      locationId: location.id,
      campaignId: campaign.id,
      tokenHash,
      issuedCode: campaign.code,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    // Suspend tenant (acquires FOR UPDATE on tenants)
    await suspendTenant(db, tenant.id);

    // Customer attempts to submit feedback with their pre-existing session
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: {
        origin: 'http://localhost:3000',
        cookie: `${CustomerSessionConstants.COOKIE_NAME}=${rawToken}`,
      },
      payload: {
        rating: 5,
        feedbackText: 'Submission after suspension',
        consentGiven: true,
      },
    });

    // Canonical lock on tenant FOR SHARE detects status === 'suspended' and aborts transaction
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe(ErrorCodes.TENANT_SUSPENDED);
    expect(res.json().error.message).toBe('This service is currently unavailable.');
  });
});
