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
});
