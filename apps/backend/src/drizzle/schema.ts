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
    index('idx_services_location').on(table.locationId),
    index('idx_services_tenant').on(table.tenantId),
  ]
);
