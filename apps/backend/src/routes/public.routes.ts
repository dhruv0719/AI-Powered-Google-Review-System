import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { eq, and, gt, sql, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  qrCampaigns,
  locations,
  tenants,
  services,
  ephemeralSessions,
  privateFeedback,
  privateFeedbackServices,
} from '../drizzle/schema.js';
import {
  CampaignCodeSchema,
  CreatePrivateFeedbackSchema,
  CustomerSessionConstants,
  ErrorCodes,
  PublicQRResolutionDTO,
  PublicSessionResponseDTO,
} from '@review-system/shared';
import { generateSessionToken, hashSessionToken } from '../utils/crypto.js';
import { validatePublicOrigin } from '../utils/csrf.js';
import { getEnv } from '../config/env.js';

export interface PublicRoutesOptions {
  rateLimitOverrides?: {
    qrGetMax?: number;
    sessionsPostMax?: number;
    feedbackPostMax?: number;
  };
}

export const publicRoutes: FastifyPluginAsync<PublicRoutesOptions> = async (
  fastify: FastifyInstance,
  opts?: PublicRoutesOptions
) => {
  const env = getEnv();
  const isTest = env.NODE_ENV === 'test';

  const qrGetMax = opts?.rateLimitOverrides?.qrGetMax ?? (isTest ? 1000 : 120);
  const sessionsPostMax = opts?.rateLimitOverrides?.sessionsPostMax ?? (isTest ? 1000 : 30);
  const feedbackPostMax = opts?.rateLimitOverrides?.feedbackPostMax ?? (isTest ? 1000 : 10);

  // 1. Read-only Public QR Resolution (ZERO writes, ZERO session generation)
  fastify.get(
    '/qr/:code',
    {
      config: {
        rateLimit: {
          max: qrGetMax,
          timeWindow: '1 minute',
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { code: string } }>,
      reply: FastifyReply
    ) => {
      const { code } = request.params;
      const codeParse = CampaignCodeSchema.safeParse(code);
      if (!codeParse.success) {
        return reply.status(404).send({
          error: {
            code: ErrorCodes.CAMPAIGN_NOT_FOUND,
            message: 'Invalid or expired QR code',
          },
        });
      }

      const db = getDb();

      // Look up campaign by code
      const [campaign] = await db
        .select()
        .from(qrCampaigns)
        .where(eq(qrCampaigns.code, code))
        .limit(1);

      if (!campaign) {
        return reply.status(404).send({
          error: {
            code: ErrorCodes.CAMPAIGN_NOT_FOUND,
            message: 'Invalid or expired QR code',
          },
        });
      }

      if (campaign.status !== 'active') {
        return reply.status(400).send({
          error: {
            code: ErrorCodes.CAMPAIGN_INACTIVE,
            message: 'This review campaign is currently inactive.',
          },
        });
      }

      // Look up location
      const [location] = await db
        .select()
        .from(locations)
        .where(and(eq(locations.id, campaign.locationId), eq(locations.tenantId, campaign.tenantId)))
        .limit(1);

      if (!location || !location.isActive) {
        return reply.status(400).send({
          error: {
            code: ErrorCodes.CAMPAIGN_INACTIVE,
            message: 'This review campaign is currently inactive.',
          },
        });
      }

      if (!location.googleReviewUrl || location.googleReviewUrl.trim() === '') {
        return reply.status(400).send({
          error: {
            code: ErrorCodes.SERVICE_UNAVAILABLE,
            message: 'This review service is currently unavailable.',
          },
        });
      }

      // Look up tenant
      const [tenant] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, campaign.tenantId))
        .limit(1);

      if (!tenant || tenant.status !== 'active') {
        return reply.status(403).send({
          error: {
            code: ErrorCodes.TENANT_SUSPENDED,
            message: 'This service is currently unavailable.',
          },
        });
      }

      // Fetch active services for this location
      const activeServices = await db
        .select({
          id: services.id,
          name: services.name,
        })
        .from(services)
        .where(
          and(
            eq(services.tenantId, campaign.tenantId),
            eq(services.locationId, campaign.locationId),
            eq(services.isActive, true)
          )
        )
        .orderBy(services.displayOrder, services.name);

      const response: PublicQRResolutionDTO = {
        tenant: {
          displayName: tenant.displayName,
        },
        location: {
          name: location.name,
          address: location.address,
          city: location.city,
          googleReviewUrl: location.googleReviewUrl,
        },
        services: activeServices,
      };

      return reply.status(200).send(response);
    }
  );

  // 2. Explicit Ephemeral Customer Session Creation
  fastify.post(
    '/qr/:code/sessions',
    {
      config: {
        rateLimit: {
          max: sessionsPostMax,
          timeWindow: '1 minute',
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { code: string } }>,
      reply: FastifyReply
    ) => {
      // CSRF Origin validation
      if (!validatePublicOrigin(request, reply)) {
        return;
      }

      const { code } = request.params;
      const codeParse = CampaignCodeSchema.safeParse(code);
      if (!codeParse.success) {
        return reply.status(404).send({
          error: {
            code: ErrorCodes.CAMPAIGN_NOT_FOUND,
            message: 'Invalid or expired QR code',
          },
        });
      }

      const db = getDb();
      const env = getEnv();

      // Check if client already has a valid, unexpired, unsubmitted session for this exact campaign code
      const existingCookie = request.cookies[CustomerSessionConstants.COOKIE_NAME];
      if (existingCookie) {
        const tokenHash = hashSessionToken(existingCookie);
        const [existingSession] = await db
          .select()
          .from(ephemeralSessions)
          .where(
            and(
              eq(ephemeralSessions.tokenHash, tokenHash),
              eq(ephemeralSessions.issuedCode, code),
              gt(ephemeralSessions.expiresAt, new Date())
            )
          )
          .limit(1);

        if (existingSession && !existingSession.feedbackSubmittedAt) {
          const res: PublicSessionResponseDTO = {
            expiresAt: existingSession.expiresAt.toISOString(),
          };
          return reply.status(200).send(res);
        }
      }

      // Session issuance transaction with Canonical Locks: tenant -> location -> qrCampaigns
      const txResult = await db.transaction(async (tx: any) => {
        // Find campaign candidate
        const [candidate] = await tx
          .select()
          .from(qrCampaigns)
          .where(eq(qrCampaigns.code, code))
          .limit(1);

        if (!candidate) {
          return {
            errorStatus: 404,
            errorCode: ErrorCodes.CAMPAIGN_NOT_FOUND,
            message: 'Invalid or expired QR code',
          };
        }

        // Canonical Locks
        await tx.execute(sql`SELECT id FROM tenants WHERE id = ${candidate.tenantId} FOR SHARE`);
        await tx.execute(sql`SELECT id FROM locations WHERE id = ${candidate.locationId} FOR SHARE`);
        await tx.execute(sql`SELECT id FROM qr_campaigns WHERE id = ${candidate.id} FOR SHARE`);

        const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, candidate.tenantId)).limit(1);
        if (!tenant || tenant.status !== 'active') {
          return {
            errorStatus: 403,
            errorCode: ErrorCodes.TENANT_SUSPENDED,
            message: 'This service is currently unavailable.',
          };
        }

        const [loc] = await tx.select().from(locations).where(eq(locations.id, candidate.locationId)).limit(1);
        if (!loc || !loc.isActive) {
          return {
            errorStatus: 400,
            errorCode: ErrorCodes.CAMPAIGN_INACTIVE,
            message: 'This review campaign is currently inactive.',
          };
        }
        if (!loc.googleReviewUrl || loc.googleReviewUrl.trim() === '') {
          return {
            errorStatus: 400,
            errorCode: ErrorCodes.SERVICE_UNAVAILABLE,
            message: 'This review service is currently unavailable.',
          };
        }

        const [campaign] = await tx.select().from(qrCampaigns).where(eq(qrCampaigns.id, candidate.id)).limit(1);
        if (!campaign || campaign.status !== 'active' || campaign.code !== code) {
          return {
            errorStatus: 400,
            errorCode: ErrorCodes.CAMPAIGN_INACTIVE,
            message: 'This review campaign is currently inactive.',
          };
        }

        // Generate 256-bit cryptographically secure session token
        const rawToken = generateSessionToken();
        const tokenHash = hashSessionToken(rawToken);
        const expiresAt = new Date(Date.now() + CustomerSessionConstants.SESSION_TTL_MS);

        const [newSession] = await tx
          .insert(ephemeralSessions)
          .values({
            tenantId: candidate.tenantId,
            locationId: candidate.locationId,
            campaignId: candidate.id,
            tokenHash,
            issuedCode: code,
            expiresAt,
          })
          .returning();

        return { session: newSession, rawToken };
      });

      if (!txResult.session || !txResult.rawToken) {
        return reply.status(txResult.errorStatus || 500).send({
          error: { code: txResult.errorCode || ErrorCodes.INTERNAL_ERROR, message: txResult.message || 'Session issuance failed' },
        });
      }

      // Set Path-scoped HttpOnly cookie
      reply.setCookie(CustomerSessionConstants.COOKIE_NAME, txResult.rawToken, {
        path: `/api/v1/public/qr/${code}`,
        httpOnly: true,
        secure: env.COOKIE_SECURE,
        sameSite: 'lax',
        maxAge: CustomerSessionConstants.SESSION_TTL_MINUTES * 60,
      });

      const response: PublicSessionResponseDTO = {
        expiresAt: txResult.session.expiresAt.toISOString(),
      };
      return reply.status(201).send(response);
    }
  );

  // 3. Isolated Private Customer Feedback Submission
  fastify.post(
    '/qr/:code/feedback',
    {
      bodyLimit: 16384, // 16 KB payload ceiling protects against payload stuffing / memory exhaustion
      config: {
        rateLimit: {
          max: feedbackPostMax,
          timeWindow: '1 minute',
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: { code: string } }>,
      reply: FastifyReply
    ) => {
      // CSRF Origin validation
      if (!validatePublicOrigin(request, reply)) {
        return;
      }

      const { code } = request.params;
      const rawToken = request.cookies[CustomerSessionConstants.COOKIE_NAME];
      if (!rawToken) {
        return reply.status(401).send({
          error: {
            code: ErrorCodes.INVALID_SESSION,
            message: 'Customer session cookie missing or expired. Please interact with the page to start a new session.',
          },
        });
      }

      const parseResult = CreatePrivateFeedbackSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'Invalid feedback data',
            details: parseResult.error.issues.map((i) => ({
              field: i.path.join('.'),
              issue: i.message,
            })),
          },
        });
      }

      const body = parseResult.data;
      const db = getDb();
      const tokenHash = hashSessionToken(rawToken);

      const txResult = await db.transaction(async (tx: any) => {
        // Canonical Lock: Acquire FOR UPDATE on the ephemeral session
        await tx.execute(sql`SELECT id FROM ephemeral_sessions WHERE token_hash = ${tokenHash} FOR UPDATE`);
        const [session] = await tx
          .select()
          .from(ephemeralSessions)
          .where(eq(ephemeralSessions.tokenHash, tokenHash))
          .limit(1);

        if (!session) {
          return {
            errorStatus: 401,
            errorCode: ErrorCodes.INVALID_SESSION,
            message: 'Invalid or expired session',
          };
        }

        if (new Date(session.expiresAt) <= new Date()) {
          return {
            errorStatus: 401,
            errorCode: ErrorCodes.INVALID_SESSION,
            message: 'Session has expired. Please refresh the page.',
          };
        }

        if (session.feedbackSubmittedAt) {
          return {
            errorStatus: 409,
            errorCode: ErrorCodes.ALREADY_SUBMITTED,
            message: 'Feedback has already been submitted for this session',
          };
        }

        // Verify session was issued under the matching code
        if (session.issuedCode !== code) {
          return {
            errorStatus: 401,
            errorCode: ErrorCodes.INVALID_SESSION,
            message: 'Session does not match this campaign code',
          };
        }

        // Canonical Locks: tenant -> location -> qrCampaigns
        await tx.execute(sql`SELECT id FROM tenants WHERE id = ${session.tenantId} FOR SHARE`);
        await tx.execute(sql`SELECT id FROM locations WHERE id = ${session.locationId} FOR SHARE`);
        await tx.execute(sql`SELECT id FROM qr_campaigns WHERE id = ${session.campaignId} FOR SHARE`);

        const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
        if (!tenant || tenant.status !== 'active') {
          return {
            errorStatus: 403,
            errorCode: ErrorCodes.TENANT_SUSPENDED,
            message: 'This service is currently unavailable.',
          };
        }

        const [loc] = await tx.select().from(locations).where(eq(locations.id, session.locationId)).limit(1);
        if (!loc || !loc.isActive) {
          return {
            errorStatus: 400,
            errorCode: ErrorCodes.CAMPAIGN_INACTIVE,
            message: 'This review campaign is currently inactive.',
          };
        }

        // In-flight preservation: Check that campaign is still active (even if rotated to a new current code)
        const [campaign] = await tx.select().from(qrCampaigns).where(eq(qrCampaigns.id, session.campaignId)).limit(1);
        if (!campaign || campaign.status !== 'active') {
          return {
            errorStatus: 400,
            errorCode: ErrorCodes.CAMPAIGN_INACTIVE,
            message: 'This review campaign is currently inactive.',
          };
        }

        // Validate selected services
        const selectedServices: Array<{ id: string; name: string }> = [];
        if (body.serviceIds && body.serviceIds.length > 0) {
          const uniqueServiceIds = Array.from(new Set(body.serviceIds));
          const dbServices = await tx
            .select({
              id: services.id,
              name: services.name,
            })
            .from(services)
            .where(
              and(
                eq(services.tenantId, session.tenantId),
                eq(services.locationId, session.locationId),
                eq(services.isActive, true),
                inArray(services.id, uniqueServiceIds)
              )
            );

          if (dbServices.length !== uniqueServiceIds.length) {
            return {
              errorStatus: 400,
              errorCode: ErrorCodes.INVALID_SERVICES,
              message: 'One or more selected services are invalid or inactive for this location',
            };
          }
          selectedServices.push(...dbServices);
        }

        // Insert into private_feedback
        const [newFeedback] = await tx
          .insert(privateFeedback)
          .values({
            tenantId: session.tenantId,
            locationId: session.locationId,
            campaignId: session.campaignId,
            sessionId: session.id,
            rating: body.rating,
            feedbackText: body.feedbackText || null,
            customerContact: body.customerContact || null,
            consentGiven: true,
            status: 'new',
          })
          .returning();

        // Insert into private_feedback_services with immutable serviceNameSnapshot
        for (const s of selectedServices) {
          await tx.insert(privateFeedbackServices).values({
            feedbackId: newFeedback.id,
            serviceId: s.id,
            tenantId: session.tenantId,
            locationId: session.locationId,
            serviceNameSnapshot: s.name,
          });
        }

        // Mark session submitted
        await tx
          .update(ephemeralSessions)
          .set({ feedbackSubmittedAt: new Date() })
          .where(eq(ephemeralSessions.id, session.id));

        return { feedback: newFeedback };
      });

      if (!txResult.feedback) {
        return reply.status(txResult.errorStatus || 500).send({
          error: { code: txResult.errorCode || ErrorCodes.INTERNAL_ERROR, message: txResult.message || 'Feedback submission failed' },
        });
      }

      return reply.status(201).send({
        success: true,
        feedbackId: txResult.feedback.id,
        message: 'Thank you for your feedback!',
      });
    }
  );
};
