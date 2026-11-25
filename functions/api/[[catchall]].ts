/**
 * Cloudflare Pages API Proxy Function
 *
 * Intercepts all requests matching `/api/*` and proxies them to the
 * configured backend service (`BACKEND_URL`), preserving headers,
 * cookies, query parameters, and methods while enforcing strict security boundaries.
 */

export interface PagesEnv {
  BACKEND_URL?: string;
  INTERNAL_PROXY_SECRET?: string;
  [key: string]: unknown;
}

export interface EventContext<
  Env = PagesEnv,
  P extends string = string,
  Data = Record<string, unknown>
> {
  request: Request;
  functionPath: string;
  waitUntil: (promise: Promise<unknown>) => void;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
  env: Env;
  params: Record<P, string | string[]>;
  data: Data;
}

export type PagesFunction<
  Env = PagesEnv,
  Params extends string = any,
  Data extends Record<string, unknown> = Record<string, unknown>
> = (context: EventContext<Env, Params, Data>) => Response | Promise<Response>;

/**
 * Standard RFC 7230 hop-by-hop headers plus `host` (which fetch sets to upstream origin)
 */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
]);

/**
 * Standard SaaS error response envelope
 */
export function createErrorResponse(
  status: number,
  code: string,
  message: string
): Response {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message,
      },
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, private',
        Pragma: 'no-cache',
      },
    }
  );
}

/**
 * Validates the BACKEND_URL environment variable:
 * - Must be present and non-empty
 * - Must use HTTPS protocol
 * - Must have a valid hostname
 * - Must not contain credentials (username/password)
 * - Must not contain query parameters or fragments
 * - Must be a pure origin (pathname empty or '/')
 */
export function validateBackendUrl(
  rawUrl?: string
): { valid: true; origin: string } | { valid: false; reason: string } {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return { valid: false, reason: 'BACKEND_URL is not configured.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, reason: 'BACKEND_URL is not a valid URL.' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'BACKEND_URL must use HTTPS protocol.' };
  }

  if (!parsed.hostname || parsed.hostname.trim() === '') {
    return { valid: false, reason: 'BACKEND_URL has an invalid hostname.' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'BACKEND_URL must not contain credentials.' };
  }

  if (parsed.search || parsed.hash) {
    return {
      valid: false,
      reason: 'BACKEND_URL must not contain query parameters or fragments.',
    };
  }

  if (parsed.pathname !== '' && parsed.pathname !== '/') {
    return {
      valid: false,
      reason: 'BACKEND_URL must be a pure origin without a path prefix.',
    };
  }

  return { valid: true, origin: parsed.origin };
}

/**
 * Validates whether a given string is a syntactically valid IPv4 or IPv6 address
 */
export function isValidIp(ip?: string | null): boolean {
  if (!ip || typeof ip !== 'string') return false;
  const trimmed = ip.trim();

  // IPv4 check: 4 decimal octets (0-255) without leading zeroes
  const ipv4Parts = trimmed.split('.');
  if (ipv4Parts.length === 4) {
    for (const part of ipv4Parts) {
      if (!/^\d+$/.test(part)) return false;
      if (part.length > 1 && part.startsWith('0')) return false;
      const num = Number(part);
      if (num < 0 || num > 255) return false;
    }
    return true;
  }

  // IPv6 check: 16-bit hex colon groups with optional '::' compression
  if (trimmed.includes(':')) {
    if (trimmed.includes(':::')) return false;
    const doubleColons = trimmed.split('::');
    if (doubleColons.length > 2) return false;
    if (doubleColons.length === 1) {
      if (trimmed.startsWith(':') || trimmed.endsWith(':')) return false;
      const parts = trimmed.split(':');
      if (parts.length !== 8) return false;
      for (const part of parts) {
        if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return false;
      }
      return true;
    } else {
      const [left, right] = doubleColons;
      if (left.endsWith(':') || right.startsWith(':')) return false;
      if (left.startsWith(':') && left !== '') return false;
      if (right.endsWith(':') && right !== '') return false;
      const leftParts = left === '' ? [] : left.split(':');
      const rightParts = right === '' ? [] : right.split(':');
      const totalParts = leftParts.length + rightParts.length;
      if (totalParts >= 8) return false;
      for (const part of [...leftParts, ...rightParts]) {
        if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return false;
      }
      return true;
    }
  }

  return false;
}

/**
 * Strips hop-by-hop headers and untrusted incoming X-Forwarded-* headers,
 * while preserving legitimate client headers (Origin, Cookie, Authorization, Content-Type, etc.)
 */
export function filterForwardHeaders(headers: Headers): Headers {
  const forwarded = new Headers();

  const customHopByHop = new Set<string>();
  const connectionVal = headers.get('connection');
  if (connectionVal) {
    for (const part of connectionVal.split(',')) {
      const trimmed = part.trim().toLowerCase();
      if (trimmed) {
        customHopByHop.add(trimmed);
      }
    }
  }

  for (const [key, value] of headers.entries()) {
    const lowerKey = key.toLowerCase();

    // Strip standard and declared hop-by-hop headers (including host)
    if (HOP_BY_HOP_HEADERS.has(lowerKey) || customHopByHop.has(lowerKey)) {
      continue;
    }

    // Strip untrusted client X-Forwarded-* headers (including browser X-Forwarded-Client-IP)
    if (lowerKey.startsWith('x-forwarded-')) {
      continue;
    }

    // Strip untrusted client proxy identity assertion headers
    if (lowerKey === 'x-proxy-secret') {
      continue;
    }

    forwarded.set(key, value);
  }

  return forwarded;
}

