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

export interface BuildServerOptions {
  rateLimitOverrides?: {
    qrGetMax?: number;
    sessionsPostMax?: number;
    feedbackPostMax?: number;
    generateDraftMax?: number;
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
        ],
        censor: '[REDACTED]',
      },
    },
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
  fastify.register(authRoutes, { prefix: '/api/v1/auth' });
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
