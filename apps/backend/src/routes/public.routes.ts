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
  DraftGenerationRequestSchema,
  ErrorCodes,
  PublicQRResolutionDTO,
  PublicSessionResponseDTO,
  sanitizeBrandColor,
} from '@review-system/shared';
import { generateSessionToken, hashSessionToken, computePayloadFingerprint } from '../utils/crypto.js';
import { validatePublicOrigin } from '../utils/csrf.js';
import { getEnv } from '../config/env.js';
import { AiOrchestrator } from '../ai/ai_orchestrator.js';
import {
  AiValidationError,
  CampaignInactiveError,
  ConcurrentGenerationError,
  FeatureDisabledError,
  GoogleReviewUrlRequiredError,
  IdempotencyConflictError,
  InvalidSessionError,
  LeaseLostError,
  OutputGuardrailError,
  QuotaExceededError,
  TenantSuspendedError,
} from '../ai/session_guard.js';
import {
  AiProviderTimeoutError,
  AiProviderUnavailableError,
} from '../ai/types.js';

export interface PublicRoutesOptions {
  rateLimitOverrides?: {
    qrGetMax?: number;
    sessionsPostMax?: number;
    feedbackPostMax?: number;
    generateDraftMax?: number;
    sessionFeedbackMax?: number;
    sessionDraftMax?: number;
  };
  aiOrchestrator?: AiOrchestrator;
  sessionRateLimiter?: BoundedSessionRateLimiter;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

/**
 * High-performance, bounded in-memory rate limiter for Layer 2 customer session rate-limiting.
 * Persists session quotas across IP address rotation while bounding memory consumption (LRU eviction).
 */
export class BoundedSessionRateLimiter {
  private readonly store = new Map<string, RateLimitBucket>();
  private readonly maxKeys: number;
  private readonly windowMs: number;

  constructor(options?: { maxKeys?: number; windowMs?: number }) {
    this.maxKeys = options?.maxKeys ?? 10_000;
    this.windowMs = options?.windowMs ?? 60_000;
  }

  public checkAndIncrement(
    key: string,
    limit: number
  ): { allowed: boolean; retryAfterSeconds: number; remaining: number } {
    if (limit <= 0) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(this.windowMs / 1000),
        remaining: 0,
      };
    }

    const now = Date.now();
    const entry = this.store.get(key);

