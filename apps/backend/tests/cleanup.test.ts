import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp } from './setup.js';
import { runCleanupNow, startCleanupJob, stopCleanupJob } from '../src/jobs/cleanup.js';
import {
  tenants,
  locations,
  qrCampaigns,
  ephemeralSessions,
  privateFeedback,
  services,
  privateFeedbackServices,
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

  it('3. should purge private feedback and its corresponding submitted session older than 365 days while preserving younger feedback', async () => {
    const { tenant, location, campaign } = await seedBaseData();

    // 1. Very old feedback (370 days ago) with submitted session
    const oldToken = generateSessionToken();
    const [oldSess] = await db
      .insert(ephemeralSessions)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        tokenHash: hashSessionToken(oldToken),
        issuedCode: campaign.code,
        expiresAt: new Date(Date.now() - 370 * 86400 * 1000),
        feedbackSubmittedAt: new Date(Date.now() - 370 * 86400 * 1000),
      })
      .returning();

    const [oldFb] = await db
      .insert(privateFeedback)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        sessionId: oldSess.id,
        rating: 4,
        feedbackText: 'Ancient feedback 370 days old',
        consentGiven: true,
        createdAt: new Date(Date.now() - 370 * 86400 * 1000),
      })
      .returning();

    // 2. Moderately old feedback (100 days ago) - older than 30d contact purge, but younger than 365d
    const midToken = generateSessionToken();
    const [midSess] = await db
      .insert(ephemeralSessions)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        tokenHash: hashSessionToken(midToken),
        issuedCode: campaign.code,
        expiresAt: new Date(Date.now() - 100 * 86400 * 1000),
        feedbackSubmittedAt: new Date(Date.now() - 100 * 86400 * 1000),
      })
      .returning();

    const [midFb] = await db
      .insert(privateFeedback)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        sessionId: midSess.id,
        rating: 5,
        feedbackText: 'Feedback from 100 days ago should remain',
        consentGiven: true,
        createdAt: new Date(Date.now() - 100 * 86400 * 1000),
      })
      .returning();

    // Execute cleanup
    const result = await runCleanupNow(db);
    expect(result.purgedFeedback).toBe(1);

    // Verify ancient feedback is deleted
    const [reloadedOldFb] = await db
      .select()
      .from(privateFeedback)
      .where(eq(privateFeedback.id, oldFb.id));
    expect(reloadedOldFb).toBeUndefined();

    // Verify ancient session is deleted
    const [reloadedOldSess] = await db
      .select()
      .from(ephemeralSessions)
      .where(eq(ephemeralSessions.id, oldSess.id));
    expect(reloadedOldSess).toBeUndefined();

    // Verify 100-day feedback is PRESERVED
    const [reloadedMidFb] = await db
      .select()
      .from(privateFeedback)
      .where(eq(privateFeedback.id, midFb.id));
    expect(reloadedMidFb).toBeDefined();
    expect(reloadedMidFb.feedbackText).toBe('Feedback from 100 days ago should remain');

    // Verify 100-day session is PRESERVED
    const [reloadedMidSess] = await db
      .select()
      .from(ephemeralSessions)
      .where(eq(ephemeralSessions.id, midSess.id));
    expect(reloadedMidSess).toBeDefined();
  });

  it('4. should precisely respect the 365-day boundary (preserve 364d 23h, purge 365d 1h)', async () => {
    const { tenant, location, campaign } = await seedBaseData();

    // 1. Boundary: 364 days 23 hours ago (NOT yet 365 days) -> Must be kept
    const tokenNear = generateSessionToken();
    const [sessNear] = await db
      .insert(ephemeralSessions)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        tokenHash: hashSessionToken(tokenNear),
        issuedCode: campaign.code,
        expiresAt: new Date(Date.now() - (364 * 86400 + 23 * 3600) * 1000),
        feedbackSubmittedAt: new Date(Date.now() - (364 * 86400 + 23 * 3600) * 1000),
      })
      .returning();

    const [fbNear] = await db
      .insert(privateFeedback)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        sessionId: sessNear.id,
        rating: 5,
        feedbackText: '364d 23h old feedback',
        consentGiven: true,
        createdAt: new Date(Date.now() - (364 * 86400 + 23 * 3600) * 1000),
      })
      .returning();

    // 2. Boundary: 365 days 1 hour ago (EXCEEDS 365 days) -> Must be purged
    const tokenPast = generateSessionToken();
    const [sessPast] = await db
      .insert(ephemeralSessions)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        tokenHash: hashSessionToken(tokenPast),
        issuedCode: campaign.code,
        expiresAt: new Date(Date.now() - (365 * 86400 + 3600) * 1000),
        feedbackSubmittedAt: new Date(Date.now() - (365 * 86400 + 3600) * 1000),
      })
      .returning();

    const [fbPast] = await db
      .insert(privateFeedback)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        sessionId: sessPast.id,
        rating: 3,
        feedbackText: '365d 1h old feedback',
        consentGiven: true,
        createdAt: new Date(Date.now() - (365 * 86400 + 3600) * 1000),
      })
      .returning();

    const result = await runCleanupNow(db);
    expect(result.purgedFeedback).toBe(1);

    // fbNear must exist
    const [foundNear] = await db.select().from(privateFeedback).where(eq(privateFeedback.id, fbNear.id));
    expect(foundNear).toBeDefined();
    const [foundSessNear] = await db.select().from(ephemeralSessions).where(eq(ephemeralSessions.id, sessNear.id));
    expect(foundSessNear).toBeDefined();

    // fbPast must be gone
    const [foundPast] = await db.select().from(privateFeedback).where(eq(privateFeedback.id, fbPast.id));
    expect(foundPast).toBeUndefined();
    const [foundSessPast] = await db.select().from(ephemeralSessions).where(eq(ephemeralSessions.id, sessPast.id));
    expect(foundSessPast).toBeUndefined();
  });

  it('5. should purge associations in private_feedback_services and preserve referential integrity', async () => {
    const { tenant, location, campaign } = await seedBaseData();

    // Insert service
    const [svc] = await db
      .insert(services)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        name: 'Oil Change',
        isActive: true,
      })
      .returning();

    // Insert session > 365d
    const token = generateSessionToken();
    const [sess] = await db
      .insert(ephemeralSessions)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        tokenHash: hashSessionToken(token),
        issuedCode: campaign.code,
        expiresAt: new Date(Date.now() - 366 * 86400 * 1000),
        feedbackSubmittedAt: new Date(Date.now() - 366 * 86400 * 1000),
      })
      .returning();

    // Insert feedback > 365d
    const [fb] = await db
      .insert(privateFeedback)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        sessionId: sess.id,
        rating: 2,
        feedbackText: 'Slow service 366 days ago',
        consentGiven: true,
        createdAt: new Date(Date.now() - 366 * 86400 * 1000),
      })
      .returning();

    // Insert service association
    await db.insert(privateFeedbackServices).values({
      feedbackId: fb.id,
      serviceId: svc.id,
      tenantId: tenant.id,
      locationId: location.id,
      serviceNameSnapshot: 'Oil Change',
    });

    const result = await runCleanupNow(db);
    expect(result.purgedFeedback).toBe(1);

    // Association deleted
    const [foundAssoc] = await db
      .select()
      .from(privateFeedbackServices)
      .where(eq(privateFeedbackServices.feedbackId, fb.id));
    expect(foundAssoc).toBeUndefined();

    // Feedback deleted
    const [foundFb] = await db.select().from(privateFeedback).where(eq(privateFeedback.id, fb.id));
    expect(foundFb).toBeUndefined();

    // Session deleted
    const [foundSess] = await db.select().from(ephemeralSessions).where(eq(ephemeralSessions.id, sess.id));
    expect(foundSess).toBeUndefined();

    // Service itself remains intact!
    const [foundSvc] = await db.select().from(services).where(eq(services.id, svc.id));
    expect(foundSvc).toBeDefined();
  });

  it('6. should delete 500+ records in batches cleanly across atomic transactions', async () => {
    const { tenant, location, campaign } = await seedBaseData();

    // Create 505 expired feedback records and sessions in bulk
    const BATCH_SIZE = 505;
    const sessionInserts: any[] = [];
    for (let i = 0; i < BATCH_SIZE; i++) {
      const token = generateSessionToken();
      sessionInserts.push({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        tokenHash: hashSessionToken(token),
        issuedCode: campaign.code,
        expiresAt: new Date(Date.now() - 370 * 86400 * 1000),
        feedbackSubmittedAt: new Date(Date.now() - 370 * 86400 * 1000),
      });
    }

    const insertedSessions = await db.insert(ephemeralSessions).values(sessionInserts).returning({ id: ephemeralSessions.id });

    const feedbackInserts = insertedSessions.map((s: any, idx: number) => ({
      tenantId: tenant.id,
      locationId: location.id,
      campaignId: campaign.id,
      sessionId: s.id,
      rating: 4,
      feedbackText: `Bulk feedback item ${idx}`,
      consentGiven: true,
      createdAt: new Date(Date.now() - 370 * 86400 * 1000),
    }));

    await db.insert(privateFeedback).values(feedbackInserts);

    // Run cleanup - batch processing loop should clear all 505 records (batch 1: 500, batch 2: 5)
    const result = await runCleanupNow(db);
    expect(result.purgedFeedback).toBe(BATCH_SIZE);

    // Verify 0 remaining feedback older than 365 days
    const remaining = await db
      .select({ id: privateFeedback.id })
      .from(privateFeedback)
      .where(sql`${privateFeedback.createdAt} < NOW() - INTERVAL '365 days'`);
    expect(remaining.length).toBe(0);
  });

  it('7. should recover gracefully after transient failure and reset isRunning guard', async () => {
    const { tenant, location, campaign } = await seedBaseData();

    const token = generateSessionToken();
    const [sess] = await db
      .insert(ephemeralSessions)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        tokenHash: hashSessionToken(token),
        issuedCode: campaign.code,
        expiresAt: new Date(Date.now() - 380 * 86400 * 1000),
        feedbackSubmittedAt: new Date(Date.now() - 380 * 86400 * 1000),
      })
      .returning();

    const [fb] = await db
      .insert(privateFeedback)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        sessionId: sess.id,
        rating: 1,
        feedbackText: 'Error recovery test feedback',
        consentGiven: true,
        createdAt: new Date(Date.now() - 380 * 86400 * 1000),
      })
      .returning();

    // Create a mock DB that throws on transaction
    const failingDb = {
      transaction: async () => {
        throw new Error('Simulated transient DB connection drop');
      },
      execute: async () => [],
    };

    const failResult = await runCleanupNow(failingDb);
    expect(failResult.purgedFeedback).toBe(0);

    // Verify subsequent run with real DB works immediately (isRunning was properly cleared in finally)
    const recoverResult = await runCleanupNow(db);
    expect(recoverResult.purgedFeedback).toBe(1);

    const [reloadedFb] = await db.select().from(privateFeedback).where(eq(privateFeedback.id, fb.id));
    expect(reloadedFb).toBeUndefined();
  });

  it('8. should defer startup cleanup execution and clean up timers on stopCleanupJob', async () => {
    const { tenant, location, campaign } = await seedBaseData();

    // Insert an expired unsubmitted session
    const token = generateSessionToken();
    const [sess] = await db
      .insert(ephemeralSessions)
      .values({
        tenantId: tenant.id,
        locationId: location.id,
        campaignId: campaign.id,
        tokenHash: hashSessionToken(token),
        issuedCode: campaign.code,
        expiresAt: new Date(Date.now() - 30 * 3600 * 1000), // 30h ago
        feedbackSubmittedAt: null,
      })
      .returning();

    // Start with 50ms initial delay (instead of production 30 minutes)
    startCleanupJob(db, { initialDelayMs: 50, intervalMs: 200 });

    // Verify session still exists immediately after start (NOT run synchronously on boot)
    const [immediateCheck] = await db
      .select()
      .from(ephemeralSessions)
      .where(eq(ephemeralSessions.id, sess.id));
    expect(immediateCheck).toBeDefined();

    // Wait 100ms for deferred startup run to execute
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Session should now be purged by the deferred run
    const [deferredCheck] = await db
      .select()
      .from(ephemeralSessions)
      .where(eq(ephemeralSessions.id, sess.id));
    expect(deferredCheck).toBeUndefined();

    // Clean up timers on shutdown
    stopCleanupJob();
  });
});
