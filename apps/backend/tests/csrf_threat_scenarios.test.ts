import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestApp } from './setup.js';
import { FastifyInstance } from 'fastify';
import { ErrorCodes, AuthConstants } from '@review-system/shared';
import { resetEnv } from '../src/config/env.js';

describe('Phase 8.3.2 Canonical Allowlist CSRF & Reverse Proxy Threat Scenarios', () => {
  let app: FastifyInstance;
  let sessionCookie: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    resetEnv();
    const testSetup = await createTestApp();
    app = testSetup.app;

    // Register a merchant user to obtain an authenticated session cookie
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'threat-tester@example.com',
        password: 'Password123!',
        fullName: 'Threat Tester',
        businessName: 'Secure Shield Inc',
      },
    });

    const cookie = res.cookies.find((c) => c.name === AuthConstants.COOKIE_NAME);
    expect(cookie).toBeDefined();
    sessionCookie = cookie!.value;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnv();
  });

  // --- 1. Legitimate Reverse Proxy Scenarios ---
  describe('Legitimate Request Paths', () => {
    it('accepts state-changing requests when Origin matches configured PUBLIC_WEB_URL (e.g. Vercel frontend)', async () => {
      // Simulate staging configuration:
      // PUBLIC_WEB_URL is https://review-staging.vercel.app
      // Request arrives at backend with Host: backend.onrender.com
      process.env.PUBLIC_WEB_URL = 'https://review-staging.vercel.app';
      resetEnv();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/owner/tenants',
        headers: {
          host: 'backend.onrender.com',
          origin: 'https://review-staging.vercel.app',
        },
        cookies: {
          [AuthConstants.COOKIE_NAME]: sessionCookie,
        },
        payload: {
          displayName: 'Branch Vercel Staging',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().displayName).toBe('Branch Vercel Staging');
    });

    it('accepts state-changing requests when Origin matches ALLOWED_ORIGINS allowlist (e.g. Cloudflare Pages or custom staging domain)', async () => {
      process.env.PUBLIC_WEB_URL = 'https://review-staging.vercel.app';
      process.env.ALLOWED_ORIGINS = 'https://review-staging.pages.dev, https://merchant.reviews.example.com';
      resetEnv();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/owner/tenants',
        headers: {
          host: 'backend.onrender.com',
          origin: 'https://review-staging.pages.dev',
        },
        cookies: {
          [AuthConstants.COOKIE_NAME]: sessionCookie,
        },
        payload: {
          displayName: 'Branch Cloudflare Pages',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().displayName).toBe('Branch Cloudflare Pages');
    });

    it('accepts state-changing requests when Referer fallback matches canonical allowlist and Origin is absent', async () => {
      process.env.PUBLIC_WEB_URL = 'https://review-staging.vercel.app';
      resetEnv();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/owner/tenants',
        headers: {
          host: 'backend.onrender.com',
          referer: 'https://review-staging.vercel.app/dashboard/settings',
        },
        cookies: {
          [AuthConstants.COOKIE_NAME]: sessionCookie,
        },
        payload: {
          displayName: 'Branch Referer Fallback',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().displayName).toBe('Branch Referer Fallback');
    });
  });

  // --- 2. Malicious Threat Scenarios & Spoofing Attempts ---
  describe('Malicious Threat Scenarios & Host Spoofing Resistance', () => {
    it('rejects direct request with untrusted Origin even if X-Forwarded-Host is forged to match Origin', async () => {
      // Threat: Attacker connects directly to backend.onrender.com
      // Attacker supplies Origin: https://evil-attacker.com
      // Attacker forges X-Forwarded-Host: evil-attacker.com
      // System MUST NOT trust X-Forwarded-Host and MUST reject with 403
      process.env.PUBLIC_WEB_URL = 'https://review-staging.vercel.app';
      resetEnv();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/owner/tenants',
        headers: {
          host: 'backend.onrender.com',
          origin: 'https://evil-attacker.com',
          'x-forwarded-host': 'evil-attacker.com',
        },
        cookies: {
          [AuthConstants.COOKIE_NAME]: sessionCookie,
        },
        payload: {
          displayName: 'Attacker Hijacked Tenant',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(res.json().error.message).toContain('Cross-Site Request Forgery blocked');
    });

    it('rejects request with Origin that merely shares a suffix with an approved domain (subdomain takeover/confusion attack)', async () => {
      // Approved domain: vercel.app
      // Attacker domain: attacker-vercel.app or evilvercel.app
      process.env.PUBLIC_WEB_URL = 'https://review-staging.vercel.app';
      resetEnv();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/owner/tenants',
        headers: {
          host: 'backend.onrender.com',
          origin: 'https://review-staging.vercel.app.evil-phishing.com',
        },
        cookies: {
          [AuthConstants.COOKIE_NAME]: sessionCookie,
        },
        payload: {
          displayName: 'Suffix Confusion Tenant',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('rejects request with protocol scheme mismatch against approved origin (http vs https)', async () => {
      process.env.PUBLIC_WEB_URL = 'https://review-staging.vercel.app';
      resetEnv();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/owner/tenants',
        headers: {
          host: 'backend.onrender.com',
          origin: 'http://review-staging.vercel.app', // Insecure plain HTTP
        },
        cookies: {
          [AuthConstants.COOKIE_NAME]: sessionCookie,
        },
        payload: {
          displayName: 'Scheme Mismatched Tenant',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('rejects request with port mismatch against approved origin', async () => {
      process.env.PUBLIC_WEB_URL = 'https://review-staging.vercel.app';
      resetEnv();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/owner/tenants',
        headers: {
          host: 'backend.onrender.com',
          origin: 'https://review-staging.vercel.app:8443', // Non-standard port
        },
        cookies: {
          [AuthConstants.COOKIE_NAME]: sessionCookie,
        },
        payload: {
          displayName: 'Port Mismatched Tenant',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe(ErrorCodes.FORBIDDEN);
    });

    it('rejects state-changing request when both Origin and Referer are absent', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/owner/tenants',
        headers: {
          host: 'backend.onrender.com',
        },
        cookies: {
          [AuthConstants.COOKIE_NAME]: sessionCookie,
        },
        payload: {
          displayName: 'No Origin Tenant',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(res.json().error.message).toBe('Origin or Referer header required for state-changing requests');
    });

    it('rejects state-changing request when Origin is malformed', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/owner/tenants',
        headers: {
          origin: '://malformed-url-syntax',
        },
        cookies: {
          [AuthConstants.COOKIE_NAME]: sessionCookie,
        },
        payload: {
          displayName: 'Malformed Origin Tenant',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(res.json().error.message).toBe('Invalid origin or referer header');
    });
  });
});
