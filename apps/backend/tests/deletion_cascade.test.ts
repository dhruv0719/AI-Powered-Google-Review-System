import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp } from './setup.js';
import {
  tenants,
  locations,
  services,
  qrCampaigns,
  ephemeralSessions,
  privateFeedback,
  privateFeedbackServices,
} from '../src/drizzle/schema.js';
import { eq } from 'drizzle-orm';
import { generateSessionToken, hashSessionToken } from '../src/utils/crypto.js';

describe('PostgreSQL Deletion Cascade Integrity Tests', () => {
  let db: any;

  beforeEach(async () => {
    const testSetup = await createTestApp();
    db = testSetup.db;
  });

  async function buildCompleteHierarchy() {
    // 1. Tenant
    const [t] = await db
      .insert(tenants)
      .values({ displayName: 'Cascade Test Tenant', slug: `cascade-${Date.now()}` })
      .returning();

    // 2. Location
    const [l] = await db
      .insert(locations)
      .values({
        tenantId: t.id,
        name: 'Cascade Location',
        googleReviewUrl: 'https://g.page/r/cascade/review',
        isPrimary: true,
      })
      .returning();

    // 3. Service
    const [s] = await db
      .insert(services)
      .values({
        tenantId: t.id,
        locationId: l.id,
        name: 'Cascade Service',
        displayOrder: 1,
      })
      .returning();

    // 4. Campaign
    const [c] = await db
      .insert(qrCampaigns)
      .values({
        tenantId: t.id,
        locationId: l.id,
        name: 'Cascade Campaign',
        code: `q_${Date.now()}_cascade12345`,
        status: 'active',
      })
      .returning();

    // 5. Session
    const token = generateSessionToken();
    const [sess] = await db
      .insert(ephemeralSessions)
      .values({
        tenantId: t.id,
        locationId: l.id,
        campaignId: c.id,
        tokenHash: hashSessionToken(token),
        issuedCode: c.code,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      })
      .returning();

    // 6. Feedback
    const [fb] = await db
      .insert(privateFeedback)
      .values({
        tenantId: t.id,
        locationId: l.id,
        campaignId: c.id,
        sessionId: sess.id,
        rating: 5,
        feedbackText: 'Cascade text test',
        customerContact: 'cascade@example.com',
        consentGiven: true,
        status: 'new',
      })
      .returning();

    // 7. Feedback Services association
    await db.insert(privateFeedbackServices).values({
      feedbackId: fb.id,
      serviceId: s.id,
      tenantId: t.id,
      locationId: l.id,
      serviceNameSnapshot: s.name,
    });

    return {
      tenant: t,
      location: l,
      service: s,
      campaign: c,
      session: sess,
      feedback: fb,
    };
  }

  it('1. should cascade delete from campaign down to sessions, feedback, and feedback_services', async () => {
    const data = await buildCompleteHierarchy();

    // Delete campaign
    await db.delete(qrCampaigns).where(eq(qrCampaigns.id, data.campaign.id));

    // Verify campaign is deleted
    const campCheck = await db.select().from(qrCampaigns).where(eq(qrCampaigns.id, data.campaign.id));
    expect(campCheck).toHaveLength(0);

    // Verify session cascaded
    const sessCheck = await db.select().from(ephemeralSessions).where(eq(ephemeralSessions.id, data.session.id));
    expect(sessCheck).toHaveLength(0);

    // Verify feedback cascaded
    const fbCheck = await db.select().from(privateFeedback).where(eq(privateFeedback.id, data.feedback.id));
    expect(fbCheck).toHaveLength(0);

    // Verify feedback services association cascaded
    const assocCheck = await db
      .select()
      .from(privateFeedbackServices)
      .where(eq(privateFeedbackServices.feedbackId, data.feedback.id));
    expect(assocCheck).toHaveLength(0);

    // Location and services should still exist
    const locCheck = await db.select().from(locations).where(eq(locations.id, data.location.id));
    expect(locCheck).toHaveLength(1);
    const servCheck = await db.select().from(services).where(eq(services.id, data.service.id));
    expect(servCheck).toHaveLength(1);
  });

  it('2. should cascade delete from tenant down through all children without FK lock or ordering conflicts', async () => {
    const data = await buildCompleteHierarchy();

    // Delete tenant
    await db.delete(tenants).where(eq(tenants.id, data.tenant.id));

    // Verify all descendant tables are empty
    const locCheck = await db.select().from(locations).where(eq(locations.tenantId, data.tenant.id));
    expect(locCheck).toHaveLength(0);

    const servCheck = await db.select().from(services).where(eq(services.tenantId, data.tenant.id));
    expect(servCheck).toHaveLength(0);

    const campCheck = await db.select().from(qrCampaigns).where(eq(qrCampaigns.tenantId, data.tenant.id));
    expect(campCheck).toHaveLength(0);

    const sessCheck = await db.select().from(ephemeralSessions).where(eq(ephemeralSessions.tenantId, data.tenant.id));
    expect(sessCheck).toHaveLength(0);

    const fbCheck = await db.select().from(privateFeedback).where(eq(privateFeedback.tenantId, data.tenant.id));
    expect(fbCheck).toHaveLength(0);
  });
});
