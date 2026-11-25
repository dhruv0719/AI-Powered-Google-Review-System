import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  onRequest,
  validateBackendUrl,
  filterForwardHeaders,
  filterResponseHeaders,
  extractSetCookies,
  createErrorResponse,
  isValidIp,
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

      const returnedCookies = extractSetCookies(filtered);
      expect(returnedCookies.length).toBe(2);
      expect(returnedCookies[0]).toBe(
        'session_id=sess_abc123; Path=/; HttpOnly; SameSite=Lax; Secure'
      );
      expect(returnedCookies[1]).toBe('csrf_token=csrf_xyz789; Path=/; SameSite=Lax');
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

      const filtered = filterResponseHeaders(headers);
      const returnedCookies = extractSetCookies(filtered);
      expect(returnedCookies.length).toBe(2);
      expect(returnedCookies[0]).toBe('session_id=sess_one; Path=/');
      expect(returnedCookies[1]).toBe('session_id_two=sess_two; Path=/');
    });

    it('strips hop-by-hop and server headers and enforces cache isolation on upstream response', () => {
      const headers = new Headers({
        connection: 'close',
        'transfer-encoding': 'chunked',
        server: 'Render',
        'content-type': 'application/json',
        'cache-control': 'public, max-age=3600',
      });

      const filtered = filterResponseHeaders(headers);
      expect(filtered.get('connection')).toBeNull();
      expect(filtered.get('transfer-encoding')).toBeNull();
      expect(filtered.get('server')).toBeNull();
      expect(filtered.get('content-type')).toBe('application/json');
      expect(filtered.get('cache-control')).toBe('no-store, private');
      expect(filtered.get('pragma')).toBe('no-cache');
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
      expect(res.headers.get('cache-control')).toBe('no-store, private');
      expect(res.headers.get('pragma')).toBe('no-cache');

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

    it('preserves multiple distinct Set-Cookie headers end-to-end through onRequest', async () => {
      const cookie1 =
        'merchant_session=sess_sec123; Path=/; HttpOnly; SameSite=Lax; Secure';
      const cookie2 = 'csrf_token=csrf_tok456; Path=/; SameSite=Lax';

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        const upstreamHeaders = new Headers({
          'content-type': 'application/json',
        });
        upstreamHeaders.append('set-cookie', cookie1);
        upstreamHeaders.append('set-cookie', cookie2);

        return new Response(JSON.stringify({ authenticated: true }), {
          status: 200,
          headers: upstreamHeaders,
        });
      });

      const clientReq = new Request('https://my-saas.pages.dev/api/v1/auth/login', {
        method: 'POST',
        headers: {
          origin: 'https://my-saas.pages.dev',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
      });

      const context = createMockContext(clientReq);
      const res = await onRequest(context);

      expect(res.status).toBe(200);

      const returnedCookies = extractSetCookies(res.headers);
      expect(returnedCookies.length).toBe(2);

      // Verify cookies remain separate and are not lost
      expect(returnedCookies[0]).toBe(cookie1);
      expect(returnedCookies[1]).toBe(cookie2);

      // Verify neither cookie is comma-concatenated into the other
      expect(returnedCookies[0]).not.toContain(cookie2);
      expect(returnedCookies[1]).not.toContain(cookie1);

      // Verify security attributes are preserved
      expect(returnedCookies[0]).toContain('Path=/');
      expect(returnedCookies[0]).toContain('HttpOnly');
      expect(returnedCookies[0]).toContain('Secure');
      expect(returnedCookies[0]).toContain('SameSite=Lax');
      expect(returnedCookies[1]).toContain('SameSite=Lax');
    });

    it('preserves multiple Set-Cookie headers end-to-end through onRequest using Cloudflare getAll fallback', async () => {
      const cookie1 = 'customer_session=c_sess_789; Path=/api/v1/public/qr/code1; HttpOnly; Secure; SameSite=Lax';
      const cookie2 = 'client_marker=marker_val; Path=/api/v1/public/qr/code1; SameSite=Lax';

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        const upstreamHeaders = new Headers({
          'content-type': 'application/json',
        });
        const upstreamRes = new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: upstreamHeaders,
        });
        (upstreamRes.headers as any).getSetCookie = undefined;
        (upstreamRes.headers as any).getAll = (name: string) => {
          if (name.toLowerCase() === 'set-cookie') return [cookie1, cookie2];
          return [];
        };
        return upstreamRes;
      });

      const clientReq = new Request('https://my-saas.pages.dev/api/v1/public/qr/code1/sessions', {
        method: 'POST',
        headers: { origin: 'https://my-saas.pages.dev' },
      });

      const context = createMockContext(clientReq);
      const res = await onRequest(context);

      expect(res.status).toBe(200);

      const returnedCookies = extractSetCookies(res.headers);
      expect(returnedCookies.length).toBe(2);
      expect(returnedCookies[0]).toBe(cookie1);
      expect(returnedCookies[1]).toBe(cookie2);
      expect(returnedCookies[0]).not.toContain(cookie2);
      expect(returnedCookies[1]).not.toContain(cookie1);
      expect(returnedCookies[0]).toContain('HttpOnly');
      expect(returnedCookies[0]).toContain('Secure');
    });

    it('strips upstream Server header from final proxy response', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            server: 'Render',
          },
        });
      });

      const clientReq = new Request('https://my-saas.pages.dev/api/v1/test', {
        method: 'GET',
      });

      const context = createMockContext(clientReq);
      const res = await onRequest(context);

      expect(res.status).toBe(200);
      expect(res.headers.get('server')).toBeNull();
    });

    it('enforces Cache-Control: no-store, private and Pragma: no-cache across all HTTP status codes (200, 204, 302, 304, 400, 401, 429, 500)', async () => {
      const statusCodes = [200, 204, 302, 304, 400, 401, 429, 500];

      for (const status of statusCodes) {
        globalThis.fetch = vi.fn().mockImplementation(async () => {
          const headers: Record<string, string> = {
            'content-type': 'application/json',
          };
          if (status === 302) {
            headers.location = '/login';
          }
          const body = (status === 204 || status === 304) ? null : JSON.stringify({ status });
          return new Response(body, {
            status,
            headers,
          });
        });

        const clientReq = new Request('https://my-saas.pages.dev/api/v1/test', {
          method: 'GET',
        });

        const context = createMockContext(clientReq);
        const res = await onRequest(context);

        expect(res.status).toBe(status);
        expect(res.headers.get('cache-control')).toBe('no-store, private');
        expect(res.headers.get('pragma')).toBe('no-cache');
      }
    });

    it('enforces Cache-Control: no-store, private and Pragma: no-cache on proxy-generated 502, 404, and 400 errors', async () => {
      // 1. Upstream network failure -> 502
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Connection failed'));
      const netFailReq = new Request('https://my-saas.pages.dev/api/v1/auth/me', { method: 'GET' });
      const netFailRes = await onRequest(createMockContext(netFailReq));
      expect(netFailRes.status).toBe(502);
      expect(netFailRes.headers.get('cache-control')).toBe('no-store, private');
      expect(netFailRes.headers.get('pragma')).toBe('no-cache');

      // 2. Missing BACKEND_URL -> 502
      const missingEnvRes = await onRequest(createMockContext(netFailReq, {}));
      expect(missingEnvRes.status).toBe(502);
      expect(missingEnvRes.headers.get('cache-control')).toBe('no-store, private');
      expect(missingEnvRes.headers.get('pragma')).toBe('no-cache');

      // 3. Non-API path -> 404
      const nonApiReq = new Request('https://my-saas.pages.dev/static/bundle.js', { method: 'GET' });
      const nonApiRes = await onRequest(createMockContext(nonApiReq));
      expect(nonApiRes.status).toBe(404);
      expect(nonApiRes.headers.get('cache-control')).toBe('no-store, private');
      expect(nonApiRes.headers.get('pragma')).toBe('no-cache');

      // 4. Path traversal escaping /api/ -> 404
      const traversalReq = new Request('https://my-saas.pages.dev/api/../admin', { method: 'GET' });
      const traversalRes = await onRequest(createMockContext(traversalReq));
      expect(traversalRes.status).toBe(404);
      expect(traversalRes.headers.get('cache-control')).toBe('no-store, private');
      expect(traversalRes.headers.get('pragma')).toBe('no-cache');
    });

    it('sets cache: no-store on upstream fetch subrequests', async () => {
      let capturedInit: RequestInit | undefined;
      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      const clientReq = new Request('https://my-saas.pages.dev/api/v1/locations', {
        method: 'GET',
      });

      const context = createMockContext(clientReq);
      await onRequest(context);

      expect(capturedInit?.cache).toBe('no-store');
    });
  });

  describe('5. Error Response Envelope (createErrorResponse)', () => {
    it('creates standard SaaS error response envelope', async () => {
      const res = createErrorResponse(502, 'SERVICE_UNAVAILABLE', 'Service is currently unavailable.');
      expect(res.status).toBe(502);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('cache-control')).toBe('no-store, private');
      expect(res.headers.get('pragma')).toBe('no-cache');

      const data = await res.json();
      expect(data).toEqual({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Service is currently unavailable.',
        },
      });
    });
  });

  describe('6. Proxy Identity Assertion & Client IP Propagation (Phase 8.4.5.2)', () => {
    describe('IP Syntax Validation (isValidIp)', () => {
      it('validates correct IPv4 addresses', () => {
        expect(isValidIp('1.1.1.1')).toBe(true);
        expect(isValidIp('192.168.1.1')).toBe(true);
        expect(isValidIp('127.0.0.1')).toBe(true);
        expect(isValidIp('255.255.255.255')).toBe(true);
        expect(isValidIp('0.0.0.0')).toBe(true);
        expect(isValidIp(' 198.51.100.1 ')).toBe(true);
      });

      it('validates correct IPv6 addresses', () => {
        expect(isValidIp('::1')).toBe(true);
        expect(isValidIp('2001:db8::1')).toBe(true);
        expect(isValidIp('fe80::1')).toBe(true);
        expect(isValidIp('2400:cb00:2048:1::c629:d7a2')).toBe(true);
        expect(isValidIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true);
      });

      it('rejects invalid or malformed IP addresses', () => {
        expect(isValidIp(undefined)).toBe(false);
        expect(isValidIp(null)).toBe(false);
        expect(isValidIp('')).toBe(false);
        expect(isValidIp('   ')).toBe(false);
        // IPv4 with leading zeros
        expect(isValidIp('01.02.03.04')).toBe(false);
        expect(isValidIp('192.168.01.1')).toBe(false);
        // Numbers > 255
        expect(isValidIp('256.0.0.1')).toBe(false);
        expect(isValidIp('192.168.1.999')).toBe(false);
        // Non-numeric
        expect(isValidIp('192.168.1.abc')).toBe(false);
        expect(isValidIp('example.com')).toBe(false);
        // Incomplete
        expect(isValidIp('192.168.1')).toBe(false);
        expect(isValidIp('192.168.1.1.1')).toBe(false);
        // IPv6 malformed
        expect(isValidIp('2001:::1')).toBe(false);
        expect(isValidIp('2001::db8::1')).toBe(false);
        expect(isValidIp('2001:xyz::1')).toBe(false);
        // Injection attempts
        expect(isValidIp('127.0.0.1\r\nHost: evil.com')).toBe(false);
        expect(isValidIp('127.0.0.1, 10.0.0.1')).toBe(false);
      });
    });

    describe('Proxy Header Sanitation and Assertion', () => {
      it('strips incoming x-forwarded-client-ip and x-proxy-secret headers in filterForwardHeaders', () => {
        const clientHeaders = new Headers({
          'x-forwarded-client-ip': '1.2.3.4',
          'x-proxy-secret': 'spoofed-secret',
          'x-forwarded-for': '5.6.7.8',
          'x-forwarded-proto': 'https',
          'x-custom-header': 'safe-value',
        });

        const filtered = filterForwardHeaders(clientHeaders);
        expect(filtered.get('x-forwarded-client-ip')).toBeNull();
        expect(filtered.get('x-proxy-secret')).toBeNull();
        expect(filtered.get('x-forwarded-for')).toBeNull();
        expect(filtered.get('x-forwarded-proto')).toBeNull();
        expect(filtered.get('x-custom-header')).toBe('safe-value');
      });

      it('forwards verified client IP from cf-connecting-ip and INTERNAL_PROXY_SECRET in onRequest', async () => {
        let capturedInit: RequestInit | undefined;
        globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
          capturedInit = init;
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        });

        const clientReq = new Request('https://my-saas.pages.dev/api/v1/auth/me', {
          method: 'GET',
          headers: {
            'cf-connecting-ip': '203.0.113.195',
            'x-forwarded-client-ip': '10.0.0.1', // Spoofed client header
            'x-proxy-secret': 'attacker-secret', // Spoofed secret
          },
        });

        const context: EventContext<PagesEnv> = {
          request: clientReq,
          env: {
            BACKEND_URL: 'https://staging-backend.onrender.com',
            INTERNAL_PROXY_SECRET: 'super-secure-internal-proxy-secret-at-least-32-chars',
          },
          functionPath: '/api',
          waitUntil: vi.fn(),
          next: vi.fn(),
          params: {},
          data: {},
        };

        const res = await onRequest(context);
        expect(res.status).toBe(200);

        const forwardedHeaders = new Headers(capturedInit?.headers);
        // Must use verified cf-connecting-ip, NOT spoofed 10.0.0.1
        expect(forwardedHeaders.get('x-forwarded-client-ip')).toBe('203.0.113.195');
        // Must use env INTERNAL_PROXY_SECRET, NOT spoofed attacker-secret
        expect(forwardedHeaders.get('x-proxy-secret')).toBe(
          'super-secure-internal-proxy-secret-at-least-32-chars'
        );
      });

      it('does not forward x-forwarded-client-ip when cf-connecting-ip is invalid', async () => {
        let capturedInit: RequestInit | undefined;
        globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
          capturedInit = init;
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        });

        const clientReq = new Request('https://my-saas.pages.dev/api/v1/auth/me', {
          method: 'GET',
          headers: {
            'cf-connecting-ip': 'invalid-malformed-ip',
            'x-forwarded-client-ip': '10.0.0.1',
          },
        });

        const context: EventContext<PagesEnv> = {
          request: clientReq,
          env: {
            BACKEND_URL: 'https://staging-backend.onrender.com',
          },
          functionPath: '/api',
          waitUntil: vi.fn(),
          next: vi.fn(),
          params: {},
          data: {},
        };

        const res = await onRequest(context);
        expect(res.status).toBe(200);

        const forwardedHeaders = new Headers(capturedInit?.headers);
        expect(forwardedHeaders.get('x-forwarded-client-ip')).toBeNull();
        expect(forwardedHeaders.get('x-proxy-secret')).toBeNull();
      });

      it('omits x-proxy-secret when INTERNAL_PROXY_SECRET is not configured in env', async () => {
        let capturedInit: RequestInit | undefined;
        globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
          capturedInit = init;
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        });

        const clientReq = new Request('https://my-saas.pages.dev/api/v1/auth/me', {
          method: 'GET',
          headers: {
            'cf-connecting-ip': '198.51.100.5',
          },
        });

        const context: EventContext<PagesEnv> = {
          request: clientReq,
          env: {
            BACKEND_URL: 'https://staging-backend.onrender.com',
          },
          functionPath: '/api',
          waitUntil: vi.fn(),
          next: vi.fn(),
          params: {},
          data: {},
        };

        const res = await onRequest(context);
        expect(res.status).toBe(200);

        const forwardedHeaders = new Headers(capturedInit?.headers);
        expect(forwardedHeaders.get('x-forwarded-client-ip')).toBe('198.51.100.5');
        expect(forwardedHeaders.get('x-proxy-secret')).toBeNull();
      });
    });
  });
});
