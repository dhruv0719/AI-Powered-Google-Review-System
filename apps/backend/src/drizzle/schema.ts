import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  unique,
  foreignKey,
  index,
  uniqueIndex,
  integer,
  check,
  smallint,
  text,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// 1. Users
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    fullName: varchar('full_name', { length: 100 }).notNull(),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_users_email').on(table.email)]
);

// 2. Tenants
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: varchar('slug', { length: 100 }).notNull().unique(),
    displayName: varchar('display_name', { length: 150 }).notNull(),
    logoUrl: varchar('logo_url', { length: 512 }),
    brandColor: varchar('brand_color', { length: 7 }).default('#2563EB'),
    status: varchar('status', { length: 30 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_tenants_slug').on(table.slug)]
);

// 3. Tenant Memberships
// Single canonical unique constraint on (user_id, tenant_id) enforces:
// 1. A user cannot be added to the same tenant more than once.
// 2. Backs the composite foreign key from sessions(user_id, active_tenant_id).
// 3. Automatically provides a B-tree index on user_id as the leading column.
// An index on tenant_id optimizes member lookups by tenant.
export const tenantMemberships = pgTable(
  'tenant_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 30 }).notNull().default('owner'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('unique_user_tenant').on(table.userId, table.tenantId),
    index('idx_memberships_tenant').on(table.tenantId),
  ]
);

// 4. Subscriptions (Minimal Milestone 1 Foundation)
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  plan: varchar('plan', { length: 50 }).notNull().default('pilot_free'),
  status: varchar('status', { length: 30 }).notNull().default('active'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 5. Sessions (Authenticated Owner Sessions with Session Integrity & Data Minimization)
export const sessions = pgTable(
  'sessions',
  {
    tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    activeTenantId: uuid('active_tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.activeTenantId],
      foreignColumns: [tenantMemberships.userId, tenantMemberships.tenantId],
    }).onDelete('cascade'),
    index('idx_sessions_user').on(table.userId),
    index('idx_sessions_expires_at').on(table.expiresAt),
  ]
);

// 6. Locations (Physical Business Branches)
export const locations = pgTable(
  'locations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 150 }).notNull(),
    address: varchar('address', { length: 255 }),
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 100 }),
    postalCode: varchar('postal_code', { length: 20 }),
    phone: varchar('phone', { length: 30 }),
    googleReviewUrl: varchar('google_review_url', { length: 1024 }),
    isPrimary: boolean('is_primary').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Composite unique constraint required for composite FK target from services
    unique('unique_tenant_location').on(table.tenantId, table.id),
    index('idx_locations_tenant').on(table.tenantId),
    // Partial unique index: at most one location per tenant can be primary
    uniqueIndex('unique_tenant_primary_location')
      .on(table.tenantId)
      .where(sql`${table.isPrimary} = true`),
    // Check constraint: an inactive location cannot be primary
    check('check_primary_active', sql`${table.isPrimary} = false OR ${table.isActive} = true`),
  ]
);

// 7. Services (Location-Scoped Service Catalogue)
export const services = pgTable(
  'services',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    description: varchar('description', { length: 255 }),
    displayOrder: integer('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Composite foreign key to enforce location belongs to the same tenant at DB level
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete('cascade'),
    unique('unique_tenant_location_service').on(table.tenantId, table.locationId, table.id),
    index('idx_services_location').on(table.locationId),
    index('idx_services_tenant').on(table.tenantId),
  ]
);

// 8. QR Campaigns (Physical Location-Scoped Campaigns)
export const qrCampaigns = pgTable(
  'qr_campaigns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    code: varchar('code', { length: 32 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('unique_campaign_code').on(table.code),
    unique('unique_tenant_location_campaign').on(table.tenantId, table.locationId, table.id),
    check('check_campaign_status', sql`${table.status} IN ('active', 'inactive', 'revoked')`),
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [locations.tenantId, locations.id],
    }).onDelete('cascade'),
    index('idx_qr_campaigns_code').on(table.code),
    index('idx_qr_campaigns_location').on(table.locationId),
    index('idx_qr_campaigns_tenant').on(table.tenantId),
  ]
);

// 9. Ephemeral Sessions (Short-Lived Anonymous Customer Interaction Sessions)
export const ephemeralSessions = pgTable(
  'ephemeral_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    issuedCode: varchar('issued_code', { length: 32 }).notNull(),
    feedbackSubmittedAt: timestamp('feedback_submitted_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('unique_ephemeral_token_hash').on(table.tokenHash),
    unique('unique_ephemeral_session_composite').on(table.tenantId, table.locationId, table.campaignId, table.id),
    foreignKey({
      columns: [table.tenantId, table.locationId, table.campaignId],
      foreignColumns: [qrCampaigns.tenantId, qrCampaigns.locationId, qrCampaigns.id],
    }).onDelete('cascade'),
    index('idx_ephemeral_sessions_expires_at').on(table.expiresAt),
  ]
);

// 10. Private Feedback (Direct Customer-to-Merchant Operational Feedback)
export const privateFeedback = pgTable(
  'private_feedback',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    campaignId: uuid('campaign_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    rating: smallint('rating').notNull(),
    feedbackText: text('feedback_text'),
    customerContact: varchar('customer_contact', { length: 100 }),
    consentGiven: boolean('consent_given').notNull(),
    consentAt: timestamp('consent_at', { withTimezone: true }).notNull().defaultNow(),
    consentVersion: varchar('consent_version', { length: 20 }).notNull().default('v1.0'),
    status: varchar('status', { length: 20 }).notNull().default('new'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('unique_session_private_feedback').on(table.sessionId),
    unique('unique_tenant_location_feedback').on(table.tenantId, table.locationId, table.id),
    check('check_feedback_rating', sql`${table.rating} >= 1 AND ${table.rating} <= 5`),
    check('check_feedback_text_length', sql`${table.feedbackText} IS NULL OR (char_length(trim(${table.feedbackText})) >= 3 AND char_length(${table.feedbackText}) <= 1000)`),
    check('check_consent_affirmative', sql`${table.consentGiven} = true`),
    check('check_feedback_status', sql`${table.status} IN ('new', 'reviewed', 'archived')`),
    foreignKey({
      columns: [table.tenantId, table.locationId, table.campaignId, table.sessionId],
      foreignColumns: [ephemeralSessions.tenantId, ephemeralSessions.locationId, ephemeralSessions.campaignId, ephemeralSessions.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.locationId, table.campaignId],
      foreignColumns: [qrCampaigns.tenantId, qrCampaigns.locationId, qrCampaigns.id],
    }).onDelete('cascade'),
    index('idx_private_feedback_tenant_created').on(table.tenantId, table.createdAt),
    index('idx_private_feedback_location').on(table.locationId),
  ]
);

// 11. Private Feedback Services (Association Table with Submission-Time Service Snapshot)
export const privateFeedbackServices = pgTable(
  'private_feedback_services',
  {
    feedbackId: uuid('feedback_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    locationId: uuid('location_id').notNull(),
    serviceNameSnapshot: varchar('service_name_snapshot', { length: 100 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.feedbackId, table.serviceId] }),
    foreignKey({
      columns: [table.tenantId, table.locationId, table.feedbackId],
      foreignColumns: [privateFeedback.tenantId, privateFeedback.locationId, privateFeedback.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenantId, table.locationId, table.serviceId],
      foreignColumns: [services.tenantId, services.locationId, services.id],
    }).onDelete('cascade'),
  ]
);
