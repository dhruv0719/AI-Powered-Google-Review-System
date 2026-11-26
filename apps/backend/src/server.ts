import Fastify, { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { getEnv } from './config/env.js';
import authPlugin from './plugins/auth.js';
import { authRoutes } from './routes/auth.routes.js';
import { tenantRoutes } from './routes/tenant.routes.js';
import { locationRoutes } from './routes/location.routes.js';
import { serviceRoutes } from './routes/service.routes.js';
import { campaignRoutes } from './routes/campaign.routes.js';
import { publicRoutes } from './routes/public.routes.js';
import { feedbackRoutes } from './routes/feedback.routes.js';
import { ErrorCodes } from '@review-system/shared';
import { AiOrchestrator } from './ai/ai_orchestrator.js';
import { sql } from 'drizzle-orm';
import { getDb } from './db/index.js';
import crypto from 'crypto';

declare module 'fastify' {
  interface FastifyRequest {
    clientIp: string;
  }
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
 * Constant-time comparison for proxy authentication secrets using SHA-256 digests
 * to prevent secret length leaking via timing differences.
 */
export function safeCompareSecret(a?: string | string[], b?: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Strict, unambiguous health endpoint exemption filter.
 * Only exact GET/HEAD requests to /health and /ready are permitted to bypass proxy assertion.
 * Resistant to path manipulation, percent-encoding, dot-segments, trailing slashes, and duplicate slashes.
 */
export function isExemptHealthRoute(method: string, rawUrl: string): boolean {
  const upperMethod = method.toUpperCase();
  if (upperMethod !== 'GET' && upperMethod !== 'HEAD') {
    return false;
  }
  const qIdx = rawUrl.indexOf('?');
  const hIdx = rawUrl.indexOf('#');
  let endIdx = rawUrl.length;
  if (qIdx !== -1) endIdx = Math.min(endIdx, qIdx);
  if (hIdx !== -1) endIdx = Math.min(endIdx, hIdx);
  const rawPath = rawUrl.slice(0, endIdx);

  if (rawPath !== '/health' && rawPath !== '/ready') {
    return false;
  }

  try {
    const parsed = new URL(rawUrl, 'http://127.0.0.1');
    const decodedPath = decodeURIComponent(parsed.pathname);
    return decodedPath === '/health' || decodedPath === '/ready';
  } catch {
    return false;
  }
}

export interface BuildServerOptions {
  rateLimitOverrides?: {
    qrGetMax?: number;
    sessionsPostMax?: number;
    feedbackPostMax?: number;
    generateDraftMax?: number;
    sessionFeedbackMax?: number;
    sessionDraftMax?: number;
    authLoginMax?: number;
    authRegisterMax?: number;
  };
  aiOrchestrator?: AiOrchestrator;
}

export function buildServer(options?: BuildServerOptions): FastifyInstance {
  const env = getEnv();
  const trustedProxies = env.TRUSTED_PROXIES.split(',').map((p) => p.trim()).filter(Boolean);

  const fastify = Fastify({
    // Scoped trust proxy configuration prevents IP spoofing from untrusted upstream networks
    trustProxy: trustedProxies.length > 0 ? trustedProxies : ['127.0.0.1', '::1'],
    bodyLimit: 65536, // 64 KB global default request body limit
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      redact: {
        paths: [
          'req.body.password',
          'req.body.feedback',
          'req.body.feedbackText',
          'req.body.customerContact',
          'req.body.feedback_text',
          'req.body.customer_contact',
          'req.headers.cookie',
          'body.password',
          'body.feedback',
          'body.feedbackText',
          'body.customerContact',
          'body.feedback_text',
          'body.customer_contact',
          'headers.cookie',
          'res.body.draft',
          'req.headers["x-proxy-secret"]',
          'req.headers.x-proxy-secret',
          'headers["x-proxy-secret"]',
          'headers.x-proxy-secret',
        ],
        censor: '[REDACTED]',
      },
    },
  });

  // Dedicated request decoration for verified client IP
  fastify.decorateRequest('clientIp', '');

  // Authenticated proxy identity assertion verification
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const incomingProxySecret = request.headers['x-proxy-secret'];
    const incomingForwardedIp = request.headers['x-forwarded-client-ip'];
    const currentEnv = getEnv();
    const configuredSecret = currentEnv.INTERNAL_PROXY_SECRET;
    const isProduction = currentEnv.NODE_ENV === 'production';

    if (configuredSecret) {
      const secretMatches = safeCompareSecret(incomingProxySecret, configuredSecret);

      if (secretMatches) {
        if (typeof incomingForwardedIp === 'string' && isValidIp(incomingForwardedIp)) {
          request.clientIp = incomingForwardedIp.trim();
          return;
        }
        request.log.warn({ ip: incomingForwardedIp }, 'Malformed forwarded client IP assertion');
        return reply.status(400).send({
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'Malformed or missing forwarded client IP assertion',
          },
        });
      }

      // Proxy secret was sent but did not match
      if (incomingProxySecret !== undefined) {
        request.log.warn('Invalid proxy secret received');
        return reply.status(403).send({
          error: {
            code: ErrorCodes.FORBIDDEN,
            message: 'Invalid proxy identity assertion',
          },
        });
      }

      // In production, reject any direct access without valid proxy assertion
      // except explicitly designated health check endpoints (/health and /ready)
      if (isProduction && !isExemptHealthRoute(request.method, request.url)) {
        request.log.warn({ method: request.method, url: request.url }, 'Direct access rejected in production without proxy identity');
        return reply.status(403).send({
          error: {
            code: ErrorCodes.FORBIDDEN,
            message: 'Direct API access without proxy identity is forbidden',
          },
        });
      }
    }

    // Default / fallback: use Fastify's socket remoteAddress (request.ip),
    // strictly ignoring any untrusted client-supplied X-Forwarded-Client-IP!
    request.clientIp = request.ip;
  });

  // Security headers
  fastify.register(fastifyHelmet, {
    contentSecurityPolicy: env.NODE_ENV === 'production',
  });

  // Rate Limiting (per-route configuration)
  fastify.register(fastifyRateLimit, {
    global: false,
  });

  // CORS: Restrict credentialed cross-origin requests to explicitly configured trusted origins
  const configuredOrigins = new Set<string>();
  if (env.PUBLIC_WEB_URL) {
    try {
      configuredOrigins.add(new URL(env.PUBLIC_WEB_URL).origin);
    } catch {
      configuredOrigins.add(env.PUBLIC_WEB_URL);
    }
  }
  // In test environment, also trust default localhost test origins
  if (env.NODE_ENV === 'test') {
    configuredOrigins.add('http://localhost');
    configuredOrigins.add('http://127.0.0.1');
  }
  if (env.ALLOWED_ORIGINS) {
    for (const rawOrigin of env.ALLOWED_ORIGINS.split(',')) {
      const trimmed = rawOrigin.trim();
      if (trimmed) {
        try {
          configuredOrigins.add(new URL(trimmed).origin);
        } catch {
          configuredOrigins.add(trimmed);
        }
      }
    }
  }

  fastify.register(fastifyCors, {
    origin: (origin, cb) => {
      // In development/test with no explicit origin (like curl/server-to-server), permit
      if (!origin) {
        cb(null, true);
        return;
      }
      try {
        const reqOrigin = new URL(origin).origin;
        if (configuredOrigins.has(reqOrigin)) {
          cb(null, true);
          return;
        }
      } catch {
        // Malformed origin
      }
      // When origin is untrusted, return false (do not set Access-Control-Allow-Origin).
      // Returning false instead of an Error allows downstream preHandlers (like CSRF validators)
      // to handle the request with proper 403 status codes instead of throwing unhandled 500s.
      cb(null, false);
    },
    credentials: true,
  });

  // Cookie handling
  fastify.register(fastifyCookie, {
    secret: env.SESSION_SECRET,
  });

  // Auth context plugin
  fastify.register(authPlugin);

  // Liveness check (process-level liveness, does not depend on external services)
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Readiness check (verifies application can serve requests, including database connectivity)
  fastify.get('/ready', async (_request, reply) => {
    try {
      const db = getDb();
      await db.execute(sql`SELECT 1`);
      return reply.status(200).send({
        status: 'ready',
        database: 'connected',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      _request.log.error(err, 'Readiness check failed');
      return reply.status(503).send({
        status: 'not_ready',
        database: 'disconnected',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Routes
  fastify.register(authRoutes, {
    prefix: '/api/v1/auth',
    rateLimitOverrides: {
      loginMax: options?.rateLimitOverrides?.authLoginMax,
      registerMax: options?.rateLimitOverrides?.authRegisterMax,
    },
  });
  fastify.register(tenantRoutes, { prefix: '/api/v1/owner/tenants' });
  fastify.register(locationRoutes, { prefix: '/api/v1/owner/tenants' });
  fastify.register(serviceRoutes, { prefix: '/api/v1/owner/tenants' });
  fastify.register(campaignRoutes, { prefix: '/api/v1/owner/tenants' });
  fastify.register(feedbackRoutes, { prefix: '/api/v1/owner/tenants' });
  fastify.register(publicRoutes, {
    prefix: '/api/v1/public',
    rateLimitOverrides: options?.rateLimitOverrides,
    aiOrchestrator: options?.aiOrchestrator,
  });

  // Centralized Error Handler
  fastify.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    request.log.error(error);

    const statusCode = error.statusCode || (reply.statusCode >= 400 && reply.statusCode < 500 ? reply.statusCode : 500);

    // If rate limit error (429)
    if (statusCode === 429) {
      return reply.status(429).send({
        error: {
          code: ErrorCodes.RATE_LIMITED,
          message: error.message || 'Too many requests. Please try again later.',
        },
      });
    }

    // If client error (4xx)
    if (statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        error: {
          code: error.code || ErrorCodes.VALIDATION_ERROR,
          message: error.message,
        },
      });
    }

    // Default safe internal error without leaking stack or DB details
    return reply.status(500).send({
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'An unexpected internal error occurred. Please try again later.',
        requestId: request.id,
      },
    });
  });

  return fastify;
}
