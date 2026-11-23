import { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { tenants, tenantMemberships, locations, services, qrCampaigns } from '../drizzle/schema.js';
import {
  CreateLocationSchema,
  UpdateLocationSchema,
  ErrorCodes,
  LocationDTO,
} from '@review-system/shared';
import { requireAuth } from '../plugins/auth.js';
import { verifyTenantOwner } from '../utils/tenant_auth.js';

export const locationRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.addHook('preHandler', requireAuth);

  // 1. List locations for a tenant
  fastify.get(
    '/:tenantId/locations',
    async (
      request: FastifyRequest<{
        Params: { tenantId: string };
        Querystring: { status?: 'all' | 'active' | 'inactive' };
      }>,
      reply: FastifyReply
    ) => {
      const { tenantId } = request.params;
      const { status = 'all' } = request.query;
      const db = getDb();
      const userId = request.user!.id;

      const tenantCheck = await verifyTenantOwner(db, userId, tenantId, reply);
      if (!tenantCheck) return;

      const conditions = [eq(locations.tenantId, tenantId)];
      if (status === 'active') {
        conditions.push(eq(locations.isActive, true));
      } else if (status === 'inactive') {
        conditions.push(eq(locations.isActive, false));
      }

      const rows = await db
        .select()
        .from(locations)
        .where(and(...conditions))
        .orderBy(locations.createdAt);

      const dtoList: LocationDTO[] = rows.map((loc) => ({
        id: loc.id,
        tenantId: loc.tenantId,
        name: loc.name,
        address: loc.address,
        city: loc.city,
        state: loc.state,
        postalCode: loc.postalCode,
        phone: loc.phone,
        googleReviewUrl: loc.googleReviewUrl,
        isPrimary: loc.isPrimary,
        isActive: loc.isActive,
        createdAt: loc.createdAt.toISOString(),
        updatedAt: loc.updatedAt.toISOString(),
      }));

      return reply.status(200).send({ locations: dtoList });
    }
  );

  // 2. Create a new location
  fastify.post(
    '/:tenantId/locations',
    async (
      request: FastifyRequest<{ Params: { tenantId: string } }>,
      reply: FastifyReply
    ) => {
      const { tenantId } = request.params;
      const db = getDb();
      const userId = request.user!.id;

      const tenantCheck = await verifyTenantOwner(db, userId, tenantId, reply);
      if (!tenantCheck) return;

      const parseResult = CreateLocationSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'Invalid location data',
            details: parseResult.error.issues.map((i) => ({
              field: i.path.join('.'),
              issue: i.message,
            })),
          },
        });
      }

      const body = parseResult.data;

      const result = await db.transaction(async (tx: any) => {
        // Concurrency: Lock the tenant row to serialize primary location management
        await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`);

        // Check currently active locations
        const activeLocations = await tx
          .select({ id: locations.id, isPrimary: locations.isPrimary })
          .from(locations)
          .where(and(eq(locations.tenantId, tenantId), eq(locations.isActive, true)));

        let willBePrimary = false;

        // If no active locations exist, this first active location is guaranteed primary
        if (activeLocations.length === 0) {
          willBePrimary = true;
        } else if (body.isPrimary === true) {
          willBePrimary = true;
          // Demote existing primary
          await tx
            .update(locations)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(and(eq(locations.tenantId, tenantId), eq(locations.isPrimary, true)));
        }

        const [newLocation] = await tx
          .insert(locations)
          .values({
            tenantId,
            name: body.name,
            address: body.address || null,
            city: body.city || null,
            state: body.state || null,
            postalCode: body.postalCode || null,
            phone: body.phone || null,
            googleReviewUrl: body.googleReviewUrl || null,
            isPrimary: willBePrimary,
            isActive: true,
          })
          .returning();

        return newLocation;
      });

      const dto: LocationDTO = {
        id: result.id,
        tenantId: result.tenantId,
        name: result.name,
        address: result.address,
        city: result.city,
        state: result.state,
        postalCode: result.postalCode,
        phone: result.phone,
        googleReviewUrl: result.googleReviewUrl,
        isPrimary: result.isPrimary,
        isActive: result.isActive,
        createdAt: result.createdAt.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
        activeServiceCount: 0,
      };

      return reply.status(201).send(dto);
    }
  );

  // 3. Get single location details
  fastify.get(
    '/:tenantId/locations/:locationId',
    async (
      request: FastifyRequest<{ Params: { tenantId: string; locationId: string } }>,
      reply: FastifyReply
    ) => {
      const { tenantId, locationId } = request.params;
      const db = getDb();
      const userId = request.user!.id;

      const tenantCheck = await verifyTenantOwner(db, userId, tenantId, reply);
      if (!tenantCheck) return;

      const [loc] = await db
        .select()
        .from(locations)
        .where(and(eq(locations.id, locationId), eq(locations.tenantId, tenantId)))
        .limit(1);

      if (!loc) {
        return reply.status(404).send({
          error: {
            code: ErrorCodes.LOCATION_NOT_FOUND,
            message: 'Location not found or does not belong to this business',
          },
        });
      }

      // Count active services
      const [serviceCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(services)
        .where(and(eq(services.locationId, locationId), eq(services.isActive, true)));

      const dto: LocationDTO = {
        id: loc.id,
        tenantId: loc.tenantId,
        name: loc.name,
        address: loc.address,
        city: loc.city,
        state: loc.state,
        postalCode: loc.postalCode,
        phone: loc.phone,
        googleReviewUrl: loc.googleReviewUrl,
        isPrimary: loc.isPrimary,
        isActive: loc.isActive,
        createdAt: loc.createdAt.toISOString(),
        updatedAt: loc.updatedAt.toISOString(),
        activeServiceCount: serviceCount?.count || 0,
      };

      return reply.status(200).send(dto);
    }
  );

  // 4. Update / Deactivate location (PATCH)
  fastify.patch(
    '/:tenantId/locations/:locationId',
    async (
      request: FastifyRequest<{ Params: { tenantId: string; locationId: string } }>,
      reply: FastifyReply
    ) => {
      const { tenantId, locationId } = request.params;
      const db = getDb();
      const userId = request.user!.id;

      const tenantCheck = await verifyTenantOwner(db, userId, tenantId, reply);
      if (!tenantCheck) return;

      const parseResult = UpdateLocationSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: {
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'Invalid location update payload',
            details: parseResult.error.issues.map((i) => ({
              field: i.path.join('.'),
              issue: i.message,
            })),
          },
        });
      }

      const body = parseResult.data;

      const txResult = await db.transaction(async (tx: any) => {
        // Concurrency: Lock tenant row
        await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`);

        const [target] = await tx
          .select()
          .from(locations)
          .where(and(eq(locations.id, locationId), eq(locations.tenantId, tenantId)))
          .limit(1);

        if (!target) {
          return { errorStatus: 404, errorCode: ErrorCodes.LOCATION_NOT_FOUND, message: 'Location not found' };
        }

        const activeLocations = await tx
          .select()
          .from(locations)
          .where(and(eq(locations.tenantId, tenantId), eq(locations.isActive, true)));

        // Invariant Check 1: Reject conflicting or invalid primary/deactivation combinations
        if (body.isActive === false && body.isPrimary === true) {
          return {
            errorStatus: 400,
            errorCode: ErrorCodes.VALIDATION_ERROR,
            message: 'Cannot simultaneously deactivate a location and designate it as primary.',
          };
        }

        // Invariant Check 2: Reject promotion of an inactive location
        const targetWillBeActive = body.isActive !== undefined ? body.isActive : target.isActive;
        if (body.isPrimary === true && !targetWillBeActive) {
          return {
            errorStatus: 400,
            errorCode: ErrorCodes.CANNOT_PROMOTE_INACTIVE_LOCATION,
            message: 'Cannot designate an inactive location as primary.',
          };
        }

        // Invariant Check 3: Direct unsetting of primary is blocked
        if (body.isPrimary === false && target.isPrimary === true && body.isActive !== false) {
          return {
            errorStatus: 400,
            errorCode: ErrorCodes.CANNOT_UNSET_PRIMARY,
            message: 'A tenant with active locations must always have one primary location. Designate another active location as primary instead.',
          };
        }

        let newPrimaryLocationIdToPromote: string | null = null;
        let targetIsPrimary = target.isPrimary;
        let targetIsActive = target.isActive;

        // Deactivation handling
        if (body.isActive === false && target.isActive === true) {
          if (target.isPrimary) {
            // Case A: Deactivating the primary location
            if (activeLocations.length <= 1) {
              return {
                errorStatus: 400,
                errorCode: ErrorCodes.CANNOT_DEACTIVATE_ONLY_LOCATION,
                message: 'The only active location cannot be deactivated.',
              };
            }

            if (!body.newPrimaryLocationId) {
              return {
                errorStatus: 400,
                errorCode: ErrorCodes.INVALID_PRIMARY_REPLACEMENT,
                message: 'Deactivating the primary location requires newPrimaryLocationId to be specified in the same request.',
              };
            }

            if (body.newPrimaryLocationId === locationId) {
              return {
                errorStatus: 400,
                errorCode: ErrorCodes.INVALID_PRIMARY_REPLACEMENT,
                message: 'newPrimaryLocationId cannot be the location being deactivated.',
              };
            }

            const [replacement] = await tx
              .select()
              .from(locations)
              .where(
                and(
                  eq(locations.id, body.newPrimaryLocationId),
                  eq(locations.tenantId, tenantId),
                  eq(locations.isActive, true)
                )
              )
              .limit(1);

            if (!replacement) {
              return {
                errorStatus: 400,
                errorCode: ErrorCodes.INVALID_PRIMARY_REPLACEMENT,
                message: 'newPrimaryLocationId must be an existing active location belonging to this tenant.',
              };
            }

            newPrimaryLocationIdToPromote = replacement.id;
            targetIsPrimary = false;
          }
          targetIsActive = false;
        }

        // Primary promotion handling
        if (body.isPrimary === true && !target.isPrimary) {
          await tx
            .update(locations)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(and(eq(locations.tenantId, tenantId), eq(locations.isPrimary, true)));
          targetIsPrimary = true;
        }

        // Reactivation handling
        if (body.isActive === true && target.isActive === false) {
          targetIsActive = true;
          // If there are currently 0 active locations, the reactivated location MUST become primary
          if (activeLocations.length === 0) {
            targetIsPrimary = true;
          } else if (body.isPrimary === true) {
            await tx
              .update(locations)
              .set({ isPrimary: false, updatedAt: new Date() })
              .where(and(eq(locations.tenantId, tenantId), eq(locations.isPrimary, true)));
            targetIsPrimary = true;
          } else {
            targetIsPrimary = false;
          }
        }

        // Check if removing Google Review URL while active campaigns exist
        if (
          body.googleReviewUrl === null ||
          (body.googleReviewUrl !== undefined && body.googleReviewUrl.trim() === '')
        ) {
          const [activeCampaign] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(qrCampaigns)
            .where(and(eq(qrCampaigns.locationId, locationId), eq(qrCampaigns.status, 'active')));

          if (activeCampaign && activeCampaign.count > 0) {
            return {
              errorStatus: 400,
              errorCode: ErrorCodes.CANNOT_REMOVE_GOOGLE_URL_ACTIVE_CAMPAIGN,
              message:
                'Cannot remove Google Review URL while active QR campaigns depend on it. Deactivate or revoke campaigns first.',
            };
          }
        }

        const updateData: any = {
          isPrimary: targetIsPrimary,
          isActive: targetIsActive,
          updatedAt: new Date(),
        };

        if (body.name !== undefined) updateData.name = body.name;
        if (body.address !== undefined) updateData.address = body.address;
        if (body.city !== undefined) updateData.city = body.city;
        if (body.state !== undefined) updateData.state = body.state;
        if (body.postalCode !== undefined) updateData.postalCode = body.postalCode;
        if (body.phone !== undefined) updateData.phone = body.phone;
        if (body.googleReviewUrl !== undefined) updateData.googleReviewUrl = body.googleReviewUrl;

        const [updated] = await tx
          .update(locations)
          .set(updateData)
          .where(eq(locations.id, locationId))
          .returning();

        // Promote the designated replacement primary location if specified (after demoting/deactivating target)
        if (newPrimaryLocationIdToPromote) {
          await tx
            .update(locations)
            .set({ isPrimary: true, updatedAt: new Date() })
            .where(eq(locations.id, newPrimaryLocationIdToPromote));
        }

        return { updated };
      });

      if (txResult.errorStatus) {
        return reply.status(txResult.errorStatus).send({
          error: {
            code: txResult.errorCode,
            message: txResult.message,
          },
        });
      }

      const updated = txResult.updated;
      const dto: LocationDTO = {
        id: updated.id,
        tenantId: updated.tenantId,
        name: updated.name,
        address: updated.address,
        city: updated.city,
        state: updated.state,
        postalCode: updated.postalCode,
        phone: updated.phone,
        googleReviewUrl: updated.googleReviewUrl,
        isPrimary: updated.isPrimary,
        isActive: updated.isActive,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };

      return reply.status(200).send(dto);
    }
  );
};