    if (entry && now < entry.resetAt) {
      if (entry.count >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
          remaining: 0,
        };
      }
      entry.count += 1;
      return {
        allowed: true,
        retryAfterSeconds: 0,
        remaining: limit - entry.count,
      };
    }

    if (this.store.size >= this.maxKeys && !this.store.has(key)) {
      this.evict();
    }

    this.store.set(key, {
      count: 1,
      resetAt: now + this.windowMs,
    });

    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: limit - 1,
    };
  }

  private evict(): void {
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (now >= v.resetAt) {
        this.store.delete(k);
      }
    }
    if (this.store.size >= this.maxKeys) {
      const toDelete = Math.max(1, Math.floor(this.maxKeys * 0.1));
      let count = 0;
      for (const k of this.store.keys()) {
        this.store.delete(k);
        count++;
        if (count >= toDelete) break;
      }
    }
  }

  public clear(): void {
    this.store.clear();
  }

  public get size(): number {
    return this.store.size;
  }
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
  const generateDraftMax = opts?.rateLimitOverrides?.generateDraftMax ?? (isTest ? 1000 : 10);
  const sessionFeedbackMax =
    opts?.rateLimitOverrides?.sessionFeedbackMax ??
    opts?.rateLimitOverrides?.feedbackPostMax ??
    (isTest ? 1000 : 5);
  const sessionDraftMax =
    opts?.rateLimitOverrides?.sessionDraftMax ??
    opts?.rateLimitOverrides?.generateDraftMax ??
    (isTest ? 1000 : 5);
  const sessionRateLimiter = opts?.sessionRateLimiter ?? new BoundedSessionRateLimiter();
  const aiOrchestrator = opts?.aiOrchestrator ?? new AiOrchestrator();

  // 1. Read-only Public QR Resolution (ZERO writes, ZERO session generation)
  fastify.get(
    '/qr/:code',
    {
      config: {
        rateLimit: {
          max: qrGetMax,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => `qr:ip:${req.clientIp}`,
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
          brandColor: sanitizeBrandColor(tenant.brandColor),
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
          keyGenerator: (req: FastifyRequest) => `sessions:ip:${req.clientIp}`,
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
        domain: env.COOKIE_DOMAIN,
        maxAge: CustomerSessionConstants.SESSION_TTL_MINUTES * 60,
      });

      const response: PublicSessionResponseDTO = {
        expiresAt: txResult.session.expiresAt.toISOString(),
      };
      return reply.status(201).send(response);
    }
  );

  // 3. Isolated Private Customer Feedback Submission
  fastify.post<{ Params: { code: string } }>(
    '/qr/:code/feedback',
    {
      bodyLimit: 16384, // 16 KB payload ceiling protects against payload stuffing / memory exhaustion
      config: {
        rateLimit: {
          max: feedbackPostMax,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => `feedback:ip:${req.clientIp}`,
        },
      },
      preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
        const rawToken = request.cookies?.[CustomerSessionConstants.COOKIE_NAME];
        if (rawToken) {
          const tokenHash = hashSessionToken(rawToken);
          const check = sessionRateLimiter.checkAndIncrement(
            `session:feedback:${tokenHash}`,
            sessionFeedbackMax
          );
          if (!check.allowed) {
            reply.header('Retry-After', check.retryAfterSeconds);
            return reply.status(429).send({
              error: {
                code: ErrorCodes.RATE_LIMITED,
                message: 'Too many requests for this session. Please try again later.',
              },
            });
          }
        }
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

        // Verify session was issued under the matching code
        if (session.issuedCode !== code) {
          return {
            errorStatus: 401,
            errorCode: ErrorCodes.INVALID_SESSION,
            message: 'Session does not match this campaign code',
          };
        }

        // 1. Cross-Session & Within-Session Idempotency Check by (campaignId, clientSubmissionId)
        if (body.clientSubmissionId) {
          const [existingFeedback] = await tx
            .select({
              id: privateFeedback.id,
              campaignId: privateFeedback.campaignId,
              clientSubmissionId: privateFeedback.clientSubmissionId,
              payloadFingerprint: privateFeedback.payloadFingerprint,
            })
            .from(privateFeedback)
            .where(
              and(
                eq(privateFeedback.campaignId, session.campaignId),
                eq(privateFeedback.clientSubmissionId, body.clientSubmissionId)
              )
            )
            .limit(1);

          if (existingFeedback) {
            const incomingFingerprint = computePayloadFingerprint(body);
            if (existingFeedback.payloadFingerprint === incomingFingerprint) {
              // Identical submission ID + identical fingerprint -> idempotent replay
              if (!session.feedbackSubmittedAt) {
                await tx
                  .update(ephemeralSessions)
                  .set({ feedbackSubmittedAt: new Date() })
                  .where(eq(ephemeralSessions.id, session.id));
              }
              return { feedback: existingFeedback, isReplay: true };
            } else {
              // Identical submission ID + different fingerprint -> validation error
              return {
                errorStatus: 400,
                errorCode: ErrorCodes.VALIDATION_ERROR,
                message: 'Submission ID already used with different feedback parameters',
              };
            }
          }
        }

        // 2. One-feedback-per-session rule: If session already submitted with a different (or missing) ID
        if (session.feedbackSubmittedAt) {
          return {
            errorStatus: 409,
            errorCode: ErrorCodes.ALREADY_SUBMITTED,
            message: 'Feedback has already been submitted for this session',
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

        const payloadFingerprint = computePayloadFingerprint(body);

        // Insert into private_feedback with onConflictDoNothing for concurrency safety
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
            clientSubmissionId: body.clientSubmissionId || null,
            payloadFingerprint,
          })
          .onConflictDoNothing()
          .returning();

        if (!newFeedback) {
          // A concurrent insert occurred for this campaign with the same clientSubmissionId or session
          if (body.clientSubmissionId) {
            const [concurrentFeedback] = await tx
              .select({
                id: privateFeedback.id,
                campaignId: privateFeedback.campaignId,
                clientSubmissionId: privateFeedback.clientSubmissionId,
                payloadFingerprint: privateFeedback.payloadFingerprint,
              })
              .from(privateFeedback)
              .where(
                and(
                  eq(privateFeedback.campaignId, session.campaignId),
                  eq(privateFeedback.clientSubmissionId, body.clientSubmissionId)
                )
              )
              .limit(1);

            if (concurrentFeedback) {
              const incomingFingerprint = computePayloadFingerprint(body);
              if (concurrentFeedback.payloadFingerprint === incomingFingerprint) {
                if (!session.feedbackSubmittedAt) {
                  await tx
                    .update(ephemeralSessions)
                    .set({ feedbackSubmittedAt: new Date() })
                    .where(eq(ephemeralSessions.id, session.id));
                }
                return { feedback: concurrentFeedback, isReplay: true };
              } else {
                return {
                  errorStatus: 400,
                  errorCode: ErrorCodes.VALIDATION_ERROR,
                  message: 'Submission ID already used with different feedback parameters',
                };
              }
            }
          }

          return {
            errorStatus: 409,
            errorCode: ErrorCodes.ALREADY_SUBMITTED,
            message: 'Feedback has already been submitted for this session',
          };
        }

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

        return { feedback: newFeedback, isReplay: false };
      });

      if (!txResult.feedback) {
        return reply.status(txResult.errorStatus || 500).send({
          error: { code: txResult.errorCode || ErrorCodes.INTERNAL_ERROR, message: txResult.message || 'Feedback submission failed' },
        });
      }

      return reply.status(txResult.isReplay ? 200 : 201).send({
        success: true,
        feedbackId: txResult.feedback.id,
        message: 'Thank you for your feedback!',
      });
    }
  );

  // Helper for centralized AI error mapping without leaking internal prompts, traces, or database errors
  function mapAiOrchestratorError(
    err: unknown,
    request: FastifyRequest,
    reply: FastifyReply
  ): FastifyReply {
    if (err instanceof FeatureDisabledError) {
      return reply.status(503).send({
        error: {
          code: ErrorCodes.FEATURE_DISABLED,
          message: 'AI review assistant is currently disabled.',
        },
      });
    }

    if (err instanceof InvalidSessionError) {
      return reply.status(401).send({
        error: {
          code: ErrorCodes.INVALID_SESSION,
          message: 'Session has expired or is invalid. Please refresh the page.',
        },
      });
    }

    if (err instanceof TenantSuspendedError) {
      return reply.status(403).send({
        error: {
          code: ErrorCodes.TENANT_SUSPENDED,
          message: 'This business is currently unavailable.',
        },
      });
    }

    if (err instanceof CampaignInactiveError) {
      return reply.status(400).send({
        error: {
          code: ErrorCodes.CAMPAIGN_INACTIVE,
          message: 'This review campaign is currently inactive.',
        },
      });
    }

    if (err instanceof GoogleReviewUrlRequiredError) {
      return reply.status(400).send({
        error: {
          code: ErrorCodes.GOOGLE_REVIEW_URL_REQUIRED,
          message: 'A valid Google Review URL must be configured for this location.',
        },
      });
    }

    if (err instanceof AiValidationError) {
      return reply.status(400).send({
        error: {
          code: ErrorCodes.VALIDATION_ERROR,
          message: err.message,
        },
      });
    }

    if (err instanceof IdempotencyConflictError) {
      return reply.status(409).send({
        error: {
          code: ErrorCodes.IDEMPOTENCY_KEY_REUSE_PAYLOAD_MISMATCH,
          message: 'Client draft ID was already submitted with different input parameters',
        },
      });
    }

    if (err instanceof ConcurrentGenerationError || err instanceof LeaseLostError) {
      return reply.status(409).send({
        error: {
          code: ErrorCodes.CONCURRENT_GENERATION_IN_PROGRESS,
          message: 'A review draft generation is already in progress for this session',
        },
      });
    }

    if (err instanceof QuotaExceededError) {
      return reply.status(429).send({
        error: {
          code: ErrorCodes.QUOTA_EXCEEDED,
          message: 'Draft generation quota exceeded for this session',
        },
      });
    }

    if (err instanceof OutputGuardrailError) {
      request.log.warn({ reasonCode: err.reasonCode }, 'Output guardrail rejected AI draft');
      return reply.status(502).send({
        error: {
          code: ErrorCodes.OUTPUT_GUARDRAIL_FAILED,
          message: 'The generated draft did not meet quality or safety standards. Please try adjusting your feedback.',
        },
      });
    }

    if (
      err instanceof AiProviderTimeoutError ||
      (err instanceof Error && err.name === 'AbortError')
    ) {
      request.log.warn({ err }, 'AI provider timed out');
      return reply.status(504).send({
        error: {
          code: ErrorCodes.AI_PROVIDER_UNAVAILABLE,
          message: 'AI generation service timed out. Please try again later.',
        },
      });
    }

    if (err instanceof AiProviderUnavailableError) {
      request.log.warn({ err, retryAfter: err.retryAfterSeconds }, 'AI provider unavailable');
      if (err.retryAfterSeconds) {
        reply.header('Retry-After', String(err.retryAfterSeconds));
      }
      return reply.status(502).send({
        error: {
          code: ErrorCodes.AI_PROVIDER_UNAVAILABLE,
          message: 'AI generation service is temporarily unavailable. Please try again later.',
        },
      });
    }

    // Unexpected internal errors: log detailed error, but never expose stack trace or DB details to client
    request.log.error(err);
    return reply.status(500).send({
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'An unexpected internal error occurred. Please try again later.',
        requestId: request.id,
      },
    });
  }

  // 4. Public AI Review Draft Generation
  fastify.post<{ Params: { code: string } }>(
    '/qr/:code/generate-draft',
    {
      bodyLimit: 16384, // 16 KB strict route-specific body limit
      config: {
        rateLimit: {
          max: generateDraftMax,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => `draft:ip:${req.clientIp}`,
        },
      },
      preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
        const rawToken = request.cookies?.[CustomerSessionConstants.COOKIE_NAME];
        if (rawToken) {
          const tokenHash = hashSessionToken(rawToken);
          const check = sessionRateLimiter.checkAndIncrement(
            `session:draft:${tokenHash}`,
            sessionDraftMax
          );
          if (!check.allowed) {
            reply.header('Retry-After', check.retryAfterSeconds);
            return reply.status(429).send({
              error: {
                code: ErrorCodes.RATE_LIMITED,
                message: 'Too many requests for this session. Please try again later.',
              },
            });
          }
        }
      },
    },
    async (
      request: FastifyRequest<{ Params: { code: string } }>,
      reply: FastifyReply
    ) => {
      // 1. CSRF Origin validation
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

      // 2. Transport schema validation
      const parseResult = DraftGenerationRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'Invalid draft generation request',
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

      // 3. Authenticate customer session via token hash
      const [session] = await db
        .select()
        .from(ephemeralSessions)
        .where(eq(ephemeralSessions.tokenHash, tokenHash))
        .limit(1);

      if (!session) {
        return reply.status(401).send({
          error: {
            code: ErrorCodes.INVALID_SESSION,
            message: 'Invalid or expired session',
          },
        });
      }

      if (new Date(session.expiresAt) <= new Date()) {
        return reply.status(401).send({
          error: {
            code: ErrorCodes.INVALID_SESSION,
            message: 'Session has expired. Please refresh the page.',
          },
        });
      }

      // 4. Verify session binding to issued campaign code
      if (session.issuedCode !== code) {
        return reply.status(401).send({
          error: {
            code: ErrorCodes.INVALID_SESSION,
            message: 'Session does not match this campaign code',
          },
        });
      }

      // 5. Delegate to AiOrchestrator (handles validity, locks, provider, guardrails, settlement)
      try {
        const result = await aiOrchestrator.generateDraft(db, session.id, body);
        return reply.status(200).send(result);
      } catch (err) {
        return mapAiOrchestratorError(err, request, reply);
      }
    }
  );
};
