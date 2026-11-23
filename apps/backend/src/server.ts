import Fastify, { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { getEnv } from './config/env.js';
import authPlugin from './plugins/auth.js';
import { authRoutes } from './routes/auth.routes.js';
import { tenantRoutes } from './routes/tenant.routes.js';
import { locationRoutes } from './routes/location.routes.js';
import { serviceRoutes } from './routes/service.routes.js';
import { ErrorCodes } from '@review-system/shared';

export function buildServer(): FastifyInstance {
  const env = getEnv();

  const fastify = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : 'info',
      redact: {
        paths: [
          'req.body.password',
          'req.body.feedback',
          'req.body.feedback_text',
          'req.body.customer_contact',
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

  // CORS
  fastify.register(fastifyCors, {
    origin: true,
    credentials: true,
  });

  // Cookie handling
  fastify.register(fastifyCookie, {
    secret: env.SESSION_SECRET,
  });

  // Auth context plugin
  fastify.register(authPlugin);

  // Health check
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Routes
  fastify.register(authRoutes, { prefix: '/api/v1/auth' });
  fastify.register(tenantRoutes, { prefix: '/api/v1/owner/tenants' });
  fastify.register(locationRoutes, { prefix: '/api/v1/owner/tenants' });
  fastify.register(serviceRoutes, { prefix: '/api/v1/owner/tenants' });

  // Centralized Error Handler
  fastify.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    request.log.error(error);

    // If response was already customized
    if (reply.statusCode >= 400 && reply.statusCode < 500) {
      return reply.send({
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
