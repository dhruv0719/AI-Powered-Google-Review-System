import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
  unique,
  foreignKey,
  index,
} from 'drizzle-orm/pg-core';

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
