import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  onRequest,
  validateBackendUrl,
  filterForwardHeaders,
  filterResponseHeaders,
  extractSetCookies,
  createErrorResponse,
  EventContext,
  PagesEnv,
} from '../../../../functions/api/[[catchall]].ts';

describe('Cloudflare Pages API Proxy Implementation (Phase 8.4.3)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('1. BACKEND_URL Environment Validation (validateBackendUrl)', () => {
    it('accepts valid pure HTTPS origins', () => {
      const validUrls = [
        'https://my-backend.onrender.com',
        'https://my-backend.onrender.com/',
        'https://api.staging.mysaas.com',
        'https://api.staging.mysaas.com:8443',
        'https://saas-backend-123.onrender.com',
      ];

      for (const url of validUrls) {
        const result = validateBackendUrl(url);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.origin).toMatch(/^https:\/\//);
          const parsed = new URL(result.origin);
          expect(parsed.pathname).toBe('/');
        }
      }
    });

    it('rejects missing, undefined, or empty BACKEND_URL', () => {
      expect(validateBackendUrl(undefined)).toEqual({
        valid: false,
        reason: 'BACKEND_URL is not configured.',
      });
      expect(validateBackendUrl('')).toEqual({
        valid: false,
        reason: 'BACKEND_URL is not configured.',
      });
      expect(validateBackendUrl('   ')).toEqual({
        valid: false,
        reason: 'BACKEND_URL is not configured.',
      });
    });

    it('rejects non-HTTPS protocols (HTTP backend rejection)', () => {
      const httpResult = validateBackendUrl('http://my-backend.onrender.com');
      expect(httpResult.valid).toBe(false);
      if (!httpResult.valid) {
        expect(httpResult.reason).toContain('HTTPS');
      }

      const ftpResult = validateBackendUrl('ftp://my-backend.onrender.com');
      expect(ftpResult.valid).toBe(false);
    });

    it('rejects invalid hostnames or malformed URLs', () => {
      expect(validateBackendUrl('not-a-valid-url').valid).toBe(false);
      expect(validateBackendUrl('https://').valid).toBe(false);
    });

    it('rejects URLs containing embedded credentials', () => {
      const credsResult = validateBackendUrl('https://admin:secret@my-backend.onrender.com');
      expect(credsResult.valid).toBe(false);
      if (!credsResult.valid) {
        expect(credsResult.reason).toContain('credentials');
      }
    });

    it('rejects URLs containing query parameters or fragments', () => {
      const queryResult = validateBackendUrl('https://my-backend.onrender.com?staging=true');
      expect(queryResult.valid).toBe(false);
      if (!queryResult.valid) {
        expect(queryResult.reason).toContain('query parameters');
      }

      const hashResult = validateBackendUrl('https://my-backend.onrender.com#backend');
      expect(hashResult.valid).toBe(false);
      if (!hashResult.valid) {
        expect(hashResult.reason).toContain('fragments');
      }
    });

    it('rejects URLs with path prefixes (must be pure origin)', () => {
      const pathResult = validateBackendUrl('https://my-backend.onrender.com/api/v1');
      expect(pathResult.valid).toBe(false);
      if (!pathResult.valid) {
        expect(pathResult.reason).toContain('pure origin');
      }
    });
  });

  describe('2. Header Sanitization & Forwarding (filterForwardHeaders)', () => {
    it('preserves legitimate client headers (Origin, Cookie, Authorization, Content-Type, Accept)', () => {
      const headers = new Headers({
        origin: 'https://staging-client.pages.dev',
        cookie: 'session_id=s_12345; client_token=tok_987',
        authorization: 'Bearer secret_token',
        'content-type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'user-agent': 'Mozilla/5.0 TestBrowser',
      });

      const forwarded = filterForwardHeaders(headers);

      expect(forwarded.get('origin')).toBe('https://staging-client.pages.dev');
      expect(forwarded.get('cookie')).toBe('session_id=s_12345; client_token=tok_987');
      expect(forwarded.get('authorization')).toBe('Bearer secret_token');
      expect(forwarded.get('content-type')).toBe('application/json');
      expect(forwarded.get('accept')).toBe('application/json, text/plain, */*');
      expect(forwarded.get('user-agent')).toBe('Mozilla/5.0 TestBrowser');
    });

    it('strips standard RFC 7230 hop-by-hop headers', () => {
      const headers = new Headers({
        connection: 'keep-alive',
        'keep-alive': 'timeout=5, max=1000',
        'proxy-authenticate': 'Basic',
        'proxy-authorization': 'Basic credentials',
        te: 'trailers',
        trailer: 'Expires',
        'transfer-encoding': 'chunked',
        upgrade: 'websocket',
        'content-type': 'application/json',
      });

      const forwarded = filterForwardHeaders(headers);

      expect(forwarded.get('connection')).toBeNull();
      expect(forwarded.get('keep-alive')).toBeNull();
      expect(forwarded.get('proxy-authenticate')).toBeNull();
      expect(forwarded.get('proxy-authorization')).toBeNull();
      expect(forwarded.get('te')).toBeNull();
      expect(forwarded.get('trailer')).toBeNull();
      expect(forwarded.get('transfer-encoding')).toBeNull();
      expect(forwarded.get('upgrade')).toBeNull();
      expect(forwarded.get('content-type')).toBe('application/json');
    });

    it('strips dynamic headers declared in Connection token list', () => {
      const headers = new Headers({
        connection: 'x-custom-hop, x-another-hop',
        'x-custom-hop': 'should-be-removed',
        'x-another-hop': 'also-removed',
        'x-legitimate': 'keep-me',
      });

      const forwarded = filterForwardHeaders(headers);

      expect(forwarded.get('connection')).toBeNull();
      expect(forwarded.get('x-custom-hop')).toBeNull();
      expect(forwarded.get('x-another-hop')).toBeNull();
      expect(forwarded.get('x-legitimate')).toBe('keep-me');
    });

    it('strips untrusted incoming X-Forwarded-* headers', () => {
      const headers = new Headers({
        'x-forwarded-host': 'attacker-controlled.com',
        'x-forwarded-for': '198.51.100.1',
        'x-forwarded-proto': 'http',
        'x-forwarded-port': '80',
        'x-forwarded-server': 'rogue-server',
        'content-type': 'application/json',
      });

      const forwarded = filterForwardHeaders(headers);

      expect(forwarded.get('x-forwarded-host')).toBeNull();
      expect(forwarded.get('x-forwarded-for')).toBeNull();
      expect(forwarded.get('x-forwarded-proto')).toBeNull();
      expect(forwarded.get('x-forwarded-port')).toBeNull();
      expect(forwarded.get('x-forwarded-server')).toBeNull();
      expect(forwarded.get('content-type')).toBe('application/json');
    });

    it('does not forward incoming Host header (leaves it to fetch)', () => {
      const headers = new Headers({
        host: 'client.pages.dev',
        'content-type': 'application/json',
      });

      const forwarded = filterForwardHeaders(headers);
      expect(forwarded.get('host')).toBeNull();
    });
  });

  describe('3. Response Header Handling & Multiple Set-Cookie Preservation', () => {
    it('preserves multiple Set-Cookie headers independently using getSetCookie', () => {
      const headers = new Headers();
      // Polyfill/mock getSetCookie to verify independent multi-cookie extraction
      (headers as any).getSetCookie = () => [
        'session_id=sess_abc123; Path=/; HttpOnly; SameSite=Lax; Secure',
        'csrf_token=csrf_xyz789; Path=/; SameSite=Lax',
      ];
      headers.set('content-type', 'application/json');

      const extracted = extractSetCookies(headers);
      expect(extracted).toEqual([
        'session_id=sess_abc123; Path=/; HttpOnly; SameSite=Lax; Secure',
        'csrf_token=csrf_xyz789; Path=/; SameSite=Lax',
      ]);

      const filtered = filterResponseHeaders(headers);
      expect(filtered.get('content-type')).toBe('application/json');

      if (typeof (filtered as any).getSetCookie === 'function') {
        const returnedCookies = (filtered as any).getSetCookie();
        expect(returnedCookies.length).toBe(2);
      }
    });

    it('preserves multiple Set-Cookie headers using getAll fallback if getSetCookie is absent', () => {
      const headers = new Headers();
      (headers as any).getSetCookie = undefined;
      (headers as any).getAll = (name: string) => {
        if (name.toLowerCase() === 'set-cookie') {
          return [
            'session_id=sess_one; Path=/',
            'session_id_two=sess_two; Path=/',
          ];
        }
        return [];
      };

      const extracted = extractSetCookies(headers);
      expect(extracted).toEqual([
        'session_id=sess_one; Path=/',
        'session_id_two=sess_two; Path=/',
      ]);
    });

    it('strips hop-by-hop headers from upstream response', () => {
      const headers = new Headers({
        connection: 'close',
        'transfer-encoding': 'chunked',
        'content-type': 'application/json',
        'cache-control': 'private, no-cache',
      });

      const filtered = filterResponseHeaders(headers);
      expect(filtered.get('connection')).toBeNull();
      expect(filtered.get('transfer-encoding')).toBeNull();
      expect(filtered.get('content-type')).toBe('application/json');
      expect(filtered.get('cache-control')).toBe('private, no-cache');
    });
  });

  describe('4. Full Proxy End-to-End Execution (onRequest)', () => {
    const validEnv: PagesEnv = {
      BACKEND_URL: 'https://staging-backend.onrender.com',
    };

    function createMockContext(
      request: Request,
      env: PagesEnv = validEnv
    ): EventContext<PagesEnv> {
      return {
        request,
        env,
        functionPath: '/api',
        waitUntil: vi.fn(),
        next: vi.fn(),
        params: {},
        data: {},
      };
    }

    it('successfully forwards GET request with query parameters and headers', async () => {
      let capturedUrl = '';
      let capturedInit: RequestInit | undefined;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify({ status: 'ok', authenticated: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const clientReq = new Request(
        'https://my-saas.pages.dev/api/v1/auth/me?activeTenant=tenant_123&refresh=true',
        {
          method: 'GET',
          headers: {
            origin: 'https://my-saas.pages.dev',
            cookie: 'merchant_session=valid_session_token',
            accept: 'application/json',
          },
        }
      );

      const context = createMockContext(clientReq);
      const res = await onRequest(context);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ status: 'ok', authenticated: true });

      // Target URL verification
      expect(capturedUrl).toBe(
        'https://staging-backend.onrender.com/api/v1/auth/me?activeTenant=tenant_123&refresh=true'
      );
      expect(capturedInit?.method).toBe('GET');
      expect(capturedInit?.body).toBeUndefined();

      // Headers verification
      const forwardedHeaders = new Headers(capturedInit?.headers);
      expect(forwardedHeaders.get('origin')).toBe('https://my-saas.pages.dev');
      expect(forwardedHeaders.get('cookie')).toBe('merchant_session=valid_session_token');
      expect(forwardedHeaders.get('accept')).toBe('application/json');
      expect(forwardedHeaders.get('host')).toBeNull();
    });

    it('successfully forwards POST request with JSON body and Content-Type', async () => {
      let capturedUrl = '';
      let capturedInit: RequestInit | undefined;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify({ id: 'feedback_123', success: true }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      });

      const requestPayload = JSON.stringify({
        rating: 5,
        feedbackText: 'Outstanding service and clean atmosphere!',
        consentGiven: true,
      });

      const clientReq = new Request(
        'https://my-saas.pages.dev/api/v1/public/qr/camp_abc/feedback',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://my-saas.pages.dev',
            cookie: 'customer_session=sess_abc',
          },
          body: requestPayload,
        }
      );

      const context = createMockContext(clientReq);
      const res = await onRequest(context);

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data).toEqual({ id: 'feedback_123', success: true });

      expect(capturedUrl).toBe(
        'https://staging-backend.onrender.com/api/v1/public/qr/camp_abc/feedback'
      );
      expect(capturedInit?.method).toBe('POST');
      expect(capturedInit?.body).toBeDefined();

      const forwardedHeaders = new Headers(capturedInit?.headers);
      expect(forwardedHeaders.get('content-type')).toBe('application/json');
      expect(forwardedHeaders.get('origin')).toBe('https://my-saas.pages.dev');
    });

    it('successfully forwards PUT, PATCH, and DELETE requests', async () => {
      const methods = ['PUT', 'PATCH', 'DELETE'] as const;

      for (const method of methods) {
        let capturedMethod = '';
        globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
          capturedMethod = init?.method || '';
          return new Response(null, { status: 204 });
        });

        const clientReq = new Request('https://my-saas.pages.dev/api/v1/owner/tenants/t1', {
          method,
          headers: { origin: 'https://my-saas.pages.dev' },
        });

        const context = createMockContext(clientReq);
        const res = await onRequest(context);

        expect(res.status).toBe(204);
        expect(capturedMethod).toBe(method);
      }
    });

    it('preserves upstream error status codes (400, 401, 403, 404, 409, 429, 500)', async () => {
      const testStatuses = [400, 401, 403, 404, 409, 429, 500];

      for (const status of testStatuses) {
        globalThis.fetch = vi.fn().mockImplementation(async () => {
          return new Response(
            JSON.stringify({
              error: { code: 'TEST_ERROR', message: `Failed with ${status}` },
            }),
            {
              status,
              headers: { 'content-type': 'application/json' },
            }
          );
        });

        const clientReq = new Request('https://my-saas.pages.dev/api/v1/test', {
          method: 'GET',
        });

        const context = createMockContext(clientReq);
        const res = await onRequest(context);

        expect(res.status).toBe(status);
        const data = await res.json();
        expect(data.error.code).toBe('TEST_ERROR');
      }
    });

    it('correctly handles null-body HTTP responses (204 No Content, 304 Not Modified)', async () => {
      for (const status of [204, 304]) {
        globalThis.fetch = vi.fn().mockImplementation(async () => {
          return new Response(null, { status });
        });

        const clientReq = new Request('https://my-saas.pages.dev/api/v1/resource', {
          method: 'GET',
        });

        const context = createMockContext(clientReq);
        const res = await onRequest(context);

        expect(res.status).toBe(status);
        expect(res.body).toBeNull();
      }
    });

    it('returns HTTP 502 with SERVICE_UNAVAILABLE when upstream fetch fails (network failure / timeout)', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch: Connection refused'));

      const clientReq = new Request('https://my-saas.pages.dev/api/v1/auth/me', {
        method: 'GET',
      });

      const context = createMockContext(clientReq);
      const res = await onRequest(context);

      expect(res.status).toBe(502);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('cache-control')).toContain('no-store');

      const data = await res.json();
      expect(data).toEqual({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The upstream service is currently unavailable. Please try again later.',
        },
      });
    });

    it('returns HTTP 502 when BACKEND_URL binding is missing or empty', async () => {
      const clientReq = new Request('https://my-saas.pages.dev/api/v1/auth/me', {
        method: 'GET',
      });

      // No BACKEND_URL in env
      const context = createMockContext(clientReq, {});
      const res = await onRequest(context);

      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('returns HTTP 502 when BACKEND_URL is insecure (HTTP scheme)', async () => {
      const clientReq = new Request('https://my-saas.pages.dev/api/v1/auth/me', {
        method: 'GET',
      });

      const context = createMockContext(clientReq, {
        BACKEND_URL: 'http://insecure-backend.onrender.com',
      });
      const res = await onRequest(context);

      expect(res.status).toBe(502);
      const data = await res.json();
      expect(data.error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('rejects requests outside /api/ with 404 Not Found', async () => {
      const clientReq = new Request('https://my-saas.pages.dev/static/bundle.js', {
        method: 'GET',
      });

      const context = createMockContext(clientReq);
      const res = await onRequest(context);

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('blocks path traversal attempts attempting to escape /api/ with 404', async () => {
      const clientReq = new Request('https://my-saas.pages.dev/api/../internal/admin', {
        method: 'GET',
      });

      const context = createMockContext(clientReq);
      const res = await onRequest(context);

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.code).toBe('NOT_FOUND');
    });

    it('enforces redirect: manual and preserves 3xx redirect responses without following', async () => {
      let capturedInit: RequestInit | undefined;
      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(null, {
          status: 302,
          headers: { location: 'https://staging-backend.onrender.com/login' },
        });
      });

      const clientReq = new Request('https://my-saas.pages.dev/api/v1/redirect-me', {
        method: 'GET',
      });

      const context = createMockContext(clientReq);
      const res = await onRequest(context);

      expect(capturedInit?.redirect).toBe('manual');
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://staging-backend.onrender.com/login');
    });

    it('strips injected client X-Forwarded-* and host headers before forwarding', async () => {
      let capturedInit: RequestInit | undefined;
      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const clientReq = new Request('https://my-saas.pages.dev/api/v1/test', {
        method: 'GET',
        headers: {
          'x-forwarded-host': 'malicious-spoofed-domain.com',
          'x-forwarded-for': '1.2.3.4',
          'x-forwarded-proto': 'http',
          host: 'spoofed-host.com',
          origin: 'https://my-saas.pages.dev',
        },
      });

      const context = createMockContext(clientReq);
      await onRequest(context);

      const forwardedHeaders = new Headers(capturedInit?.headers);
      expect(forwardedHeaders.get('x-forwarded-host')).toBeNull();
      expect(forwardedHeaders.get('x-forwarded-for')).toBeNull();
      expect(forwardedHeaders.get('x-forwarded-proto')).toBeNull();
      expect(forwardedHeaders.get('host')).toBeNull();
      expect(forwardedHeaders.get('origin')).toBe('https://my-saas.pages.dev');
    });
  });

  describe('5. Error Response Envelope (createErrorResponse)', () => {
    it('creates standard SaaS error response envelope', async () => {
      const res = createErrorResponse(502, 'SERVICE_UNAVAILABLE', 'Service is currently unavailable.');
      expect(res.status).toBe(502);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('cache-control')).toContain('no-store');

      const data = await res.json();
      expect(data).toEqual({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Service is currently unavailable.',
        },
      });
    });
  });
});
