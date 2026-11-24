import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import { createTestApp } from './setup.js';
import {
  ErrorCodes,
  AuthConstants,
  CustomerSessionConstants,
  DraftGenerationResponseSchema,
  DraftGenerationResponseDTO,
} from '@review-system/shared';
import {
  tenants,
  locations,
  qrCampaigns,
  ephemeralSessions,
  ephemeralSessionDrafts,
} from '../src/drizzle/schema.js';
import { resetEnv } from '../src/config/env.js';
import { AiOrchestrator } from '../src/ai/ai_orchestrator.js';
import { MockAiProvider } from '../src/ai/adapters/mock_provider.js';

describe('Public AI Draft Generation Integration Tests (POST /api/v1/public/qr/:code/generate-draft)', () => {
  let app: FastifyInstance;
  let db: any;
  let mockProvider: MockAiProvider;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env.ENABLE_AI_ASSISTANT = 'true';
    resetEnv();

    mockProvider = new MockAiProvider();
    const testSetup = await createTestApp({
      aiOrchestrator: new AiOrchestrator(mockProvider),
    });
    app = testSetup.app;
    db = testSetup.db;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnv();
  });

  async function setupActiveCampaign() {
    // 1. Register owner
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: `ai_owner_${Date.now()}_${Math.random().toString(36).substring(7)}@test.com`,
        password: 'Password123!',
        fullName: 'AI Test Owner',
        businessName: 'Artisan Bistro',
      },
    });
    const ownerCookie = regRes.cookies.find((c) => c.name === AuthConstants.COOKIE_NAME)!.value;
    const tenantId = regRes.json().activeTenant.id;

    // 2. Create location with Google URL
    const locRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: ownerCookie },
      payload: {
        name: 'Downtown Bistro',
        address: '123 Main St',
        googleReviewUrl: 'https://g.page/r/artisan_bistro/review',
        isPrimary: true,
      },
    });
    const locationId = locRes.json().id;

    // 3. Create service
    const srvRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/services`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: ownerCookie },
      payload: { name: 'Dinner Service' },
    });
    const serviceId = srvRes.json().id;

    // 4. Create campaign
    const campRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/campaigns`,
      headers: { origin: 'http://localhost' },
      cookies: { [AuthConstants.COOKIE_NAME]: ownerCookie },
      payload: { name: 'Table 10 QR' },
    });
    const campaign = campRes.json();

    return {
      tenantId,
      locationId,
      campaign,
      serviceId,
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

  // =========================================================================
  // 1. Authentication and Campaign Isolation
  // =========================================================================
  describe('1. Authentication and Campaign Isolation', () => {
    it('should reject request when customer_session cookie is missing', async () => {
      const { campaign } = await setupActiveCampaign();

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.INVALID_SESSION);
    });

    it('should reject request when customer_session token is invalid/unknown', async () => {
      const { campaign } = await setupActiveCampaign();

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: 'q_unknown_token_hash_value_123' },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.INVALID_SESSION);
    });

    it('should reject request when customer session has expired', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      // Expire the session in database
      await db
        .update(ephemeralSessions)
        .set({ expiresAt: new Date(Date.now() - 10_000) });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.INVALID_SESSION);
      expect(body.error.message).toContain('expired');
    });

    it('should reject request when session was issued for another QR code', async () => {
      const fixture1 = await setupActiveCampaign();
      const fixture2 = await setupActiveCampaign();

      // Issue session for campaign 1
      const sessionCookie1 = await issueCustomerSession(fixture1.campaign.code);

      // Attempt to use campaign 1 session against campaign 2 route
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${fixture2.campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie1 },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.INVALID_SESSION);
      expect(body.error.message).toContain('does not match');
    });

    it('should successfully authenticate and generate draft with a valid session', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(200);
      const body: DraftGenerationResponseDTO = res.json();
      expect(DraftGenerationResponseSchema.safeParse(body).success).toBe(true);
      expect(body.status).toBe('generated');
      expect(body.draft).toBeTruthy();
      expect(body.generationsRemaining).toBe(2);
      expect(body.isReplay).toBe(false);
    });

    it('should preserve in-flight session when campaign code is rotated in database', async () => {
      const { campaign } = await setupActiveCampaign();
      const originalCode = campaign.code;
      const sessionCookie = await issueCustomerSession(originalCode);

      // Rotate campaign code in DB
      const newCode = 'ROTATED123';
      await db
        .update(qrCampaigns)
        .set({ code: newCode })
        .where(eq(qrCampaigns.id, campaign.id));

      // Customer browser still calls the original issued code path
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${originalCode}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('generated');
    });

    it('should reject generation when tenant is suspended (403 TENANT_SUSPENDED)', async () => {
      const { campaign, tenantId } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      await db
        .update(tenants)
        .set({ status: 'suspended' })
        .where(eq(tenants.id, tenantId));

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.TENANT_SUSPENDED);
    });

    it('should reject generation when location is deactivated (400 CAMPAIGN_INACTIVE)', async () => {
      const { campaign, locationId } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      await db
        .update(locations)
        .set({ isActive: false, isPrimary: false })
        .where(eq(locations.id, locationId));

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.CAMPAIGN_INACTIVE);
    });

    it('should reject generation when campaign is inactive (400 CAMPAIGN_INACTIVE)', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      await db
        .update(qrCampaigns)
        .set({ status: 'inactive' })
        .where(eq(qrCampaigns.id, campaign.id));

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.CAMPAIGN_INACTIVE);
    });

    it('should reject generation when campaign is revoked (400 CAMPAIGN_INACTIVE)', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      await db
        .update(qrCampaigns)
        .set({ status: 'revoked' })
        .where(eq(qrCampaigns.id, campaign.id));

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.CAMPAIGN_INACTIVE);
    });

    it('should reject generation when location is missing Google Review URL (400 GOOGLE_REVIEW_URL_REQUIRED)', async () => {
      const { campaign, locationId } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      await db
        .update(locations)
        .set({ googleReviewUrl: null })
        .where(eq(locations.id, locationId));

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.GOOGLE_REVIEW_URL_REQUIRED);
    });
  });

  // =========================================================================
  // 2. CSRF Origin Validation
  // =========================================================================
  describe('2. CSRF Origin Validation', () => {
    it('should accept request with valid Origin header', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(200);
    });

    it('should reject request with unauthorized/malicious Origin header', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://malicious-site.com' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('should reject request when both Origin and Referer are missing', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('should accept request with valid Referer fallback when Origin is absent', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { referer: 'http://localhost:5173/q/' + campaign.code },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // =========================================================================
  // 3. Transport and Semantic Validation Boundary
  // =========================================================================
  describe('3. Transport and Semantic Validation Boundary', () => {
    it('should reject malformed JSON with 400', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json',
        },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: '{"clientDraftId": "not-valid-json',
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBeDefined();
      expect([ErrorCodes.VALIDATION_ERROR, 'FST_ERR_CTP_INVALID_JSON_BODY']).toContain(
        body.error.code
      );
    });

    it('should reject invalid UUID clientDraftId with 400 VALIDATION_ERROR', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: 'not-a-valid-uuid',
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('should reject empty feedback with 400 VALIDATION_ERROR', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: '   ',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('should reject feedback exceeding 2000 transport characters with 400 VALIDATION_ERROR', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'a'.repeat(2001),
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('should return 200 insufficient_context when feedback has fewer than 10 graphemes, consuming 0 quota and 0 lease', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'Good food', // 9 characters
        },
      });

      expect(res.statusCode).toBe(200);
      const body: DraftGenerationResponseDTO = res.json();
      expect(DraftGenerationResponseSchema.safeParse(body).success).toBe(true);
      expect(body.status).toBe('insufficient_context');
      expect(body.draft).toBeNull();
      expect(body.generationsRemaining).toBe(3); // Quota untouched
      expect(body.isReplay).toBe(false);

      // Verify DB session quota and lease state
      const [sessionInDb] = await db.select().from(ephemeralSessions);
      expect(sessionInDb.generationsRemaining).toBe(3);
      expect(sessionInDb.generationLockToken).toBeNull();
    });

    it('should return 200 generated when feedback is between 10 and 500 graphemes', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The staff was courteous, punctual, and did an extraordinary job on our dinner.',
        },
      });

      expect(res.statusCode).toBe(200);
      const body: DraftGenerationResponseDTO = res.json();
      expect(body.status).toBe('generated');
      expect(body.draft).toBeTruthy();
      expect(body.generationsRemaining).toBe(2);
      expect(body.isReplay).toBe(false);
    });

    it('should reject feedback exceeding 500 graphemes with 400 VALIDATION_ERROR', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'word '.repeat(101), // 505 chars
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('should reject invalid language codes with 400 VALIDATION_ERROR', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The staff was courteous, punctual, and did an extraordinary job on our dinner.',
          language: 'x', // Too short (< 2)
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });
  });

  // =========================================================================
  // 4. Generation, Idempotency, and Lifecycle
  // =========================================================================
  describe('4. Generation, Idempotency, and Lifecycle', () => {
    it('should idempotently return cached draft on exact payload replay', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);
      const clientDraftId = crypto.randomUUID();

      const payload = {
        clientDraftId,
        feedback: 'The sourdough bread and pastries were freshly baked and delicious.',
        rating: 5,
      };

      // 1st request: fresh generation
      const res1 = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload,
      });

      expect(res1.statusCode).toBe(200);
      const body1: DraftGenerationResponseDTO = res1.json();
      expect(body1.status).toBe('generated');
      expect(body1.generationsRemaining).toBe(2);
      expect(body1.isReplay).toBe(false);

      // 2nd request: identical replay
      const res2 = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload,
      });

      expect(res2.statusCode).toBe(200);
      const body2: DraftGenerationResponseDTO = res2.json();
      expect(DraftGenerationResponseSchema.safeParse(body2).success).toBe(true);
      expect(body2.status).toBe('generated');
      expect(body2.draft).toBe(body1.draft);
      expect(body2.generationsRemaining).toBe(2);
      expect(body2.isReplay).toBe(true);
    });

    it('should reject with 409 IDEMPOTENCY_KEY_REUSE_PAYLOAD_MISMATCH when same clientDraftId has different payload', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);
      const clientDraftId = crypto.randomUUID();

      // 1st request
      const res1 = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId,
          feedback: 'The sourdough bread and pastries were freshly baked and delicious.',
        },
      });
      expect(res1.statusCode).toBe(200);

      // 2nd request with same clientDraftId but changed feedback text
      const res2 = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId,
          feedback: 'Completely different feedback text about our dinner experience.',
        },
      });

      expect(res2.statusCode).toBe(409);
      const body2 = res2.json();
      expect(body2.error.code).toBe(ErrorCodes.IDEMPOTENCY_KEY_REUSE_PAYLOAD_MISMATCH);
    });

    it('should return live remaining quota on replay after subsequent generations', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      const clientDraftId1 = crypto.randomUUID();
      const payload1 = {
        clientDraftId: clientDraftId1,
        feedback: 'First draft feedback about the wonderful soup and salad.',
      };

      // Generation 1 (quota goes 3 -> 2)
      await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: payload1,
      });

      // Generation 2 with a different clientDraftId (quota goes 2 -> 1)
      const clientDraftId2 = crypto.randomUUID();
      await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: clientDraftId2,
          feedback: 'Second draft feedback about the delicious dessert and coffee.',
        },
      });

      // Now replay draft 1: it must reflect the live quota (1 remaining, not 2)
      const replayRes = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: payload1,
      });

      expect(replayRes.statusCode).toBe(200);
      const replayBody: DraftGenerationResponseDTO = replayRes.json();
      expect(replayBody.isReplay).toBe(true);
      expect(replayBody.generationsRemaining).toBe(1);
    });

    it('should reject with 409 CONCURRENT_GENERATION_IN_PROGRESS when active lease exists', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      // Set active generation lock on session in DB
      await db
        .update(ephemeralSessions)
        .set({
          generationLockToken: crypto.randomUUID(),
          generationLockUntil: new Date(Date.now() + 25_000),
        });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.CONCURRENT_GENERATION_IN_PROGRESS);
    });

    it('should enforce 3-generation lifetime quota and return 429 QUOTA_EXCEEDED on 4th generation', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      // 3 successful generations
      for (let i = 1; i <= 3; i++) {
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
          headers: { origin: 'http://localhost:5173' },
          cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
          payload: {
            clientDraftId: crypto.randomUUID(),
            feedback: `Distinct feedback submission number ${i} was very pleasant.`,
          },
        });
        expect(res.statusCode).toBe(200);
        const body: DraftGenerationResponseDTO = res.json();
        expect(body.generationsRemaining).toBe(3 - i);
      }

      // 4th generation must fail with 429 QUOTA_EXCEEDED
      const res4 = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'Attempting a fourth generation after quota exhaustion.',
        },
      });

      expect(res4.statusCode).toBe(429);
      const body4 = res4.json();
      expect(body4.error.code).toBe(ErrorCodes.QUOTA_EXCEEDED);
    });

    it('should return 503 FEATURE_DISABLED when ENABLE_AI_ASSISTANT is false', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      process.env.ENABLE_AI_ASSISTANT = 'false';
      resetEnv();

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.FEATURE_DISABLED);
    });

    it('should map provider timeout to 504 AI_PROVIDER_UNAVAILABLE', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      mockProvider.setMode('TIMEOUT');

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(504);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.AI_PROVIDER_UNAVAILABLE);
      expect(body.error.message).toContain('timed out');
    });

    it('should map provider 5xx to 502 AI_PROVIDER_UNAVAILABLE', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      mockProvider.setMode('PROVIDER_5XX');

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The food was absolutely wonderful and the service was impeccable.',
        },
      });

      expect(res.statusCode).toBe(502);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.AI_PROVIDER_UNAVAILABLE);
      expect(body.error.message).toContain('temporarily unavailable');
    });

    it('should map output guardrail rejection to 502 OUTPUT_GUARDRAIL_FAILED without leaking internal details', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      // Sentiment inversion causes output guardrail to reject the draft
      mockProvider.setMode('SENTIMENT_INVERTED');

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'Terrible terrible bad horrible service and spoiled food.',
        },
      });

      expect(res.statusCode).toBe(502);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.OUTPUT_GUARDRAIL_FAILED);
      expect(body.error.message).toContain('did not meet quality or safety standards');
      // Must not leak internal guardrail reason or model outputs
      expect(JSON.stringify(body)).not.toContain('SENTIMENT_INVERSION_DETECTED');
      expect(JSON.stringify(body)).not.toContain('PromptEngine');
    });
  });

  // =========================================================================
  // 5. Rate Limiting and Route Payload Ceiling
  // =========================================================================
  describe('5. Rate Limiting and Route Payload Ceiling', () => {
    it('should enforce configurable per-IP rate limiting and reject when exceeded', async () => {
      // Build server with a strict rate limit override of 2 requests/min
      const rateLimitedSetup = await createTestApp({
        rateLimitOverrides: { generateDraftMax: 2 },
        aiOrchestrator: new AiOrchestrator(new MockAiProvider()),
      });
      const rlApp = rateLimitedSetup.app;

      // Register owner & campaign on this app instance
      const regRes = await rlApp.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: `rl_owner_${Date.now()}@test.com`,
          password: 'Password123!',
          fullName: 'Rate Limit Owner',
          businessName: 'Rate Limit Bistro',
        },
      });
      const ownerCookie = regRes.cookies.find((c) => c.name === AuthConstants.COOKIE_NAME)!.value;
      const tenantId = regRes.json().activeTenant.id;

      const locRes = await rlApp.inject({
        method: 'POST',
        url: `/api/v1/owner/tenants/${tenantId}/locations`,
        headers: { origin: 'http://localhost' },
        cookies: { [AuthConstants.COOKIE_NAME]: ownerCookie },
        payload: {
          name: 'RL Location',
          address: '100 Main St',
          googleReviewUrl: 'https://g.page/r/test/review',
          isPrimary: true,
        },
      });
      const locationId = locRes.json().id;

      const campRes = await rlApp.inject({
        method: 'POST',
        url: `/api/v1/owner/tenants/${tenantId}/locations/${locationId}/campaigns`,
        headers: { origin: 'http://localhost' },
        cookies: { [AuthConstants.COOKIE_NAME]: ownerCookie },
        payload: { name: 'RL Campaign' },
      });
      const campaign = campRes.json();

      const sessionRes = await rlApp.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/sessions`,
        headers: { origin: 'http://localhost:5173' },
      });
      const sessionCookie = sessionRes.cookies.find(
        (c) => c.name === CustomerSessionConstants.COOKIE_NAME
      )!.value;

      // 1st request -> OK
      const r1 = await rlApp.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'First review request within threshold.',
        },
      });
      expect(r1.statusCode).toBe(200);

      // 2nd request -> OK
      const r2 = await rlApp.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'Second review request within threshold.',
        },
      });
      expect(r2.statusCode).toBe(200);

      // 3rd request from same IP -> 429 RATE_LIMITED
      const r3 = await rlApp.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'Third review request exceeding rate limit threshold.',
        },
      });
      expect(r3.statusCode).toBe(429);
      const body3 = r3.json();
      expect(body3.error.code).toBe(ErrorCodes.RATE_LIMITED);
    });

    it('should reject request bodies exceeding 16 KB bodyLimit with 413', async () => {
      const { campaign } = await setupActiveCampaign();
      const sessionCookie = await issueCustomerSession(campaign.code);

      // Construct a payload > 16 KB (16384 bytes)
      const oversizedPayload = {
        clientDraftId: crypto.randomUUID(),
        feedback: 'Valid feedback text here.',
        extraData: 'x'.repeat(17000),
      };

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: { origin: 'http://localhost:5173' },
        cookies: { [CustomerSessionConstants.COOKIE_NAME]: sessionCookie },
        payload: oversizedPayload,
      });

      expect(res.statusCode).toBe(413);
    });
  });
});
