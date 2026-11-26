import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FastifyInstance } from 'fastify';
import { createTestApp } from './setup.js';
import {
  tenants,
  locations,
  qrCampaigns,
  ephemeralSessions,
} from '../src/drizzle/schema.js';
import {
  CustomerSessionConstants,
  ErrorCodes,
} from '@review-system/shared';
import { generateSessionToken, hashSessionToken } from '../src/utils/crypto.js';
import { generateCampaignCode } from '../src/utils/qr.js';
import { resetEnv } from '../src/config/env.js';
import { AiOrchestrator } from '../src/ai/ai_orchestrator.js';
import { MockAiProvider } from '../src/ai/adapters/mock_provider.js';
import { safeCompareSecret, isExemptHealthRoute } from '../src/server.js';
import { BoundedSessionRateLimiter } from '../src/routes/public.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Proxy Identity Assertion & Rate-Limit Remediation Tests (Phase 8.4.5.2 & Phase 8.4.5.4)', () => {
  let app: FastifyInstance;
  let db: any;
  const originalEnv = { ...process.env };
  const TEST_PROXY_SECRET = 'internal-proxy-secret-for-testing-at-least-32-chars-long!';

  beforeEach(async () => {
    process.env.INTERNAL_PROXY_SECRET = TEST_PROXY_SECRET;
    process.env.ENABLE_AI_ASSISTANT = 'true';
    resetEnv();

    const mockAiProvider = new MockAiProvider();
    const testSetup = await createTestApp({
      rateLimitOverrides: {
        qrGetMax: 2,
        sessionsPostMax: 2,
        feedbackPostMax: 10,
        sessionFeedbackMax: 2,
        generateDraftMax: 10,
        sessionDraftMax: 2,
      },
      aiOrchestrator: new AiOrchestrator(mockAiProvider),
    });
    app = testSetup.app;
    db = testSetup.db;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnv();
  });

  async function seedTestCampaign() {
    const [t] = await db
      .insert(tenants)
      .values({
        displayName: 'Proxy Bistro',
        slug: `proxy-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      })
      .returning();

    const [l] = await db
      .insert(locations)
      .values({
        tenantId: t.id,
        name: 'Downtown Proxy Location',
        googleReviewUrl: 'https://g.page/r/proxytest/review',
        isPrimary: true,
      })
      .returning();

    const [c] = await db
      .insert(qrCampaigns)
      .values({
        tenantId: t.id,
        locationId: l.id,
        name: 'Proxy Campaign',
        code: generateCampaignCode(),
        status: 'active',
      })
      .returning();

    return { tenant: t, location: l, campaign: c };
  }

  async function createSession(code: string, clientIp: string) {
    const rawToken = generateSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + CustomerSessionConstants.SESSION_TTL_MS);

    const { campaign } = await db.query.qrCampaigns.findFirst({
      where: (qr: any, { eq }: any) => eq(qr.code, code),
    }).then((c: any) => ({ campaign: c }));

    await db.insert(ephemeralSessions).values({
      tenantId: campaign.tenantId,
      locationId: campaign.locationId,
      campaignId: campaign.id,
      tokenHash,
      issuedCode: code,
      expiresAt,
    });

    return { rawToken, tokenHash };
  }

  // =========================================================================
  // 1. Proxy Assertion & Client IP Verification (7 Tests)
  // =========================================================================
  describe('1. Proxy Assertion & Client IP Verification', () => {
    it('1.1 should establish request.clientIp when valid secret and valid client IP are provided', async () => {
      const { campaign } = await seedTestCampaign();
      const clientIp = '203.0.113.88';

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/public/qr/${campaign.code}`,
        headers: {
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': clientIp,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().location.name).toBe('Downtown Proxy Location');
    });

    it('1.2 should return 403 Forbidden when proxy secret is missing in production on /api/*', async () => {
      const { campaign } = await seedTestCampaign();

      // Temporarily switch to production mode
      process.env.NODE_ENV = 'production';
      process.env.INTERNAL_PROXY_SECRET = 'a'.repeat(32);
      process.env.SESSION_SECRET = 'b'.repeat(32);
      process.env.DATABASE_URL = 'postgresql://user:pass@ep-cool-fog-123456-pooler.us-east-2.aws.neon.tech/neondb';
      process.env.MIGRATION_DATABASE_URL = 'postgresql://user:pass@ep-cool-fog-123456.us-east-2.aws.neon.tech/neondb';
      resetEnv();

      // Request without x-proxy-secret
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/public/qr/${campaign.code}`,
        headers: {
          'x-forwarded-client-ip': '203.0.113.10',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(body.error.message).toContain('Direct API access without proxy identity is forbidden');
    });

    it('1.3 should return 403 Forbidden when proxy secret is invalid', async () => {
      const { campaign } = await seedTestCampaign();

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/public/qr/${campaign.code}`,
        headers: {
          'x-proxy-secret': 'invalid-attacker-provided-proxy-secret-12345',
          'x-forwarded-client-ip': '203.0.113.10',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(body.error.message).toBe('Invalid proxy identity assertion');
    });

    it('1.4 should return 400 Bad Request when forwarded client IP is malformed', async () => {
      const { campaign } = await seedTestCampaign();

      const invalidIps = [
        '999.999.999.999',
        'invalid-host.com',
        '127.0.0.1\r\nHost: evil.com',
        '2001:::1',
        '01.02.03.04',
      ];

      for (const badIp of invalidIps) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/public/qr/${campaign.code}`,
          headers: {
            'x-proxy-secret': TEST_PROXY_SECRET,
            'x-forwarded-client-ip': badIp,
          },
        });

        expect(res.statusCode).toBe(400);
        const body = res.json();
        expect(body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(body.error.message).toContain('client IP');
      }
    });

    it('1.5 should prevent direct requests without secret from spoofing request.clientIp', async () => {
      const { campaign } = await seedTestCampaign();

      // In non-production without secret, an untrusted x-forwarded-client-ip must be ignored,
      // and Fastify must fall back strictly to request.ip (socket remoteAddress: 127.0.0.1 in tests).
      // Proof: exhaust the 127.0.0.1 bucket (qrGetMax = 2) with 2 requests.
      const res1 = await app.inject({
        method: 'GET',
        url: `/api/v1/public/qr/${campaign.code}`,
      });
      expect(res1.statusCode).toBe(200);

      const res2 = await app.inject({
        method: 'GET',
        url: `/api/v1/public/qr/${campaign.code}`,
      });
      expect(res2.statusCode).toBe(200);

      // Now send a 3rd request with spoofed x-forwarded-client-ip: 1.2.3.4 without proxy secret.
      // If 1.2.3.4 was honored, it would have 0 requests and return 200.
      // Because it is safely ignored and falls back to 127.0.0.1 (already exhausted), it MUST return 429!
      const res3 = await app.inject({
        method: 'GET',
        url: `/api/v1/public/qr/${campaign.code}`,
        headers: {
          'x-forwarded-client-ip': '1.2.3.4', // Untrusted spoof attempt
        },
      });

      expect(res3.statusCode).toBe(429);
      expect(res3.json().error.code).toBe(ErrorCodes.RATE_LIMITED);
    });

    it('1.6 should allow direct requests to health endpoints (/health, /ready) without proxy secret even in production', async () => {
      // Temporarily switch to production mode
      process.env.NODE_ENV = 'production';
      process.env.INTERNAL_PROXY_SECRET = 'a'.repeat(32);
      process.env.SESSION_SECRET = 'b'.repeat(32);
      process.env.DATABASE_URL = 'postgresql://user:pass@ep-cool-fog-123456-pooler.us-east-2.aws.neon.tech/neondb';
      process.env.MIGRATION_DATABASE_URL = 'postgresql://user:pass@ep-cool-fog-123456.us-east-2.aws.neon.tech/neondb';
      resetEnv();

      const healthRes = await app.inject({
        method: 'GET',
        url: '/health',
      });
      expect(healthRes.statusCode).toBe(200);
      expect(healthRes.json().status).toBe('ok');

      const readyRes = await app.inject({
        method: 'GET',
        url: '/ready',
      });
      expect(readyRes.statusCode).toBe(200);
      expect(readyRes.json().status).toBe('ready');
    });

    it('1.7 should ensure health check bypass does not weaken /api/* protection', async () => {
      // In production mode, health check passes without secret, but API route is blocked without secret
      process.env.NODE_ENV = 'production';
      process.env.INTERNAL_PROXY_SECRET = 'a'.repeat(32);
      process.env.SESSION_SECRET = 'b'.repeat(32);
      process.env.DATABASE_URL = 'postgresql://user:pass@ep-cool-fog-123456-pooler.us-east-2.aws.neon.tech/neondb';
      process.env.MIGRATION_DATABASE_URL = 'postgresql://user:pass@ep-cool-fog-123456.us-east-2.aws.neon.tech/neondb';
      resetEnv();

      // 1. Health check succeeds
      const healthRes = await app.inject({
        method: 'GET',
        url: '/health',
      });
      expect(healthRes.statusCode).toBe(200);

      // 2. Direct API call on same server without proxy secret fails with 403
      const apiRes = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
      });
      expect(apiRes.statusCode).toBe(403);
      expect(apiRes.json().error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('1.8 should reject encoded URI paths (e.g. /%61%70%69/...) in production without proxy secret', async () => {
      const { campaign } = await seedTestCampaign();

      process.env.NODE_ENV = 'production';
      process.env.INTERNAL_PROXY_SECRET = 'a'.repeat(32);
      process.env.SESSION_SECRET = 'b'.repeat(32);
      process.env.DATABASE_URL = 'postgresql://user:pass@ep-cool-fog-123456-pooler.us-east-2.aws.neon.tech/neondb';
      process.env.MIGRATION_DATABASE_URL = 'postgresql://user:pass@ep-cool-fog-123456.us-east-2.aws.neon.tech/neondb';
      resetEnv();

      // Attacker attempts to bypass prefix check by percent-encoding '/api/' as '/%61%70%69/'
      const res = await app.inject({
        method: 'GET',
        url: `/%61%70%69/v1/public/qr/${campaign.code}`,
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(res.json().error.message).toContain('Direct API access without proxy identity is forbidden');
    });

    it('1.9 should reject traversal and alternate path encodings in production without proxy secret', async () => {
      const { campaign } = await seedTestCampaign();

      process.env.NODE_ENV = 'production';
      process.env.INTERNAL_PROXY_SECRET = 'a'.repeat(32);
      process.env.SESSION_SECRET = 'b'.repeat(32);
      process.env.DATABASE_URL = 'postgresql://user:pass@ep-cool-fog-123456-pooler.us-east-2.aws.neon.tech/neondb';
      process.env.MIGRATION_DATABASE_URL = 'postgresql://user:pass@ep-cool-fog-123456.us-east-2.aws.neon.tech/neondb';
      resetEnv();

      const bypassAttempts = [
        `/%2fapi/v1/public/qr/${campaign.code}`,
        `/api%2fv1/public/qr/${campaign.code}`,
        `/health/../api/v1/public/qr/${campaign.code}`,
        `//api/v1/public/qr/${campaign.code}`,
      ];

      for (const attemptUrl of bypassAttempts) {
        const res = await app.inject({
          method: 'GET',
          url: attemptUrl,
        });

        // Fail closed: must be rejected with 403 (or 404 if router rejects bad path before onRequest, but never 200)
        expect([403, 404]).toContain(res.statusCode);
        if (res.statusCode === 403) {
          expect(res.json().error.code).toBe(ErrorCodes.FORBIDDEN);
        }
      }
    });

    it('1.10 should reject non-exact health paths in production without proxy secret', async () => {
      process.env.NODE_ENV = 'production';
      process.env.INTERNAL_PROXY_SECRET = 'a'.repeat(32);
      process.env.SESSION_SECRET = 'b'.repeat(32);
      process.env.DATABASE_URL = 'postgresql://user:pass@ep-cool-fog-123456-pooler.us-east-2.aws.neon.tech/neondb';
      process.env.MIGRATION_DATABASE_URL = 'postgresql://user:pass@ep-cool-fog-123456.us-east-2.aws.neon.tech/neondb';
      resetEnv();

      const nonExemptHealthRequests = [
        { method: 'POST', url: '/health' },
        { method: 'GET', url: '/%68ealth' },
        { method: 'GET', url: '/health/' },
        { method: 'GET', url: '//health' },
        { method: 'GET', url: '/health/extra' },
        { method: 'POST', url: '/ready' },
        { method: 'GET', url: '/ready/' },
      ];

      for (const req of nonExemptHealthRequests) {
        const res = await app.inject({
          method: req.method as any,
          url: req.url,
        });

        expect(res.statusCode).toBe(403);
        expect(res.json().error.code).toBe(ErrorCodes.FORBIDDEN);
      }
    });

    it('1.11 safeCompareSecret should compare SHA-256 digests in constant time and reject invalid values', () => {
      const secret = 'super-secret-production-proxy-key-12345';
      expect(safeCompareSecret(secret, secret)).toBe(true);
      expect(safeCompareSecret('wrong-secret', secret)).toBe(false);
      expect(safeCompareSecret(secret + 'extra', secret)).toBe(false);
      expect(safeCompareSecret('short', secret)).toBe(false);
      expect(safeCompareSecret(undefined, secret)).toBe(false);
      expect(safeCompareSecret(secret, undefined)).toBe(false);
      expect(safeCompareSecret(['secret-array'] as any, secret)).toBe(false);
      expect(safeCompareSecret('', secret)).toBe(false);
    });

    it('1.12 isExemptHealthRoute should only match exact GET/HEAD /health and /ready', () => {
      expect(isExemptHealthRoute('GET', '/health')).toBe(true);
      expect(isExemptHealthRoute('HEAD', '/health')).toBe(true);
      expect(isExemptHealthRoute('GET', '/ready')).toBe(true);
      expect(isExemptHealthRoute('HEAD', '/ready')).toBe(true);
      expect(isExemptHealthRoute('GET', '/health?query=1')).toBe(true);

      // Rejections
      expect(isExemptHealthRoute('POST', '/health')).toBe(false);
      expect(isExemptHealthRoute('PUT', '/health')).toBe(false);
      expect(isExemptHealthRoute('GET', '/health/')).toBe(false);
      expect(isExemptHealthRoute('GET', '//health')).toBe(false);
      expect(isExemptHealthRoute('GET', '/%68ealth')).toBe(false);
      expect(isExemptHealthRoute('GET', '/health/../api')).toBe(false);
      expect(isExemptHealthRoute('GET', '/api/v1/auth')).toBe(false);
    });
  });

  // =========================================================================
  // 2. Rate Limiting Integrity Tests (6 Tests)
  // =========================================================================
  describe('2. Rate Limiting Integrity Tests', () => {
    it('2.1 Two distinct client IPs receive independent limits on GET /qr/:code', async () => {
      const { campaign } = await seedTestCampaign();
      const ip1 = '198.51.100.1';
      const ip2 = '198.51.100.2';

      // IP 1: requests 1 & 2 succeed (limit = 2)
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/public/qr/${campaign.code}`,
          headers: {
            'x-proxy-secret': TEST_PROXY_SECRET,
            'x-forwarded-client-ip': ip1,
          },
        });
        expect(res.statusCode).toBe(200);
      }

      // IP 1: 3rd request hits limit (429)
      const ip1Limited = await app.inject({
        method: 'GET',
        url: `/api/v1/public/qr/${campaign.code}`,
        headers: {
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': ip1,
        },
      });
      expect(ip1Limited.statusCode).toBe(429);
      expect(ip1Limited.json().error.code).toBe(ErrorCodes.RATE_LIMITED);

      // IP 2: 1st request must still succeed independently (200)
      const ip2Res = await app.inject({
        method: 'GET',
        url: `/api/v1/public/qr/${campaign.code}`,
        headers: {
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': ip2,
        },
      });
      expect(ip2Res.statusCode).toBe(200);
    });

    it('2.2 Two distinct client IPs receive independent limits on POST /qr/:code/sessions', async () => {
      const { campaign } = await seedTestCampaign();
      const ip1 = '198.51.100.10';
      const ip2 = '198.51.100.20';

      // IP 1 creates 2 sessions (limit = 2)
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/public/qr/${campaign.code}/sessions`,
          headers: {
            origin: 'http://localhost:5173',
            'x-proxy-secret': TEST_PROXY_SECRET,
            'x-forwarded-client-ip': ip1,
          },
        });
        expect(res.statusCode).toBe(201);
      }

      // IP 1: 3rd attempt is 429
      const ip1Limited = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/sessions`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': ip1,
        },
      });
      expect(ip1Limited.statusCode).toBe(429);
      expect(ip1Limited.json().error.code).toBe(ErrorCodes.RATE_LIMITED);

      // IP 2: can create session without being affected by IP 1
      const ip2Res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/sessions`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': ip2,
        },
      });
      expect(ip2Res.statusCode).toBe(201);
    });

    it('2.3 Two sessions from the same IP receive independent limits on POST /qr/:code/feedback', async () => {
      const { campaign } = await seedTestCampaign();
      const sharedIp = '203.0.113.50';

      // Issue two distinct sessions from the same IP
      const session1 = await createSession(campaign.code, sharedIp);
      const session2 = await createSession(campaign.code, sharedIp);

      // Session 1: attempt 1 succeeds (201 Created)
      const res1 = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/feedback`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': sharedIp,
        },
        cookies: {
          [CustomerSessionConstants.COOKIE_NAME]: session1.rawToken,
        },
        payload: {
          rating: 3,
          feedback: 'Feedback from session 1 attempt 1',
          clientFeedbackId: crypto.randomUUID(),
          consentGiven: true,
        },
      });
      expect(res1.statusCode).toBe(201);

      // Session 1: attempt 2 returns 409 (single feedback per session), but counts against rate limit (limit = 2)
      const res2 = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/feedback`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': sharedIp,
        },
        cookies: {
          [CustomerSessionConstants.COOKIE_NAME]: session1.rawToken,
        },
        payload: {
          rating: 3,
          feedback: 'Feedback from session 1 attempt 2',
          clientFeedbackId: crypto.randomUUID(),
          consentGiven: true,
        },
      });
      expect(res2.statusCode).toBe(409);

      // Session 1: 3rd attempt hits 429
      const session1Limited = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/feedback`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': sharedIp,
        },
        cookies: {
          [CustomerSessionConstants.COOKIE_NAME]: session1.rawToken,
        },
        payload: {
          rating: 3,
          feedback: 'Feedback from session 1 attempt 3',
          clientFeedbackId: crypto.randomUUID(),
          consentGiven: true,
        },
      });
      expect(session1Limited.statusCode).toBe(429);
      expect(session1Limited.json().error.code).toBe(ErrorCodes.RATE_LIMITED);

      // Session 2 from the same IP: must succeed independently (201)
      const session2Res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/feedback`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': sharedIp,
        },
        cookies: {
          [CustomerSessionConstants.COOKIE_NAME]: session2.rawToken,
        },
        payload: {
          rating: 4,
          feedback: 'Feedback from session 2 attempt 1',
          clientFeedbackId: crypto.randomUUID(),
          consentGiven: true,
        },
      });
      expect(session2Res.statusCode).toBe(201);
    });

    it('2.4 Two sessions from the same IP receive independent limits on POST /qr/:code/generate-draft', async () => {
      const { campaign } = await seedTestCampaign();
      const sharedIp = '203.0.113.60';

      // Issue two distinct sessions from the same IP
      const session1 = await createSession(campaign.code, sharedIp);
      const session2 = await createSession(campaign.code, sharedIp);

      // Session 1: calls generate-draft twice (limit = 2)
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
          headers: {
            origin: 'http://localhost:5173',
            'x-proxy-secret': TEST_PROXY_SECRET,
            'x-forwarded-client-ip': sharedIp,
          },
          cookies: {
            [CustomerSessionConstants.COOKIE_NAME]: session1.rawToken,
          },
          payload: {
            clientDraftId: crypto.randomUUID(),
            feedback: 'The dining experience was outstanding and the staff was extremely attentive.',
          },
        });
        expect(res.statusCode).toBe(200);
      }

      // Session 1: 3rd attempt is 429
      const session1Limited = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': sharedIp,
        },
        cookies: {
          [CustomerSessionConstants.COOKIE_NAME]: session1.rawToken,
        },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'Another attempt from session 1.',
        },
      });
      expect(session1Limited.statusCode).toBe(429);
      expect(session1Limited.json().error.code).toBe(ErrorCodes.RATE_LIMITED);

      // Session 2 from the same IP: must succeed independently (200)
      const session2Res = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': sharedIp,
        },
        cookies: {
          [CustomerSessionConstants.COOKIE_NAME]: session2.rawToken,
        },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'The dessert was exquisite and presentation was wonderful.',
        },
      });
      expect(session2Res.statusCode).toBe(200);
    });

    it('2.5 Repeated requests from one session exhaust only that session limit (yields 429)', async () => {
      const { campaign } = await seedTestCampaign();
      const ip = '203.0.113.70';
      const session = await createSession(campaign.code, ip);

      // 2 allowed requests
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
          headers: {
            origin: 'http://localhost:5173',
            'x-proxy-secret': TEST_PROXY_SECRET,
            'x-forwarded-client-ip': ip,
          },
          cookies: {
            [CustomerSessionConstants.COOKIE_NAME]: session.rawToken,
          },
          payload: {
            clientDraftId: crypto.randomUUID(),
            feedback: `Draft test attempt ${i + 1}`,
          },
        });
        expect(res.statusCode).toBe(200);
      }

      // Exhausted -> 429
      const limitedRes = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': ip,
        },
        cookies: {
          [CustomerSessionConstants.COOKIE_NAME]: session.rawToken,
        },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'Draft test attempt 3',
        },
      });
      expect(limitedRes.statusCode).toBe(429);
      expect(limitedRes.json().error.code).toBe(ErrorCodes.RATE_LIMITED);
      expect(limitedRes.headers['retry-after']).toBeDefined();
    });

    it('2.6 Missing or invalid sessions cannot bypass protection (yields 400 or 401 and does not execute handler)', async () => {
      const { campaign } = await seedTestCampaign();
      const ip = '203.0.113.80';

      // 1. Missing cookie -> 401 INVALID_SESSION
      const missingCookieRes = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': ip,
        },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'Test feedback with missing cookie',
        },
      });
      expect(missingCookieRes.statusCode).toBe(401);
      expect(missingCookieRes.json().error.code).toBe(ErrorCodes.INVALID_SESSION);

      // 2. Invalid cookie token -> 401 INVALID_SESSION
      const invalidTokenRes = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': ip,
        },
        cookies: {
          [CustomerSessionConstants.COOKIE_NAME]: 'invalid-unrecognized-session-token',
        },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'Test feedback with invalid token',
        },
      });
      expect(invalidTokenRes.statusCode).toBe(401);
      expect(invalidTokenRes.json().error.code).toBe(ErrorCodes.INVALID_SESSION);

      // 3. Invalid feedback payload with missing fields -> 400 VALIDATION_ERROR
      const session = await createSession(campaign.code, ip);
      const invalidPayloadRes = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/feedback`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': ip,
        },
        cookies: {
          [CustomerSessionConstants.COOKIE_NAME]: session.rawToken,
        },
        payload: {
          // missing rating and feedback
        },
      });
      expect(invalidPayloadRes.statusCode).toBe(400);
      expect(invalidPayloadRes.json().error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    });

    it('2.7 [Adversarial Scenario 1] One IP rotating multiple customer sessions is stopped by aggregate IP limit on feedback', async () => {
      const { campaign } = await seedTestCampaign();
      const ip = '198.51.100.99';

      // feedbackPostMax is configured as 10 in our test suite.
      // An attacker creates 10 distinct sessions from the SAME IP and submits feedback with each.
      for (let i = 0; i < 10; i++) {
        const session = await createSession(campaign.code, ip);
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/public/qr/${campaign.code}/feedback`,
          headers: {
            origin: 'http://localhost:5173',
            'x-proxy-secret': TEST_PROXY_SECRET,
            'x-forwarded-client-ip': ip,
          },
          cookies: {
            [CustomerSessionConstants.COOKIE_NAME]: session.rawToken,
          },
          payload: {
            rating: 5,
            feedback: `Session rotation feedback test ${i + 1}`,
            clientFeedbackId: crypto.randomUUID(),
            consentGiven: true,
          },
        });
        expect(res.statusCode).toBe(201);
      }

      // 11th session from the same IP MUST be rejected by the aggregate IP rate limiter (Layer 1)
      const session11 = await createSession(campaign.code, ip);
      const res11 = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/feedback`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': ip,
        },
        cookies: {
          [CustomerSessionConstants.COOKIE_NAME]: session11.rawToken,
        },
        payload: {
          rating: 5,
          feedback: 'Session rotation feedback test 11 should be blocked',
          clientFeedbackId: crypto.randomUUID(),
          consentGiven: true,
        },
      });

      expect(res11.statusCode).toBe(429);
      expect(res11.json().error.code).toBe(ErrorCodes.RATE_LIMITED);
    });

    it('2.8 [Adversarial Scenario 2] One IP rotating multiple customer sessions is stopped by aggregate IP limit on generate-draft', async () => {
      const { campaign } = await seedTestCampaign();
      const ip = '198.51.100.88';

      // generateDraftMax is configured as 10.
      // An attacker creates 10 distinct sessions and requests AI drafts from the SAME IP.
      for (let i = 0; i < 10; i++) {
        const session = await createSession(campaign.code, ip);
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
          headers: {
            origin: 'http://localhost:5173',
            'x-proxy-secret': TEST_PROXY_SECRET,
            'x-forwarded-client-ip': ip,
          },
          cookies: {
            [CustomerSessionConstants.COOKIE_NAME]: session.rawToken,
          },
          payload: {
            clientDraftId: crypto.randomUUID(),
            feedback: `Excellent experience session rotation test ${i + 1}`,
          },
        });
        expect(res.statusCode).toBe(200);
      }

      // 11th session from the same IP MUST receive 429 from Layer 1 IP limiter
      const session11 = await createSession(campaign.code, ip);
      const res11 = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': ip,
        },
        cookies: {
          [CustomerSessionConstants.COOKIE_NAME]: session11.rawToken,
        },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: '11th attempt should be stopped by IP limiter',
        },
      });

      expect(res11.statusCode).toBe(429);
      expect(res11.json().error.code).toBe(ErrorCodes.RATE_LIMITED);
    });

    it('2.9 [Adversarial Scenario 3] One customer session rotating between multiple IPs is stopped by Layer 2 session limit', async () => {
      const { campaign } = await seedTestCampaign();
      const session = await createSession(campaign.code, '203.0.113.1');

      // sessionDraftMax is 2. The session sends 1 request from IP 1, 1 request from IP 2.
      const res1 = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': '203.0.113.1',
        },
        cookies: {
          [CustomerSessionConstants.COOKIE_NAME]: session.rawToken,
        },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'Great service and food from IP 1',
        },
      });
      expect(res1.statusCode).toBe(200);

      const res2 = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': '203.0.113.2', // Rotated IP!
        },
        cookies: {
          [CustomerSessionConstants.COOKIE_NAME]: session.rawToken,
        },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'Great service and food from IP 2',
        },
      });
      expect(res2.statusCode).toBe(200);

      // 3rd request from yet another IP (IP 3): IP 3 has never been seen, but session quota is 2!
      const res3 = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/generate-draft`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': '203.0.113.3', // 3rd IP!
        },
        cookies: {
          [CustomerSessionConstants.COOKIE_NAME]: session.rawToken,
        },
        payload: {
          clientDraftId: crypto.randomUUID(),
          feedback: 'Attempt from IP 3 should hit Layer 2 session rate limit',
        },
      });

      expect(res3.statusCode).toBe(429);
      expect(res3.json().error.code).toBe(ErrorCodes.RATE_LIMITED);
      expect(res3.headers['retry-after']).toBeDefined();
    });

    it('2.10 [Adversarial Scenario 4] One IP rotating multiple campaign codes is capped by aggregate IP limit on QR resolution', async () => {
      // Seed two campaigns
      const c1 = await seedTestCampaign();
      const c2 = await seedTestCampaign();
      const ip = '198.51.100.77';

      // qrGetMax is 2. Attacker queries campaign 1, then campaign 2.
      const res1 = await app.inject({
        method: 'GET',
        url: `/api/v1/public/qr/${c1.campaign.code}`,
        headers: {
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': ip,
        },
      });
      expect(res1.statusCode).toBe(200);

      const res2 = await app.inject({
        method: 'GET',
        url: `/api/v1/public/qr/${c2.campaign.code}`,
        headers: {
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': ip,
        },
      });
      expect(res2.statusCode).toBe(200);

      // 3rd request to c1 (or any code) from the same IP hits aggregate IP rate limit
      const res3 = await app.inject({
        method: 'GET',
        url: `/api/v1/public/qr/${c1.campaign.code}`,
        headers: {
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': ip,
        },
      });
      expect(res3.statusCode).toBe(429);
      expect(res3.json().error.code).toBe(ErrorCodes.RATE_LIMITED);
    });

    it('2.11 [Adversarial Scenario 5] Random invalid session tokens sent from one IP are throttled by Layer 1 IP limit', async () => {
      const { campaign } = await seedTestCampaign();
      const ip = '198.51.100.66';

      // feedbackPostMax is 10. Attacker sends 10 requests with random bogus cookies.
      for (let i = 0; i < 10; i++) {
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/public/qr/${campaign.code}/feedback`,
          headers: {
            origin: 'http://localhost:5173',
            'x-proxy-secret': TEST_PROXY_SECRET,
            'x-forwarded-client-ip': ip,
          },
          cookies: {
            [CustomerSessionConstants.COOKIE_NAME]: `bogus-token-${i}-${crypto.randomUUID()}`,
          },
          payload: {
            rating: 4,
            feedback: 'Testing invalid tokens',
            clientFeedbackId: crypto.randomUUID(),
            consentGiven: true,
          },
        });
        // Returns 401 Invalid Session, but still counts against Layer 1 IP rate limit!
        expect(res.statusCode).toBe(401);
      }

      // 11th request is throttled by Layer 1 IP rate limit (429)
      const res11 = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/feedback`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': ip,
        },
        cookies: {
          [CustomerSessionConstants.COOKIE_NAME]: 'yet-another-bogus-token',
        },
        payload: {
          rating: 4,
          feedback: 'Testing 11th invalid token',
          clientFeedbackId: crypto.randomUUID(),
          consentGiven: true,
        },
      });
      expect(res11.statusCode).toBe(429);
    });

    it('2.12 [Adversarial Scenario 6] Session creation spam from one IP is capped by Layer 1 IP limit', async () => {
      const { campaign } = await seedTestCampaign();
      const ip = '198.51.100.55';

      // sessionsPostMax is 2. Attacker attempts to create 3 sessions from the same IP.
      const res1 = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/sessions`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': ip,
        },
      });
      expect(res1.statusCode).toBe(201);

      const res2 = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/sessions`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': ip,
        },
      });
      expect(res2.statusCode).toBe(201);

      const res3 = await app.inject({
        method: 'POST',
        url: `/api/v1/public/qr/${campaign.code}/sessions`,
        headers: {
          origin: 'http://localhost:5173',
          'x-proxy-secret': TEST_PROXY_SECRET,
          'x-forwarded-client-ip': ip,
        },
      });
      expect(res3.statusCode).toBe(429);
      expect(res3.json().error.code).toBe(ErrorCodes.RATE_LIMITED);
    });

    it('2.13 BoundedSessionRateLimiter strictly bounds memory capacity under key flooding (LRU eviction)', () => {
      const limiter = new BoundedSessionRateLimiter({ maxKeys: 50, windowMs: 60000 });

      // Insert 100 unique keys
      for (let i = 0; i < 100; i++) {
        limiter.checkAndIncrement(`key-${i}`, 5);
      }

      // Size must never exceed maxKeys (50)
      expect(limiter.size).toBeLessThanOrEqual(50);
      expect(limiter.size).toBeGreaterThan(0);
    });

    it('2.14 BoundedSessionRateLimiter allows requests after window expiration', () => {
      const limiter = new BoundedSessionRateLimiter({ maxKeys: 10, windowMs: 50 }); // 50ms window
      const key = 'test-expire-key';

      // Exhaust limit of 1
      const res1 = limiter.checkAndIncrement(key, 1);
      expect(res1.allowed).toBe(true);

      const res2 = limiter.checkAndIncrement(key, 1);
      expect(res2.allowed).toBe(false);

      // Wait 60ms for window to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const res3 = limiter.checkAndIncrement(key, 1);
          expect(res3.allowed).toBe(true);
          resolve();
        }, 60);
      });
    });
  });

  // =========================================================================
  // 3. Routing Tests (2 Tests)
  // =========================================================================
  describe('3. Cloudflare Pages Routing Configuration', () => {
    it('3.1 _routes.json includes /api/* and excludes none', () => {
      const routesPath = path.resolve(__dirname, '../../frontend/public/_routes.json');
      expect(fs.existsSync(routesPath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
      expect(content).toEqual({
        version: 1,
        include: ['/api/*'],
        exclude: [],
      });
    });

    it('3.2 Frontend build produces _routes.json in output directory', () => {
      const distPath = path.resolve(__dirname, '../../frontend/dist/_routes.json');
      expect(fs.existsSync(distPath)).toBe(true);

      const parsed = JSON.parse(fs.readFileSync(distPath, 'utf8'));
      expect(parsed.version).toBe(1);
      expect(parsed.include).toContain('/api/*');
      expect(parsed.exclude).toHaveLength(0);
    });
  });
});
