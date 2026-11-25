import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../src/server.js';
import { getEnv, resetEnv } from '../src/config/env.js';
import { AuthConstants } from '@review-system/shared';
import { createTestApp } from './setup.js';

describe('Phase 7.0.3 Pilot Security Remediation Tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEnv();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnv();
  });

  // --- 1. SEC-02: CORS Configuration & Origin Enforcement ---
  describe('SEC-02: Restricted Credentialed CORS', () => {
    it('accepts requests from configured PUBLIC_WEB_URL with CORS headers and credentials', async () => {
      const server = buildServer();
      const response = await server.inject({
        method: 'OPTIONS',
        url: '/api/v1/owner/tenants',
        headers: {
          origin: 'http://localhost:5173',
          'access-control-request-method': 'GET',
        },
      });

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('rejects cross-origin requests from untrusted origins', async () => {
      const server = buildServer();
      const response = await server.inject({
        method: 'OPTIONS',
        url: '/api/v1/owner/tenants',
        headers: {
          origin: 'https://evil-attacker.com',
          'access-control-request-method': 'GET',
        },
      });

      // Untrusted origins must NOT receive an Access-Control-Allow-Origin header echoing their origin
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('permits non-browser requests without Origin header (e.g. server-to-server or curl)', async () => {
      const server = buildServer();
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(expect.objectContaining({ status: 'ok' }));
    });
  });

  // --- 2. SEC-03: Cookie Security Defaults ---
  describe('SEC-03: Production Cookie Security & Logout Clearing', () => {
    it('defaults COOKIE_SECURE to true when NODE_ENV=production and COOKIE_SECURE is unset', () => {
      process.env.NODE_ENV = 'production';
      process.env.SESSION_SECRET = 'a'.repeat(32);
      process.env.INTERNAL_PROXY_SECRET = 'b'.repeat(32);
      delete process.env.COOKIE_SECURE;

      const env = getEnv();
      expect(env.COOKIE_SECURE).toBe(true);
    });

    it('defaults COOKIE_SECURE to false in development mode', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.COOKIE_SECURE;

      const env = getEnv();
      expect(env.COOKIE_SECURE).toBe(false);
    });

    it('allows explicit override of COOKIE_SECURE when provided', () => {
      process.env.NODE_ENV = 'development';
      process.env.COOKIE_SECURE = 'true';

      const env = getEnv();
      expect(env.COOKIE_SECURE).toBe(true);
    });

    it('clears merchant cookie on logout with matching path and options', async () => {
      const { app } = await createTestApp();

      // Register a user to obtain a real session
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: `logout-test-${Date.now()}@example.com`,
          password: 'Password123!',
          fullName: 'Logout Tester',
          businessName: 'Logout Cafe',
        },
      });

      expect(regRes.statusCode).toBe(201);
      const cookies = regRes.cookies;
      const sessionCookie = cookies.find((c) => c.name === AuthConstants.COOKIE_NAME);
      expect(sessionCookie).toBeDefined();

      // Logout request with matching origin/host
      const logoutRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          origin: 'http://localhost',
        },
        cookies: {
          [AuthConstants.COOKIE_NAME]: sessionCookie!.value,
        },
      });

      expect(logoutRes.statusCode).toBe(200);
      const clearedCookie = logoutRes.cookies.find((c) => c.name === AuthConstants.COOKIE_NAME);
      expect(clearedCookie).toBeDefined();
      expect(clearedCookie!.path).toBe('/');
      expect(clearedCookie!.value).toBe('');
    });
  });

  // --- 3. SEC-01: Production SESSION_SECRET Validation ---
  describe('SEC-01: Production SESSION_SECRET Enforcement', () => {
    it('rejects startup in production if SESSION_SECRET is omitted', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.SESSION_SECRET;

      expect(() => getEnv()).toThrow('Environment variable validation failed');
    });

    it('rejects startup in production if SESSION_SECRET uses the exact default fallback string', () => {
      process.env.NODE_ENV = 'production';
      process.env.SESSION_SECRET = 'super-secret-session-key-must-be-at-least-32-chars-long!';

      expect(() => getEnv()).toThrow('Environment variable validation failed');
    });

    it('rejects startup in production if SESSION_SECRET is the default fallback string with leading or trailing whitespace', () => {
      process.env.NODE_ENV = 'production';
      process.env.SESSION_SECRET = '  super-secret-session-key-must-be-at-least-32-chars-long!  ';

      expect(() => getEnv()).toThrow('Environment variable validation failed');
    });

    it('rejects startup in production if SESSION_SECRET contains only whitespace', () => {
      process.env.NODE_ENV = 'production';
      process.env.SESSION_SECRET = '                                ';

      expect(() => getEnv()).toThrow('Environment variable validation failed');
    });

    it('rejects startup in production if SESSION_SECRET is fewer than 32 characters', () => {
      process.env.NODE_ENV = 'production';
      process.env.SESSION_SECRET = 'too-short-secret';

      expect(() => getEnv()).toThrow('Environment variable validation failed');
    });

    it('rejects startup in production if SESSION_SECRET has valid raw length but trimmed length under 32 characters', () => {
      process.env.NODE_ENV = 'production';
      process.env.SESSION_SECRET = '   short-secret   ';

      expect(() => getEnv()).toThrow('Environment variable validation failed');
    });

    it('accepts startup in production with an explicit, non-default, 32+ character secret', () => {
      process.env.NODE_ENV = 'production';
      process.env.SESSION_SECRET = 'custom-production-session-secret-key-32chars!';
      process.env.INTERNAL_PROXY_SECRET = 'custom-production-proxy-secret-key-32chars!';

      const env = getEnv();
      expect(env.SESSION_SECRET).toBe('custom-production-session-secret-key-32chars!');
    });

    it('permits default fallback string in development and test environments', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.SESSION_SECRET;

      const env = getEnv();
      expect(env.SESSION_SECRET).toBe('super-secret-session-key-must-be-at-least-32-chars-long!');
    });
  });
});
