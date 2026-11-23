import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { qrCampaigns, locations, tenants } from '../drizzle/schema.js';
import {
  CreateCampaignSchema,
  UpdateCampaignSchema,
  ErrorCodes,
  CampaignDTO,
  CampaignStatus,
} from '@review-system/shared';
import { requireAuth } from '../plugins/auth.js';
import { verifyLocationOwnership } from '../utils/tenant_auth.js';
import {
  generateCampaignCode,
  generateQrSvg,
  generateQrPng,
  getPublicCampaignUrl,
} from '../utils/qr.js';

export const campaignRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.addHook('preHandler', requireAuth);

  // 1. List campaigns for a location
  fastify.get(
    '/:tenantId/locations/:locationId/campaigns',
    async (
      request: FastifyRequest<{ Params: { tenantId: string; locationId: string } }>,
      reply: FastifyReply
    ) => {
      const { tenantId, locationId } = request.params;
      const db = getDb();
      const userId = request.user!.id;

      const ok = await verifyLocationOwnership(db, userId, tenantId, locationId, reply);
      if (!ok) return;

      const rows = await db
        .select()
        .from(qrCampaigns)
        .where(and(eq(qrCampaigns.tenantId, tenantId), eq(qrCampaigns.locationId, locationId)))
        .orderBy(qrCampaigns.createdAt);

      const dtoList: CampaignDTO[] = rows.map((c) => ({
        id: c.id,
        tenantId: c.tenantId,
        locationId: c.locationId,
        name: c.name,
        code: c.code,
        publicUrl: getPublicCampaignUrl(c.code),
        status: c.status as CampaignStatus,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      }));

      return reply.status(200).send({ campaigns: dtoList });
    }
  );

  // 2. Create a new campaign for a location
  fastify.post(
    '/:tenantId/locations/:locationId/campaigns',
    async (
      request: FastifyRequest<{ Params: { tenantId: string; locationId: string } }>,
      reply: FastifyReply
    ) => {
      const { tenantId, locationId } = request.params;
      const db = getDb();
      const userId = request.user!.id;

      const ok = await verifyLocationOwnership(db, userId, tenantId, locationId, reply);
      if (!ok) return;

      const parseResult = CreateCampaignSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'Invalid campaign data',
            details: parseResult.error.issues.map((i) => ({
              field: i.path.join('.'),
              issue: i.message,
            })),
          },
        });
      }

      const body = parseResult.data;

      const txResult = await db.transaction(async (tx: any) => {
        // Canonical Locks: tenant -> location
        await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR SHARE`);
        await tx.execute(sql`SELECT id FROM locations WHERE id = ${locationId} FOR SHARE`);

        const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        if (!tenant || tenant.status !== 'active') {
          return { errorStatus: 403, errorCode: ErrorCodes.TENANT_SUSPENDED, message: 'This business is suspended' };
        }

        const [loc] = await tx
          .select()
          .from(locations)
          .where(and(eq(locations.id, locationId), eq(locations.tenantId, tenantId)))
          .limit(1);
        if (!loc || !loc.isActive) {
          return { errorStatus: 400, errorCode: ErrorCodes.VALIDATION_ERROR, message: 'Cannot create campaign for an inactive location' };
        }

        // Prerequisite: A valid Google Review URL must be configured
        if (!loc.googleReviewUrl || loc.googleReviewUrl.trim() === '') {
          return {
            errorStatus: 400,
            errorCode: ErrorCodes.GOOGLE_REVIEW_URL_REQUIRED,
            message: 'A valid Google Review URL must be configured for this location before creating a QR campaign.',
          };
        }

        const code = generateCampaignCode();

        const [newCampaign] = await tx
          .insert(qrCampaigns)
          .values({
            tenantId,
            locationId,
            name: body.name,
            code,
            status: 'active',
          })
          .returning();

        return { campaign: newCampaign };
      });

      if (txResult.errorStatus) {
        return reply.status(txResult.errorStatus).send({
          error: { code: txResult.errorCode, message: txResult.message },
        });
      }

      const c = txResult.campaign;
      const dto: CampaignDTO = {
        id: c.id,
        tenantId: c.tenantId,
        locationId: c.locationId,
        name: c.name,
        code: c.code,
        publicUrl: getPublicCampaignUrl(c.code),
        status: c.status as CampaignStatus,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      };

      return reply.status(201).send(dto);
    }
  );

  // 3. Get single campaign details
  fastify.get(
    '/:tenantId/locations/:locationId/campaigns/:campaignId',
    async (
      request: FastifyRequest<{ Params: { tenantId: string; locationId: string; campaignId: string } }>,
      reply: FastifyReply
    ) => {
      const { tenantId, locationId, campaignId } = request.params;
      const db = getDb();
      const userId = request.user!.id;

      const ok = await verifyLocationOwnership(db, userId, tenantId, locationId, reply);
      if (!ok) return;

      const [c] = await db
        .select()
        .from(qrCampaigns)
        .where(
          and(
            eq(qrCampaigns.id, campaignId),
            eq(qrCampaigns.tenantId, tenantId),
            eq(qrCampaigns.locationId, locationId)
          )
        )
        .limit(1);

      if (!c) {
        return reply.status(404).send({
          error: {
            code: ErrorCodes.CAMPAIGN_NOT_FOUND,
            message: 'Campaign not found or does not belong to this location',
          },
        });
      }

      const dto: CampaignDTO = {
        id: c.id,
        tenantId: c.tenantId,
        locationId: c.locationId,
        name: c.name,
        code: c.code,
        publicUrl: getPublicCampaignUrl(c.code),
        status: c.status as CampaignStatus,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      };

      return reply.status(200).send(dto);
    }
  );

  // 4. Update campaign (name or pause/resume status)
  fastify.patch(
    '/:tenantId/locations/:locationId/campaigns/:campaignId',
    async (
      request: FastifyRequest<{ Params: { tenantId: string; locationId: string; campaignId: string } }>,
      reply: FastifyReply
    ) => {
      const { tenantId, locationId, campaignId } = request.params;
      const db = getDb();
      const userId = request.user!.id;

      const ok = await verifyLocationOwnership(db, userId, tenantId, locationId, reply);
      if (!ok) return;

      const parseResult = UpdateCampaignSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'Invalid campaign update payload',
            details: parseResult.error.issues.map((i) => ({
              field: i.path.join('.'),
              issue: i.message,
            })),
          },
        });
      }

      const body = parseResult.data;

      const txResult = await db.transaction(async (tx: any) => {
        // Canonical Locks: tenant -> location -> campaign
        await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR SHARE`);
        await tx.execute(sql`SELECT id FROM locations WHERE id = ${locationId} FOR SHARE`);
        await tx.execute(sql`SELECT id FROM qr_campaigns WHERE id = ${campaignId} FOR UPDATE`);

        const [loc] = await tx
          .select()
          .from(locations)
          .where(and(eq(locations.id, locationId), eq(locations.tenantId, tenantId)))
          .limit(1);

        const [campaign] = await tx
          .select()
          .from(qrCampaigns)
          .where(
            and(
              eq(qrCampaigns.id, campaignId),
              eq(qrCampaigns.tenantId, tenantId),
              eq(qrCampaigns.locationId, locationId)
            )
          )
          .limit(1);

        if (!campaign) {
          return { errorStatus: 404, errorCode: ErrorCodes.CAMPAIGN_NOT_FOUND, message: 'Campaign not found' };
        }

        if (campaign.status === 'revoked') {
          return {
            errorStatus: 400,
            errorCode: ErrorCodes.INVALID_STATUS_TRANSITION,
            message: 'Revoked campaigns cannot be modified or reactivated.',
          };
        }

        if (body.status === 'active') {
          if (!loc || !loc.isActive) {
            return { errorStatus: 400, errorCode: ErrorCodes.VALIDATION_ERROR, message: 'Cannot activate campaign for an inactive location' };
          }
          if (!loc.googleReviewUrl || loc.googleReviewUrl.trim() === '') {
            return {
              errorStatus: 400,
              errorCode: ErrorCodes.GOOGLE_REVIEW_URL_REQUIRED,
              message: 'A valid Google Review URL is required before activating a QR campaign.',
            };
          }
        }

        const updateData: any = { updatedAt: new Date() };
        if (body.name !== undefined) updateData.name = body.name;
        if (body.status !== undefined) updateData.status = body.status;

        const [updated] = await tx
          .update(qrCampaigns)
          .set(updateData)
          .where(eq(qrCampaigns.id, campaignId))
          .returning();

        return { campaign: updated };
      });

      if (txResult.errorStatus) {
        return reply.status(txResult.errorStatus).send({
          error: { code: txResult.errorCode, message: txResult.message },
        });
      }

      const c = txResult.campaign;
      const dto: CampaignDTO = {
        id: c.id,
        tenantId: c.tenantId,
        locationId: c.locationId,
        name: c.name,
        code: c.code,
        publicUrl: getPublicCampaignUrl(c.code),
        status: c.status as CampaignStatus,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      };

      return reply.status(200).send(dto);
    }
  );

  // 5. Rotate campaign code (invalidates old code for new scans; status remains active)
  fastify.post(
    '/:tenantId/locations/:locationId/campaigns/:campaignId/rotate',
    async (
      request: FastifyRequest<{ Params: { tenantId: string; locationId: string; campaignId: string } }>,
      reply: FastifyReply
    ) => {
      const { tenantId, locationId, campaignId } = request.params;
      const db = getDb();
      const userId = request.user!.id;

      const ok = await verifyLocationOwnership(db, userId, tenantId, locationId, reply);
      if (!ok) return;

      const txResult = await db.transaction(async (tx: any) => {
        // Canonical Locks: tenant -> location -> campaign
        await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR SHARE`);
        await tx.execute(sql`SELECT id FROM locations WHERE id = ${locationId} FOR SHARE`);
        await tx.execute(sql`SELECT id FROM qr_campaigns WHERE id = ${campaignId} FOR UPDATE`);

        const [campaign] = await tx
          .select()
          .from(qrCampaigns)
          .where(
            and(
              eq(qrCampaigns.id, campaignId),
              eq(qrCampaigns.tenantId, tenantId),
              eq(qrCampaigns.locationId, locationId)
            )
          )
          .limit(1);

        if (!campaign) {
          return { errorStatus: 404, errorCode: ErrorCodes.CAMPAIGN_NOT_FOUND, message: 'Campaign not found' };
        }

        if (campaign.status === 'revoked') {
          return {
            errorStatus: 400,
            errorCode: ErrorCodes.INVALID_STATUS_TRANSITION,
            message: 'Revoked campaigns cannot be rotated.',
          };
        }

        const newCode = generateCampaignCode();

        const [updated] = await tx
          .update(qrCampaigns)
          .set({ code: newCode, updatedAt: new Date() })
          .where(eq(qrCampaigns.id, campaignId))
          .returning();

        return { campaign: updated };
      });

      if (txResult.errorStatus) {
        return reply.status(txResult.errorStatus).send({
          error: { code: txResult.errorCode, message: txResult.message },
        });
      }

      const c = txResult.campaign;
      const dto: CampaignDTO = {
        id: c.id,
        tenantId: c.tenantId,
        locationId: c.locationId,
        name: c.name,
        code: c.code,
        publicUrl: getPublicCampaignUrl(c.code),
        status: c.status as CampaignStatus,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      };

      return reply.status(200).send(dto);
    }
  );

  // 6. Revoke campaign (permanent, irreversible)
  fastify.post(
    '/:tenantId/locations/:locationId/campaigns/:campaignId/revoke',
    async (
      request: FastifyRequest<{ Params: { tenantId: string; locationId: string; campaignId: string } }>,
      reply: FastifyReply
    ) => {
      const { tenantId, locationId, campaignId } = request.params;
      const db = getDb();
      const userId = request.user!.id;

      const ok = await verifyLocationOwnership(db, userId, tenantId, locationId, reply);
      if (!ok) return;

      const txResult = await db.transaction(async (tx: any) => {
        // Canonical Locks: tenant -> location -> campaign
        await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR SHARE`);
        await tx.execute(sql`SELECT id FROM locations WHERE id = ${locationId} FOR SHARE`);
        await tx.execute(sql`SELECT id FROM qr_campaigns WHERE id = ${campaignId} FOR UPDATE`);

        const [campaign] = await tx
          .select()
          .from(qrCampaigns)
          .where(
            and(
              eq(qrCampaigns.id, campaignId),
              eq(qrCampaigns.tenantId, tenantId),
              eq(qrCampaigns.locationId, locationId)
            )
          )
          .limit(1);

        if (!campaign) {
          return { errorStatus: 404, errorCode: ErrorCodes.CAMPAIGN_NOT_FOUND, message: 'Campaign not found' };
        }

        const [updated] = await tx
          .update(qrCampaigns)
          .set({ status: 'revoked', updatedAt: new Date() })
          .where(eq(qrCampaigns.id, campaignId))
          .returning();

        return { campaign: updated };
      });

      if (txResult.errorStatus) {
        return reply.status(txResult.errorStatus).send({
          error: { code: txResult.errorCode, message: txResult.message },
        });
      }

      const c = txResult.campaign;
      const dto: CampaignDTO = {
        id: c.id,
        tenantId: c.tenantId,
        locationId: c.locationId,
        name: c.name,
        code: c.code,
        publicUrl: getPublicCampaignUrl(c.code),
        status: c.status as CampaignStatus,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      };

      return reply.status(200).send(dto);
    }
  );

  // 7. Download Printable QR Code as SVG
  fastify.get(
    '/:tenantId/locations/:locationId/campaigns/:campaignId/qr.svg',
    async (
      request: FastifyRequest<{ Params: { tenantId: string; locationId: string; campaignId: string } }>,
      reply: FastifyReply
    ) => {
      const { tenantId, locationId, campaignId } = request.params;
      const db = getDb();
      const userId = request.user!.id;

      const ok = await verifyLocationOwnership(db, userId, tenantId, locationId, reply);
      if (!ok) return;

      const [c] = await db
        .select()
        .from(qrCampaigns)
        .where(
          and(
            eq(qrCampaigns.id, campaignId),
            eq(qrCampaigns.tenantId, tenantId),
            eq(qrCampaigns.locationId, locationId)
          )
        )
        .limit(1);

      if (!c) {
        return reply.status(404).send({
          error: { code: ErrorCodes.CAMPAIGN_NOT_FOUND, message: 'Campaign not found' },
        });
      }

      const publicUrl = getPublicCampaignUrl(c.code);
      const svg = await generateQrSvg(publicUrl);
      const safeFilename = c.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'campaign';

      return reply
        .header('Content-Type', 'image/svg+xml; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="qr-${safeFilename}.svg"`)
        .send(svg);
    }
  );

  // 8. Download Printable QR Code as PNG
  fastify.get(
    '/:tenantId/locations/:locationId/campaigns/:campaignId/qr.png',
    async (
      request: FastifyRequest<{
        Params: { tenantId: string; locationId: string; campaignId: string };
        Querystring: { size?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { tenantId, locationId, campaignId } = request.params;
      const { size } = request.query;
      const db = getDb();
      const userId = request.user!.id;

      const ok = await verifyLocationOwnership(db, userId, tenantId, locationId, reply);
      if (!ok) return;

      const [c] = await db
        .select()
        .from(qrCampaigns)
        .where(
          and(
            eq(qrCampaigns.id, campaignId),
            eq(qrCampaigns.tenantId, tenantId),
            eq(qrCampaigns.locationId, locationId)
          )
        )
        .limit(1);

      if (!c) {
        return reply.status(404).send({
          error: { code: ErrorCodes.CAMPAIGN_NOT_FOUND, message: 'Campaign not found' },
        });
      }

      const requestedSize = size ? parseInt(size, 10) : 512;
      const publicUrl = getPublicCampaignUrl(c.code);
      const pngBuffer = await generateQrPng(publicUrl, requestedSize);
      const safeFilename = c.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'campaign';

      return reply
        .header('Content-Type', 'image/png')
        .header('Content-Disposition', `attachment; filename="qr-${safeFilename}.png"`)
        .send(pngBuffer);
    }
  );
};
