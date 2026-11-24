import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp } from './setup.js';
import { FastifyInstance } from 'fastify';
import {
  ErrorCodes,
  AuthConstants,
  CustomerSessionConstants,
  PrivateFeedbackDTO,
} from '@review-system/shared';
import {
  privateFeedback,
  privateFeedbackServices,
  ephemeralSessions,
} from '../src/drizzle/schema.js';

describe('Private Customer Feedback & Inbox Integration Tests', () => {
  let app: FastifyInstance;
  let db: any;

  beforeEach(async () => {
    const testSetup = await createTestApp();
    app = testSetup.app;
    db = testSetup.db;
  });

  async function setupCampaignWithServices() {
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `feedback_owner_${Date.now()}@test.com`,
        password: 'Password123!',
        fullName: 'Feedback Owner',
        businessName: 'Gourmet Bistro',
      },
    });
    const ownerCookie = regRes.cookies.find((c) => c.name === AuthConstants.COOKIE_NAME)!.value;
    const tenantId = regRes.json().activeTenant.id;

    const locRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: ownerCookie },
      payload: {
        name: 'Uptown Branch',
        address: '500 Bistro Blvd',
        googleReviewUrl: 'https://g.page/r/gourmet_bistro/review',
        isPrimary: true,
      },
    });
    const locationId = locRes.json().id;

    const s1Res = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/services`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: ownerCookie },
      payload: { name: 'Dinner Service' },
    });
    const s1Id = s1Res.json().id;

    const s2Res = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/services`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: ownerCookie },
      payload: { name: 'Wine Tasting' },
    });
    const s2Id = s2Res.json().id;

    const campRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/campaigns`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: ownerCookie },
      payload: { name: 'Dinner Table Tent' },
    });
    const campaign = campRes.json();

    return {
      tenantId,
      locationId,
      campaign,
      serviceIds: [s1Id, s2Id],
      ownerCookie,
    };
  }

  async function issueCustomerSession(code: string) {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${code}/sessions`,
      headers: { origin: 'http://localhost:5173' },
    });
    const cookie = res.cookies.find((c) => c.name === CustomerSessionConstants.COOKIE_NAME)!;
    return cookie.value;
  }

  it('1. should reject feedback submission without explicit affirmative consent', async () => {
    const { campaign } = await setupCampaignWithServices();
    const sessionToken = await issueCustomerSession(campaign.code);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionToken },
      payload: {
        rating: 5,
        feedbackText: 'Great food!',
        consentGiven: false, // Rejected
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('2. should enforce rating range (1-5) and feedback text constraints', async () => {
    const { campaign } = await setupCampaignWithServices();
    const sessionToken = await issueCustomerSession(campaign.code);

    // Rating 0
    const resRating0 = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionToken },
      payload: { rating: 0, consentGiven: true },
    });
    expect(resRating0.statusCode).toBe(400);

    // Rating 6
    const resRating6 = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionToken },
      payload: { rating: 6, consentGiven: true },
    });
    expect(resRating6.statusCode).toBe(400);

    // Short text (< 3 chars)
    const resShortText = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionToken },
      payload: { rating: 5, feedbackText: 'ok', consentGiven: true },
    });
    expect(resShortText.statusCode).toBe(400);
  });

  it('3. should accept valid private feedback and snapshot service names', async () => {
    const { tenantId, campaign, serviceIds } = await setupCampaignWithServices();
    const sessionToken = await issueCustomerSession(campaign.code);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionToken },
      payload: {
        rating: 4,
        serviceIds: [serviceIds[0]],
        feedbackText: 'The bread was warm and delicious, but wait was a bit long.',
        customerContact: 'guest@example.com',
        consentGiven: true,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().success).toBe(true);

    // Verify DB insertion
    const feedbacks = await db.select().from(privateFeedback);
    expect(feedbacks).toHaveLength(1);
    expect(feedbacks[0].rating).toBe(4);
    expect(feedbacks[0].customerContact).toBe('guest@example.com');
    expect(feedbacks[0].status).toBe('new');

    // Verify snapshot in private_feedback_services
    const snapshotted = await db.select().from(privateFeedbackServices);
    expect(snapshotted).toHaveLength(1);
    expect(snapshotted[0].serviceId).toBe(serviceIds[0]);
    expect(snapshotted[0].serviceNameSnapshot).toBe('Dinner Service');

    // Verify session marked submitted
    const [sess] = await db.select().from(ephemeralSessions);
    expect(sess.feedbackSubmittedAt).not.toBeNull();
  });

  it('4. should prevent replay attack (submitting twice on same session returns 409)', async () => {
    const { campaign } = await setupCampaignWithServices();
    const sessionToken = await issueCustomerSession(campaign.code);

    // First submission
    const res1 = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionToken },
      payload: { rating: 5, consentGiven: true },
    });
    expect(res1.statusCode).toBe(201);

    // Second submission on same session
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionToken },
      payload: { rating: 5, consentGiven: true },
    });
    expect(res2.statusCode).toBe(409);
    expect(res2.json().error.code).toBe(ErrorCodes.ALREADY_SUBMITTED);
  });

  it('5. should preserve in-flight customer session across campaign rotation', async () => {
    const { tenantId, locationId, campaign, ownerCookie } = await setupCampaignWithServices();

    // Customer opens page and gets session under original code
    const originalCode = campaign.code;
    const sessionToken = await issueCustomerSession(originalCode);

    // Owner rotates campaign
    const rotateRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/campaigns/${campaign.id}/rotate`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: ownerCookie },
    });
    expect(rotateRes.statusCode).toBe(200);
    const newCode = rotateRes.json().code;
    expect(newCode).not.toBe(originalCode);

    // In-flight customer submits feedback under originalCode
    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${originalCode}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionToken },
      payload: {
        rating: 5,
        feedbackText: 'Completed my review even after QR was rotated!',
        consentGiven: true,
      },
    });

    expect(submitRes.statusCode).toBe(201);
    expect(submitRes.json().success).toBe(true);

    // But a NEW scan on the old code is rejected
    const newScanRes = await app.inject({
      method: 'GET',
      url: `/api/v1/public/qr/${originalCode}`,
    });
    expect(newScanRes.statusCode).toBe(404);
  });

  it('6. should reject in-flight customer session if campaign was revoked', async () => {
    const { tenantId, locationId, campaign, ownerCookie } = await setupCampaignWithServices();

    // Customer gets session
    const sessionToken = await issueCustomerSession(campaign.code);

    // Owner revokes campaign
    await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/campaigns/${campaign.id}/revoke`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: ownerCookie },
    });

    // Customer attempts to submit feedback
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionToken },
      payload: { rating: 5, consentGiven: true },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(ErrorCodes.CAMPAIGN_INACTIVE);
  });

  it('7. should list feedback in owner inbox with filters and allow status transitions', async () => {
    const { tenantId, campaign, ownerCookie } = await setupCampaignWithServices();

    // Create a feedback item
    const token = await issueCustomerSession(campaign.code);
    await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: token },
      payload: {
        rating: 4,
        feedbackText: 'Friendly staff and prompt service.',
        customerContact: '0987654321',
        consentGiven: true,
      },
    });

    // Owner lists feedback
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/owner/tenants/${tenantId}/feedback?status=new`,
      cookies: { [AuthConstants.COOKIE_NAME]: ownerCookie },
    });

    expect(listRes.statusCode).toBe(200);
    const listData = listRes.json();
    expect(listData.feedback).toHaveLength(1);
    const item: PrivateFeedbackDTO = listData.feedback[0];
    expect(item.status).toBe('new');
    expect(item.rating).toBe(4);
    expect(item.customerContact).toBe('0987654321');

    // Owner updates status: new -> reviewed
    const patchRes1 = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${tenantId}/feedback/${item.id}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: ownerCookie },
      payload: { status: 'reviewed' },
    });
    expect(patchRes1.statusCode).toBe(200);
    expect(patchRes1.json().status).toBe('reviewed');

    // Owner updates status: reviewed -> archived
    const patchRes2 = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${tenantId}/feedback/${item.id}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: ownerCookie },
      payload: { status: 'archived' },
    });
    expect(patchRes2.statusCode).toBe(200);
    expect(patchRes2.json().status).toBe('archived');

    // Reopening an archived feedback is rejected
    const patchRes3 = await app.inject({
      method: 'PATCH',
      url: `/api/v1/owner/tenants/${tenantId}/feedback/${item.id}`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: ownerCookie },
      payload: { status: 'reviewed' },
    });
    expect(patchRes3.statusCode).toBe(400);
    expect(patchRes3.json().error.code).toBe(ErrorCodes.INVALID_STATUS_TRANSITION);
  });

  it('8. should reject feedback submission when session was issued for a different campaign code', async () => {
    const { tenantId, locationId, campaign, ownerCookie } = await setupCampaignWithServices();

    // Create second campaign
    const camp2Res = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/campaigns`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: ownerCookie },
      payload: { name: 'Second Stand' },
    });
    const campaign2 = camp2Res.json();

    // Issue session under campaign 1
    const sessionToken1 = await issueCustomerSession(campaign.code);

    // Attempt to submit feedback to campaign 2 using campaign 1's session
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign2.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionToken1 },
      payload: {
        rating: 5,
        feedbackText: 'Cross-campaign submission test',
        consentGiven: true,
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe(ErrorCodes.INVALID_SESSION);
  });

  it('9. IDEMPOTENCY: should return explicit successful replay response when same clientSubmissionId and same payload are submitted again', async () => {
    const { campaign, serviceIds } = await setupCampaignWithServices();
    const sessionToken = await issueCustomerSession(campaign.code);

    const submissionId = 'sub_idemp_test_unique_12345678';
    const payload = {
      rating: 5,
      serviceIds: [serviceIds[0]],
      feedbackText: 'First-time exceptional experience',
      customerContact: 'guest@example.com',
      consentGiven: true,
      clientSubmissionId: submissionId,
    };

    // 1. Initial submission
    const res1 = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionToken },
      payload,
    });

    expect(res1.statusCode).toBe(201);
    const feedbackId = res1.json().feedbackId;
    expect(feedbackId).toBeDefined();

    // 2. Idempotent replay with same clientSubmissionId and same payload
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionToken },
      payload,
    });

    expect(res2.statusCode).toBe(200); // 200 OK idempotent replay
    expect(res2.json().success).toBe(true);
    expect(res2.json().feedbackId).toBe(feedbackId); // Returns same feedback ID
    expect(res2.json().message).toBe('Thank you for your feedback!');

    // 3. Verify zero duplicate feedback records created in DB
    const allFeedback = await db.select().from(privateFeedback);
    expect(allFeedback).toHaveLength(1);
    expect(allFeedback[0].id).toBe(feedbackId);
    expect(allFeedback[0].clientSubmissionId).toBe(submissionId);
    expect(allFeedback[0].payloadFingerprint).toBeDefined();
  });

  it('10. IDEMPOTENCY: should reject when same clientSubmissionId is submitted with a different payload', async () => {
    const { campaign } = await setupCampaignWithServices();
    const sessionToken = await issueCustomerSession(campaign.code);

    const submissionId = 'sub_mismatch_test_12345678';
    const initialPayload = {
      rating: 5,
      feedbackText: 'Initial original text',
      consentGiven: true,
      clientSubmissionId: submissionId,
    };

    // 1. Initial submission
    const res1 = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionToken },
      payload: initialPayload,
    });
    expect(res1.statusCode).toBe(201);

    // 2. Retry with same clientSubmissionId but altered rating
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionToken },
      payload: {
        ...initialPayload,
        rating: 1, // Altered
      },
    });

    expect(res2.statusCode).toBe(400);
    expect(res2.json().error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(res2.json().error.message).toContain('different feedback parameters');
  });

  it('11. IDEMPOTENCY: should return 409 ALREADY_SUBMITTED when a different clientSubmissionId is submitted on an already-submitted session', async () => {
    const { campaign } = await setupCampaignWithServices();
    const sessionToken = await issueCustomerSession(campaign.code);

    // Initial submission with submission ID 1
    const res1 = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionToken },
      payload: {
        rating: 4,
        consentGiven: true,
        clientSubmissionId: 'sub_attempt_one_12345678',
      },
    });
    expect(res1.statusCode).toBe(201);

    // Different submission ID on same submitted session
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionToken },
      payload: {
        rating: 4,
        consentGiven: true,
        clientSubmissionId: 'sub_attempt_two_87654321', // Different ID
      },
    });

    expect(res2.statusCode).toBe(409);
    expect(res2.json().error.code).toBe(ErrorCodes.ALREADY_SUBMITTED);
  });

  it('12. CONCURRENCY: should handle concurrent identical submissions on the same session without creating duplicate records', async () => {
    const { campaign, serviceIds } = await setupCampaignWithServices();
    const sessionToken = await issueCustomerSession(campaign.code);

    const submissionId = 'sub_concurrent_test_12345678';
    const payload = {
      rating: 5,
      serviceIds: [serviceIds[0]],
      feedbackText: 'Concurrent submission test',
      consentGiven: true,
      clientSubmissionId: submissionId,
    };

    // Dispatch 5 concurrent requests with identical payload and submissionId
    const responses = await Promise.all(
      [1, 2, 3, 4, 5].map(() =>
        app.inject({
          method: 'POST',
          url: `/api/v1/public/qr/${campaign.code}/feedback`,
          headers: { origin: 'http://localhost:5173' },
          cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionToken },
          payload,
        })
      )
    );

    // All must succeed (either 201 created or 200 idempotent replay)
    for (const res of responses) {
      expect([200, 201]).toContain(res.statusCode);
      expect(res.json().success).toBe(true);
    }

    // All returned feedback IDs must be identical
    const returnedIds = responses.map((r) => r.json().feedbackId);
    expect(new Set(returnedIds).size).toBe(1);

    // Exactly one record in the database
    const allDbFeedback = await db.select().from(privateFeedback);
    expect(allDbFeedback).toHaveLength(1);
  });

  it('13. CROSS-SESSION IDEMPOTENCY: should return 200 replay with original feedbackId when same clientSubmissionId is submitted from a new session', async () => {
    const { campaign, serviceIds } = await setupCampaignWithServices();
    const sessionTokenA = await issueCustomerSession(campaign.code);
    const sessionTokenB = await issueCustomerSession(campaign.code);

    const submissionId = 'sub_cross_session_12345678';
    const payload = {
      rating: 5,
      serviceIds: [serviceIds[0]],
      feedbackText: 'Great dinner experience across sessions!',
      customerContact: 'guest@example.com',
      consentGiven: true,
      clientSubmissionId: submissionId,
    };

    // 1. Initial submission under Session A
    const resA = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionTokenA },
      payload,
    });
    expect(resA.statusCode).toBe(201);
    const feedbackIdA = resA.json().feedbackId;

    // 2. Retry under Session B (e.g. Session A expired or response lost) with exact same submissionId and payload
    const resB = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionTokenB },
      payload,
    });
    expect(resB.statusCode).toBe(200); // 200 Idempotent Replay
    expect(resB.json().success).toBe(true);
    expect(resB.json().feedbackId).toBe(feedbackIdA);

    // Verify zero PII or internal timestamps leaked in replay
    expect(resB.json().feedbackText).toBeUndefined();
    expect(resB.json().customerContact).toBeUndefined();
    expect(resB.json().payloadFingerprint).toBeUndefined();

    // Verify exactly one feedback row in database
    const allDbFeedback = await db.select().from(privateFeedback);
    expect(allDbFeedback).toHaveLength(1);
  });

  it('14. CROSS-SESSION CONFLICT: should reject with 400 VALIDATION_ERROR when same clientSubmissionId is submitted with altered payload from a new session', async () => {
    const { campaign, serviceIds } = await setupCampaignWithServices();
    const sessionTokenA = await issueCustomerSession(campaign.code);
    const sessionTokenB = await issueCustomerSession(campaign.code);

    const submissionId = 'sub_cross_session_conflict_123';
    const initialPayload = {
      rating: 5,
      serviceIds: [serviceIds[0]],
      feedbackText: 'Superb food and service',
      consentGiven: true,
      clientSubmissionId: submissionId,
    };

    // 1. Initial submission under Session A
    const resA = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionTokenA },
      payload: initialPayload,
    });
    expect(resA.statusCode).toBe(201);

    // 2. Conflicting submission under Session B with altered rating
    const resB = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionTokenB },
      payload: {
        ...initialPayload,
        rating: 1, // Altered
      },
    });
    expect(resB.statusCode).toBe(400);
    expect(resB.json().error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(resB.json().error.message).toContain('different feedback parameters');

    // Exactly one row exists in database
    const allDbFeedback = await db.select().from(privateFeedback);
    expect(allDbFeedback).toHaveLength(1);
    expect(allDbFeedback[0].rating).toBe(5);
  });

  it('15. CAMPAIGN ISOLATION: should allow the same clientSubmissionId to be used in a different campaign without conflict', async () => {
    const setup1 = await setupCampaignWithServices();
    const setup2 = await setupCampaignWithServices();

    const sessionToken1 = await issueCustomerSession(setup1.campaign.code);
    const sessionToken2 = await issueCustomerSession(setup2.campaign.code);

    const submissionId = 'sub_shared_id_across_campaigns';

    // Submission in Campaign 1
    const res1 = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${setup1.campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionToken1 },
      payload: {
        rating: 5,
        consentGiven: true,
        clientSubmissionId: submissionId,
      },
    });
    expect(res1.statusCode).toBe(201);

    // Submission in Campaign 2 with the same clientSubmissionId
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${setup2.campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionToken2 },
      payload: {
        rating: 4,
        consentGiven: true,
        clientSubmissionId: submissionId,
      },
    });
    expect(res2.statusCode).toBe(201);

    // Both feedback records exist in database
    const allDbFeedback = await db.select().from(privateFeedback);
    expect(allDbFeedback).toHaveLength(2);
    expect(res1.json().feedbackId).not.toBe(res2.json().feedbackId);
  });

  it('16. CROSS-SESSION CONCURRENCY: should safely handle concurrent identical submissions across different sessions', async () => {
    const { campaign, serviceIds } = await setupCampaignWithServices();
    const sessionTokens = await Promise.all([
      issueCustomerSession(campaign.code),
      issueCustomerSession(campaign.code),
      issueCustomerSession(campaign.code),
      issueCustomerSession(campaign.code),
    ]);

    const submissionId = 'sub_concurrent_cross_session_999';
    const payload = {
      rating: 5,
      serviceIds: [serviceIds[0]],
      feedbackText: 'Concurrent cross-session race',
      consentGiven: true,
      clientSubmissionId: submissionId,
    };

    // Dispatch 4 concurrent requests across 4 distinct sessions
    const responses = await Promise.all(
      sessionTokens.map((token) =>
        app.inject({
          method: 'POST',
          url: `/api/v1/public/qr/${campaign.code}/feedback`,
          headers: { origin: 'http://localhost:5173' },
          cookies: { [CustomerSessionConstants.COOKIE_NAME]: token },
          payload,
        })
      )
    );

    // All must succeed (either 201 or 200 replay)
    for (const res of responses) {
      expect([200, 201]).toContain(res.statusCode);
      expect(res.json().success).toBe(true);
    }

    // All returned feedback IDs must be identical
    const returnedIds = responses.map((r) => r.json().feedbackId);
    expect(new Set(returnedIds).size).toBe(1);

    // Exactly one record in the database
    const allDbFeedback = await db.select().from(privateFeedback);
    expect(allDbFeedback).toHaveLength(1);
  });

  it('17. CROSS-SESSION CONCURRENCY: should reject concurrent submissions with same clientSubmissionId and different payloads', async () => {
    const { campaign } = await setupCampaignWithServices();
    const token1 = await issueCustomerSession(campaign.code);
    const token2 = await issueCustomerSession(campaign.code);

    const submissionId = 'sub_concurrent_tamper_race_888';

    // Dispatch concurrent requests with same ID but different ratings
    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/feedback`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: token1 },
        payload: { rating: 5, consentGiven: true, clientSubmissionId: submissionId },
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/feedback`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: token2 },
        payload: { rating: 1, consentGiven: true, clientSubmissionId: submissionId },
      }),
    ]);

    // One must succeed (201) and the other must be rejected (400)
    const statusCodes = [res1.statusCode, res2.statusCode].sort((a, b) => a - b);
    expect(statusCodes).toEqual([201, 400]);

    // Exactly one record in the database
    const allDbFeedback = await db.select().from(privateFeedback);
    expect(allDbFeedback).toHaveLength(1);
  });

  it('18. LEGACY SUBMISSIONS: should support multiple submissions without clientSubmissionId across sessions', async () => {
    const { campaign } = await setupCampaignWithServices();
    const token1 = await issueCustomerSession(campaign.code);
    const token2 = await issueCustomerSession(campaign.code);

    // Session 1 submits without clientSubmissionId
    const res1 = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: token1 },
      payload: { rating: 5, consentGiven: true },
    });
    expect(res1.statusCode).toBe(201);

    // Session 2 submits without clientSubmissionId (partial unique index must ignore NULLs)
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: token2 },
      payload: { rating: 4, consentGiven: true },
    });
    expect(res2.statusCode).toBe(201);

    // Submitting again on Session 1 still returns 409 ALREADY_SUBMITTED
    const res1Again = await app.inject({
      method: 'POST',
      url: `/api/v1/public/qr/${campaign.code}/feedback`,
      headers: { origin: 'http://localhost:5173' },
      cookies: { [CustomerSessionConstants.COOKIE_NAME]: token1 },
      payload: { rating: 5, consentGiven: true },
    });
    expect(res1Again.statusCode).toBe(409);

    // Total distinct rows in DB = 2
    const allDbFeedback = await db.select().from(privateFeedback);
    expect(allDbFeedback).toHaveLength(2);
  });
});
