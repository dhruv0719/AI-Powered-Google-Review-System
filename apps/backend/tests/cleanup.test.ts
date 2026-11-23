import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp } from './setup.js';
import { runCleanupNow } from '../src/jobs/cleanup.js';
import {
  tenants,
  locations,
  qrCampaigns,
  ephemeralSessions,
  privateFeedback,
} from '../src/drizzle/schema.js';
import { sql, eq } from 'drizzle-orm';
import { generateSessionToken, hashSessionToken } from '../src/utils/crypto.js';

describe('Data Retention & Background Cleanup Integration Tests', () => {
  let db: any;

  beforeEach(async () => {
    const testSetup = await createTestApp();
    db = testSetup.db;
  });

  async function seedBaseData() {
    const [t] = await db
      .insert(tenants)
      .values({ displayName: 'Retention Cafe', slug: `cafe-${Date.now()}` })
      .returning();

    const [l] = await db
      .insert(locations)
      .values({
        tenantId: t.id,
        name: 'Main Location',
        googleReviewUrl: 'https://g.page/r/test/review',
        isPrimary: true,
      })
      .returning();

    const [c] = await db
      .insert(qrCampaigns)
      .values({
        tenantId: t.id,
        locationId: l.id,
        name: 'Retention QR',
        code: `q_${Date.now()}_test123456`,
        status: 'active',
      })
      .returning();

    return { tenant: t, location: l, campaign: c };
  }

  it('1. should delete expired unsubmitted sessions older than 24h while preserving submitted and unexpired sessions', async () => {
    const { tenant, location, campaign } = await seedBaseData();

    // 1. Unsubmitted expired session (> 24h ago)
    const token1 = generateSessionToken();
    const [s1] = await db
      .insert(ephemeralSessions)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        tokenHash: hashSessionToken(token1),
        issuedCode: campaign.code,
        expiresAt: new Date(Date.now() - 25 * 3600 * 1000), // 25 hours ago
        feedbackSubmittedAt: null,
      })
      .returning();

    // 2. Submitted expired session (> 24h ago)
    const token2 = generateSessionToken();
    const [s2] = await db
      .insert(ephemeralSessions)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        tokenHash: hashSessionToken(token2),
        issuedCode: campaign.code,
        expiresAt: new Date(Date.now() - 25 * 3600 * 1000),
        feedbackSubmittedAt: new Date(Date.now() - 25 * 3600 * 1000),
      })
      .returning();

    // Attach feedback to s2
    await db.insert(privateFeedback).values({
      tenantId: tenant.id,
      locationId: location.id,
      campaignId: campaign.id,
      sessionId: s2.id,
      rating: 5,
      feedbackText: 'Great service!',
      consentGiven: true,
      status: 'new',
    });

    // 3. Active unexpired session
    const token3 = generateSessionToken();
    const [s3] = await db
      .insert(ephemeralSessions)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        tokenHash: hashSessionToken(token3),
        issuedCode: campaign.code,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        feedbackSubmittedAt: null,
      })
      .returning();

    // Run cleanup
    const result = await runCleanupNow(db);
    expect(result.deletedSessions).toBe(1);

    // Verify s1 is deleted
    const [found1] = await db.select().from(ephemeralSessions).where(eq(ephemeralSessions.id, s1.id));
    expect(found1).toBeUndefined();

    // Verify s2 is preserved
    const [found2] = await db.select().from(ephemeralSessions).where(eq(ephemeralSessions.id, s2.id));
    expect(found2).toBeDefined();

    // Verify s3 is preserved
    const [found3] = await db.select().from(ephemeralSessions).where(eq(ephemeralSessions.id, s3.id));
    expect(found3).toBeDefined();
  });

  it('2. should purge customer contact details on feedback older than 30 days while keeping rating and feedback intact', async () => {
    const { tenant, location, campaign } = await seedBaseData();

    // Create session
    const token = generateSessionToken();
    const [sess] = await db
      .insert(ephemeralSessions)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        tokenHash: hashSessionToken(token),
        issuedCode: campaign.code,
        expiresAt: new Date(Date.now() - 35 * 86400 * 1000),
        feedbackSubmittedAt: new Date(Date.now() - 35 * 86400 * 1000),
      })
      .returning();

    // Feedback created 35 days ago with contact
    const [fOld] = await db
      .insert(privateFeedback)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        sessionId: sess.id,
        rating: 4,
        feedbackText: 'Good food 35 days ago',
        customerContact: 'sensitive_customer@example.com',
        consentGiven: true,
        createdAt: new Date(Date.now() - 35 * 86400 * 1000),
      })
      .returning();

    // Fresh feedback created today with contact
    const token2 = generateSessionToken();
    const [sess2] = await db
      .insert(ephemeralSessions)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        tokenHash: hashSessionToken(token2),
        issuedCode: campaign.code,
        expiresAt: new Date(),
        feedbackSubmittedAt: new Date(),
      })
      .returning();

    const [fFresh] = await db
      .insert(privateFeedback)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        sessionId: sess2.id,
        rating: 5,
        feedbackText: 'Recent review',
        customerContact: 'fresh_customer@example.com',
        consentGiven: true,
        createdAt: new Date(),
      })
      .returning();

    // Run cleanup
    const result = await runCleanupNow(db);
    expect(result.purgedContacts).toBeGreaterThanOrEqual(1);

    // Verify fOld has customerContact purged to NULL
    const [reloadedOld] = await db.select().from(privateFeedback).where(eq(privateFeedback.id, fOld.id));
    expect(reloadedOld.customerContact).toBeNull();
    expect(reloadedOld.rating).toBe(4);
    expect(reloadedOld.feedbackText).toBe('Good food 35 days ago');

    // Verify fFresh retains customerContact
    const [reloadedFresh] = await db.select().from(privateFeedback).where(eq(privateFeedback.id, fFresh.id));
    expect(reloadedFresh.customerContact).toBe('fresh_customer@example.com');
  });
});