/**
 * Extracts multiple Set-Cookie headers independently using standard WHATWG methods
 */
export function extractSetCookies(headers: Headers): string[] {
  const rawHeaders = headers as unknown as {
    getSetCookie?: () => string[];
    getAll?: (name: string) => string[];
  };

  if (typeof rawHeaders.getSetCookie === 'function') {
    return rawHeaders.getSetCookie();
  }

  if (typeof rawHeaders.getAll === 'function') {
    return rawHeaders.getAll('Set-Cookie');
  }

  const single = headers.get('set-cookie');
  if (single) {
    return [single];
  }

  return [];
}

/**
 * Filters upstream response headers, preserving status and multiple Set-Cookie headers
 */
export function filterResponseHeaders(upstreamHeaders: Headers): Headers {
  const responseHeaders = new Headers();

  const customHopByHop = new Set<string>();
  const connectionVal = upstreamHeaders.get('connection');
  if (connectionVal) {
    for (const part of connectionVal.split(',')) {
      const trimmed = part.trim().toLowerCase();
      if (trimmed) {
        customHopByHop.add(trimmed);
      }
    }
  }

  for (const [key, value] of upstreamHeaders.entries()) {
    const lowerKey = key.toLowerCase();

    // Set-Cookie is handled separately below to preserve multiple headers
    if (lowerKey === 'set-cookie') {
      continue;
    }

    // Strip Server header to prevent leaking upstream infrastructure details
    if (lowerKey === 'server') {
      continue;
    }

    if (HOP_BY_HOP_HEADERS.has(lowerKey) || customHopByHop.has(lowerKey)) {
      continue;
    }

    responseHeaders.set(key, value);
  }

  const setCookies = extractSetCookies(upstreamHeaders);
  for (const cookie of setCookies) {
    responseHeaders.append('set-cookie', cookie);
  }

  // Enforce API response cache isolation for all proxied API responses
  responseHeaders.set('Cache-Control', 'no-store, private');
  responseHeaders.set('Pragma', 'no-cache');

  return responseHeaders;
}

/**
 * Cloudflare Pages Function entrypoint handling all requests matching `/api/*`
 */
export const onRequest: PagesFunction<PagesEnv> = async (context) => {
  const { request, env } = context;

  // Validate BACKEND_URL binding
  const backendValidation = validateBackendUrl(env?.BACKEND_URL);
  if (!backendValidation.valid) {
    return createErrorResponse(
      502,
      'SERVICE_UNAVAILABLE',
      'The upstream service is currently unavailable. Please try again later.'
    );
  }

  let incomingUrl: URL;
  try {
    incomingUrl = new URL(request.url);
  } catch {
    return createErrorResponse(400, 'BAD_REQUEST', 'Invalid request URL.');
  }

  // Ensure request matches /api or /api/* paths only
  if (incomingUrl.pathname !== '/api' && !incomingUrl.pathname.startsWith('/api/')) {
    return createErrorResponse(404, 'NOT_FOUND', 'Not Found');
  }

  // Construct target URL on upstream origin with preserved pathname and query string
  const targetUrl = new URL(
    incomingUrl.pathname + incomingUrl.search,
    backendValidation.origin
  );

  // Security guard against path traversal escaping /api/
  if (targetUrl.pathname !== '/api' && !targetUrl.pathname.startsWith('/api/')) {
    return createErrorResponse(404, 'NOT_FOUND', 'Not Found');
  }

  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  const forwardHeaders = filterForwardHeaders(request.headers);

  // Authenticated proxy identity assertion: derive client IP from Cloudflare's trusted context
  const rawClientIp = request.headers.get('cf-connecting-ip');
  if (rawClientIp && isValidIp(rawClientIp)) {
    forwardHeaders.set('x-forwarded-client-ip', rawClientIp.trim());
  }

  // Forward the internal proxy secret if configured
  if (env?.INTERNAL_PROXY_SECRET && typeof env.INTERNAL_PROXY_SECRET === 'string') {
    forwardHeaders.set('x-proxy-secret', env.INTERNAL_PROXY_SECRET.trim());
  }

  const fetchInit: RequestInit & { duplex?: 'half' } = {
    method,
    headers: forwardHeaders,
    redirect: 'manual',
    cache: 'no-store',
  };

  if (hasBody && request.body) {
    fetchInit.body = request.body;
    fetchInit.duplex = 'half';
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(targetUrl.toString(), fetchInit);
  } catch {
    return createErrorResponse(
      502,
      'SERVICE_UNAVAILABLE',
      'The upstream service is currently unavailable. Please try again later.'
    );
  }

  // Handle null-body HTTP status codes per RFC specifications (204, 205, 304)
  const isNullBodyStatus =
    upstreamResponse.status === 204 ||
    upstreamResponse.status === 205 ||
    upstreamResponse.status === 304;

  const responseBody = isNullBodyStatus ? null : upstreamResponse.body;

  return new Response(responseBody, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: filterResponseHeaders(upstreamResponse.headers),
  });
};
