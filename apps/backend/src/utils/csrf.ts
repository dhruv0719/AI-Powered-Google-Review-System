import { FastifyRequest, FastifyReply } from 'fastify';
import { getEnv } from '../config/env.js';
import { ErrorCodes } from '@review-system/shared';

/**
 * Validates Origin or Referer header for state-changing public endpoints.
 * - Rejects requests where BOTH Origin and Referer are absent with 403.
 * - Matches against the canonical PUBLIC_WEB_URL origin.
 * - In non-production (test/dev), also accepts localhost origin variations.
 */
export function validatePublicOrigin(request: FastifyRequest, reply: FastifyReply): boolean {
  const env = getEnv();
  const originHeader = request.headers.origin || request.headers.referer;

  if (!originHeader) {
    reply.status(403).send({
      error: {
        code: ErrorCodes.FORBIDDEN,
        message: 'Origin or Referer header required for state-changing public requests',
      },
    });
    return false;
  }

  try {
    const rawHeader = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    const requestOrigin = new URL(rawHeader).origin;
    const canonicalOrigin = new URL(env.PUBLIC_WEB_URL).origin;

    if (requestOrigin === canonicalOrigin) {
      return true;
    }

    // In non-production, permit localhost/127.0.0.1 origins
    if (env.NODE_ENV !== 'production') {
      const parsedReq = new URL(requestOrigin);
      const parsedCanonical = new URL(canonicalOrigin);
      const isLocalHost = (host: string) => host === 'localhost' || host === '127.0.0.1';

      if (isLocalHost(parsedReq.hostname) && isLocalHost(parsedCanonical.hostname)) {
        return true;
      }
    }

    reply.status(403).send({
      error: {
        code: ErrorCodes.FORBIDDEN,
        message: 'Untrusted Origin or Referer header',
      },
    });
    return false;
  } catch {
    reply.status(403).send({
      error: {
        code: ErrorCodes.FORBIDDEN,
        message: 'Invalid Origin or Referer header',
      },
    });
    return false;
  }
}
