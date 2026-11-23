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
  const origin = request.headers.origin;
  const referer = request.headers.referer;

  let targetUrl: string;

  if (origin) {
    // If Origin is present, validate Origin strictly. Referer must NEVER override a mismatched Origin.
    targetUrl = Array.isArray(origin) ? origin[0] : origin;
  } else if (referer) {
    // Only use Referer when Origin is absent
    targetUrl = Array.isArray(referer) ? referer[0] : referer;
  } else {
    // Both are absent
    reply.status(403).send({
      error: {
        code: ErrorCodes.FORBIDDEN,
        message: 'Origin or Referer header required for state-changing public requests',
      },
    });
    return false;
  }

  try {
    const requestOrigin = new URL(targetUrl).origin;
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
        message: origin ? 'Untrusted Origin header' : 'Untrusted Referer header',
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
