import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { tenants, tenantMemberships, locations, services } from '../drizzle/schema.js';
import {
  CreateServiceSchema,
  UpdateServiceSchema,
  ErrorCodes,
  ServiceDTO,
} from '@review-system/shared';
import { requireAuth } from '../plugins/auth.js';
import { verifyLocationOwnership } from '../utils/tenant_auth.js';

export const serviceRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.addHook('preHandler', requireAuth);

  // 1. List services for a location
  fastify.get(
    '/:tenantId/locations/:locationId/services',
    async (
      request: FastifyRequest<{
        Params: { tenantId: string; locationId: string };
        Querystring: { status?: 'all' | 'active' | 'inactive' };
      }>,
      reply: FastifyReply
    ) => {
      const { tenantId, locationId } = request.params;
      const { status = 'all' } = request.query;
      const db = getDb();
      const userId = request.user!.id;

      const ok = await verifyLocationOwnership(db, userId, tenantId, locationId, reply);
      if (!ok) return;

      const conditions = [
        eq(services.tenantId, tenantId),
        eq(services.locationId, locationId),
      ];

      if (status === 'active') {
        conditions.push(eq(services.isActive, true));
      } else if (status === 'inactive') {
        conditions.push(eq(services.isActive, false));
      }

      const rows = await db
        .select()
        .from(services)
        .where(and(...conditions))
        .orderBy(services.displayOrder, services.createdAt);

      const dtoList: ServiceDTO[] = rows.map((s) => ({
        id: s.id,
        tenantId: s.tenantId,
        locationId: s.locationId,
        name: s.name,
        description: s.description,
        displayOrder: s.displayOrder,
        isActive: s.isActive,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      }));

      return reply.status(200).send({ services: dtoList });
    }
  );

  // 2. Create a service for a location
  fastify.post(
    '/:tenantId/locations/:locationId/services',
    async (
      request: FastifyRequest<{ Params: { tenantId: string; locationId: string } }>,
      reply: FastifyReply
    ) => {
      const { tenantId, locationId } = request.params;
      const db = getDb();
      const userId = request.user!.id;

      const ok = await verifyLocationOwnership(db, userId, tenantId, locationId, reply);
      if (!ok) return;

      const parseResult = CreateServiceSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'Invalid service data',
            details: parseResult.error.issues.map((i) => ({
              field: i.path.join('.'),
              issue: i.message,
            })),
          },
        });
      }

      const body = parseResult.data;

      // Composite foreign key enforces (tenantId, locationId) -> locations(tenantId, id)
      const [newService] = await db
        .insert(services)
        .values({
          tenantId,
          locationId,
          name: body.name,
          description: body.description || null,
          displayOrder: body.displayOrder || 0,
          isActive: true,
        })
        .returning();

      const dto: ServiceDTO = {
        id: newService.id,
        tenantId: newService.tenantId,
        locationId: newService.locationId,
        name: newService.name,
        description: newService.description,
        displayOrder: newService.displayOrder,
        isActive: newService.isActive,
        createdAt: newService.createdAt.toISOString(),
        updatedAt: newService.updatedAt.toISOString(),
      };

      return reply.status(201).send(dto);
    }
  );

  // 3. Get single service details
  fastify.get(
    '/:tenantId/locations/:locationId/services/:serviceId',
    async (
      request: FastifyRequest<{
        Params: { tenantId: string; locationId: string; serviceId: string };
      }>,
      reply: FastifyReply
    ) => {
      const { tenantId, locationId, serviceId } = request.params;
      const db = getDb();
      const userId = request.user!.id;

      const ok = await verifyLocationOwnership(db, userId, tenantId, locationId, reply);
      if (!ok) return;

      const [s] = await db
        .select()
        .from(services)
        .where(
          and(
            eq(services.id, serviceId),
            eq(services.locationId, locationId),
            eq(services.tenantId, tenantId)
          )
        )
        .limit(1);

      if (!s) {
        return reply.status(404).send({
          error: {
            code: ErrorCodes.SERVICE_NOT_FOUND,
            message: 'Service not found or does not belong to this location',
          },
        });
      }

      const dto: ServiceDTO = {
        id: s.id,
        tenantId: s.tenantId,
        locationId: s.locationId,
        name: s.name,
        description: s.description,
        displayOrder: s.displayOrder,
        isActive: s.isActive,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      };

      return reply.status(200).send(dto);
    }
  );

  // 4. Update / Deactivate service (PATCH)
  fastify.patch(
    '/:tenantId/locations/:locationId/services/:serviceId',
    async (
      request: FastifyRequest<{
        Params: { tenantId: string; locationId: string; serviceId: string };
      }>,
      reply: FastifyReply
    ) => {
      const { tenantId, locationId, serviceId } = request.params;
      const db = getDb();
      const userId = request.user!.id;

      const ok = await verifyLocationOwnership(db, userId, tenantId, locationId, reply);
      if (!ok) return;

      const parseResult = UpdateServiceSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'Invalid service update payload',
            details: parseResult.error.issues.map((i) => ({
              field: i.path.join('.'),
              issue: i.message,
            })),
          },
        });
      }

      const body = parseResult.data;

      const [existing] = await db
        .select()
        .from(services)
        .where(
          and(
            eq(services.id, serviceId),
            eq(services.locationId, locationId),
            eq(services.tenantId, tenantId)
          )
        )
        .limit(1);

      if (!existing) {
        return reply.status(404).send({
          error: {
            code: ErrorCodes.SERVICE_NOT_FOUND,
            message: 'Service not found or does not belong to this location',
          },
        });
      }

      const updateData: any = { updatedAt: new Date() };
      if (body.name !== undefined) updateData.name = body.name;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.displayOrder !== undefined) updateData.displayOrder = body.displayOrder;
      if (body.isActive !== undefined) updateData.isActive = body.isActive;

      const [updated] = await db
        .update(services)
        .set(updateData)
        .where(eq(services.id, serviceId))
        .returning();

      const dto: ServiceDTO = {
        id: updated.id,
        tenantId: updated.tenantId,
        locationId: updated.locationId,
        name: updated.name,
        description: updated.description,
        displayOrder: updated.displayOrder,
        isActive: updated.isActive,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };

      return reply.status(200).send(dto);
    }
  );
};
