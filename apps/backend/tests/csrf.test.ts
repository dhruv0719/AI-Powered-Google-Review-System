import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp } from './setup.js';
import { FastifyInstance } from 'fastify';
import { ErrorCodes, AuthConstants } from '@review-system/shared';

describe('CSRF Protection & Cookie Security Verification Tests', () => {
  let app: FastifyInstance;
  let db: any;
  let sessionCookie: string;

  beforeEach(async () => {
    const testSetup = await createTestApp();
    app = testSetup.app;
    db = testSetup.db;

    // Register a test user
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'csrf-tester@example.com',
        password: 'Password123!',
        fullName: 'CSRF Tester',
        businessName: 'CSRF Protection Ltd',
      },
    });

    const cookie = res.cookies.find((c) => c.name === AuthConstants.COOKIE_NAME);
    expect(cookie).toBeDefined();
    sessionCookie = cookie!.value;
  });

  // 1. Cookie attributes verification
  it('1. should set secure cookie attributes (httpOnly, sameSite: lax, path: /)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'csrf-tester@example.com',
        password: 'Password123!',
      },
    });

    const cookie = res.cookies.find((c) => c.name === AuthConstants.COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
    expect(cookie?.path).toBe('/');
    expect(cookie?.maxAge).toBe(AuthConstants.SESSION_TTL_DAYS * 24 * 60 * 60);
  });

  // 2. Reject mismatched Origin
  it('2. should reject state-changing request with mismatched Origin header (403 FORBIDDEN)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/owner/tenants',
      headers: {
        origin: 'http://malicious.evil-site.com',
      },
      cookies: {
        [AuthConstants.COOKIE_NAME]: sessionCookie,
      },
      payload: {
        displayName: 'Evil Tenant',
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error.code).toBe(ErrorCodes.FORBIDDEN);
    expect(body.error.message).toContain('Cross-Site Request Forgery blocked');
  });

  // 3. Reject mismatched Port / Scheme
  it('3. should reject state-changing request with mismatched port (e.g. 8080 vs host 3000)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/owner/tenants',
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:8080',
      },
      cookies: {
        [AuthConstants.COOKIE_NAME]: sessionCookie,
      },
      payload: {
        displayName: 'Port Mismatched Tenant',
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error.code).toBe(ErrorCodes.FORBIDDEN);
    expect(body.error.message).toContain('host mismatch');
  });

  // 4. Reject mismatched Scheme (https origin vs http request)
  it('4. should reject state-changing request with mismatched scheme (https vs http)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/owner/tenants',
      headers: {
        host: 'localhost',
        origin: 'https://localhost',
      },
      cookies: {
        [AuthConstants.COOKIE_NAME]: sessionCookie,
      },
      payload: {
        displayName: 'Scheme Mismatched Tenant',
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error.code).toBe(ErrorCodes.FORBIDDEN);
    expect(body.error.message).toContain('scheme mismatch');
  });

  // 5. Reject malformed Origin
  it('5. should reject state-changing request with malformed Origin header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/owner/tenants',
      headers: {
        origin: 'not-a-valid-url-format',
      },
      cookies: {
        [AuthConstants.COOKIE_NAME]: sessionCookie,
      },
      payload: {
        displayName: 'Malformed Origin Tenant',
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error.code).toBe(ErrorCodes.FORBIDDEN);
    expect(body.error.message).toBe('Invalid origin or referer header');
  });

  // 6. Reject missing Origin AND Referer on cookie-authenticated state-changing request
  it('6. should reject state-changing request with cookie when Origin and Referer are both missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/owner/tenants',
      cookies: {
        [AuthConstants.COOKIE_NAME]: sessionCookie,
      },
      payload: {
        displayName: 'Missing Origin Tenant',
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error.code).toBe(ErrorCodes.FORBIDDEN);
    expect(body.error.message).toBe('Origin or Referer header required for state-changing requests');
  });

  // 7. Allow matching Origin header
  it('7. should accept state-changing request when Origin matches Host', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/owner/tenants',
      headers: {
        origin: 'http://localhost',
      },
      cookies: {
        [AuthConstants.COOKIE_NAME]: sessionCookie,
      },
      payload: {
        displayName: 'Valid Origin Branch',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().displayName).toBe('Valid Origin Branch');
  });

  // 8. Allow matching Referer header as fallback
  it('8. should accept state-changing request when Referer matches Host and Origin is absent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/owner/tenants',
      headers: {
        referer: 'http://localhost/dashboard/settings',
      },
      cookies: {
        [AuthConstants.COOKIE_NAME]: sessionCookie,
      },
      payload: {
        displayName: 'Valid Referer Branch',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().displayName).toBe('Valid Referer Branch');
  });

  // 9. Safe methods (GET) do not require Origin/Referer
  it('9. should allow safe read requests (GET) with cookie without Origin/Referer headers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: {
        [AuthConstants.COOKIE_NAME]: sessionCookie,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('csrf-tester@example.com');
  });

  // 10. API clients using Bearer token are exempt from CSRF Origin check
  it('10. should allow Bearer token authenticated state-changing requests without Origin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/owner/tenants',
      headers: {
        authorization: `Bearer ${sessionCookie}`,
      },
      payload: {
        displayName: 'API Client Branch',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().displayName).toBe('API Client Branch');
  });
});
