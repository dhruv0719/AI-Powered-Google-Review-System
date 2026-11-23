import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  privateFeedback,
  privateFeedbackServices,
  locations,
} from '../drizzle/schema.js';
import {
  FeedbackQuerySchema,
  UpdateFeedbackStatusSchema,
  ErrorCodes,
  FeedbackListResponseDTO,
  PrivateFeedbackDTO,
  FeedbackStatus,
} from '@review-system/shared';
import { requireAuth } from '../plugins/auth.js';
import { verifyTenantOwner } from '../utils/tenant_auth.js';

export const feedbackRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.addHook('preHandler', requireAuth);

  // 1. List private feedback for tenant (paginated, with location and status filters)
  fastify.get(
    '/:tenantId/feedback',
    async (
      request: FastifyRequest<{
        Params: { tenantId: string };
        Querystring: {
          locationId?: string;
          status?: 'new' | 'reviewed' | 'archived' | 'all';
          page?: string | number;
          limit?: string | number;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { tenantId } = request.params;
      const db = getDb();
      const userId = request.user!.id;

      const ownerCtx = await verifyTenantOwner(db, userId, tenantId, reply);
      if (!ownerCtx) return;

      const queryParse = FeedbackQuerySchema.safeParse(request.query);
      if (!queryParse.success) {
        return reply.status(400).send({
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'Invalid feedback query parameters',
            details: queryParse.error.issues.map((i) => ({
              field: i.path.join('.'),
              issue: i.message,
            })),
          },
        });
      }

      const { locationId, status, page = 1, limit = 20 } = queryParse.data;

      // Build where conditions
      const conditions = [eq(privateFeedback.tenantId, tenantId)];

      if (locationId) {
        conditions.push(eq(privateFeedback.locationId, locationId));
      }

      if (status && status !== 'all') {
        conditions.push(eq(privateFeedback.status, status));
      }

      const whereClause = and(...conditions);

      // Count total
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(privateFeedback)
        .where(whereClause);

      const total = countResult?.count || 0;
      const offset = (page - 1) * limit;

      // Select feedback rows ordered by creation desc, id desc
      const rows = await db
        .select()
        .from(privateFeedback)
        .where(whereClause)
        .orderBy(desc(privateFeedback.createdAt), desc(privateFeedback.id))
        .limit(limit)
        .offset(offset);

      if (rows.length === 0) {
        const response: FeedbackListResponseDTO = {
          feedback: [],
          pagination: { page, limit, total },
        };
        return reply.status(200).send(response);
      }

      // Fetch snapshotted services for all retrieved feedback items
      const feedbackIds = rows.map((r) => r.id);
      const serviceRows = await db
        .select({
          feedbackId: privateFeedbackServices.feedbackId,
          serviceId: privateFeedbackServices.serviceId,
          serviceName: privateFeedbackServices.serviceNameSnapshot,
        })
        .from(privateFeedbackServices)
        .where(inArray(privateFeedbackServices.feedbackId, feedbackIds));

      const serviceMap: Record<string, Array<{ serviceId: string; name: string }>> = {};
      for (const s of serviceRows) {
        if (!serviceMap[s.feedbackId]) {
          serviceMap[s.feedbackId] = [];
        }
        serviceMap[s.feedbackId].push({
          serviceId: s.serviceId,
          name: s.serviceName,
        });
      }

      const feedbackDtos: PrivateFeedbackDTO[] = rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        locationId: r.locationId,
        campaignId: r.campaignId,
        rating: r.rating,
        feedbackText: r.feedbackText,
        customerContact: r.customerContact,
        consentGiven: r.consentGiven,
        consentAt: r.consentAt.toISOString(),
        consentVersion: r.consentVersion,
        status: r.status as FeedbackStatus,
        services: serviceMap[r.id] || [],
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      }));

      const response: FeedbackListResponseDTO = {
        feedback: feedbackDtos,
        pagination: {
          page,
          limit,
          total,
        },
      };

      return reply.status(200).send(response);
    }
  );

  // 2. Update feedback status (reviewed or archived)
  fastify.patch(
    '/:tenantId/feedback/:feedbackId',
    async (
      request: FastifyRequest<{
        Params: { tenantId: string; feedbackId: string };
      }>,
      reply: FastifyReply
    ) => {
      const { tenantId, feedbackId } = request.params;
      const db = getDb();
      const userId = request.user!.id;

      const ownerCtx = await verifyTenantOwner(db, userId, tenantId, reply);
      if (!ownerCtx) return;

      const parseResult = UpdateFeedbackStatusSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'Invalid feedback status update',
            details: parseResult.error.issues.map((i) => ({
              field: i.path.join('.'),
              issue: i.message,
            })),
          },
        });
      }

      const targetStatus = parseResult.data.status;

      const [existing] = await db
        .select()
        .from(privateFeedback)
        .where(and(eq(privateFeedback.id, feedbackId), eq(privateFeedback.tenantId, tenantId)))
        .limit(1);

      if (!existing) {
        return reply.status(404).send({
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'Feedback record not found',
          },
        });
      }

      // Invariant check: Cannot reopen an archived feedback
      if (existing.status === 'archived' && targetStatus !== 'archived') {
        return reply.status(400).send({
          error: {
            code: ErrorCodes.INVALID_STATUS_TRANSITION,
            message: 'Archived feedback cannot be reopened or modified',
          },
        });
      }

      const [updated] = await db
        .update(privateFeedback)
        .set({
          status: targetStatus,
          updatedAt: new Date(),
        })
        .where(eq(privateFeedback.id, feedbackId))
        .returning();

      // Fetch snapshotted services
      const serviceRows = await db
        .select({
          serviceId: privateFeedbackServices.serviceId,
          serviceName: privateFeedbackServices.serviceNameSnapshot,
        })
        .from(privateFeedbackServices)
        .where(eq(privateFeedbackServices.feedbackId, feedbackId));

      const dto: PrivateFeedbackDTO = {
        id: updated.id,
        tenantId: updated.tenantId,
        locationId: updated.locationId,
        campaignId: updated.campaignId,
        rating: updated.rating,
        feedbackText: updated.feedbackText,
        customerContact: updated.customerContact,
        consentGiven: updated.consentGiven,
        consentAt: updated.consentAt.toISOString(),
        consentVersion: updated.consentVersion,
        status: updated.status as FeedbackStatus,
        services: serviceRows.map((s) => ({ serviceId: s.serviceId, name: s.serviceName })),
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };

      return reply.status(200).send(dto);
    }
  );
};
