# Database Design Document

## AI-Powered Google Review Assistance SaaS Platform

| Field | Value |
|---|---|
| Document Status | Approved Architecture Baseline v1.2 (Milestone 1 Scope) |
| Last Updated | 23 November 2026 |
| Target Database | PostgreSQL 15+ (Relational with UUID & JSONB) |
| Testing Database | PGlite (Local In-Memory Postgres for integration tests; standard PostgreSQL for staging/prod) |
| ORM / Query Layer | Drizzle ORM (TypeScript-first SQL Schema) |

---

## 1. Schema Overview & Relational Hierarchy (Milestone 1 Focus)

The database follows a strict **Tenant-Centric** relational model. 
- One subscribed business = one **Tenant**.
- Users authenticate globally and gain access to tenants via **Tenant Memberships**.
- **Session Integrity**:
  - `sessions` stores authenticated business-owner sessions.
  - The primary key is `token_hash` (SHA-256 hash of the random session token).
  - A **composite foreign key** links `(sessions.user_id, sessions.active_tenant_id)` directly to `(tenant_memberships.user_id, tenant_memberships.tenant_id)`.
  - This guarantees at the database constraint level that a session can never select a tenant the user does not belong to.
- **Tenant Suspension**:
  - Suspending a tenant sets `tenants.status = 'suspended'`.
  - Fastify authorization hooks reject operations targeting that tenant (`403 TENANT_SUSPENDED`).
  - Suspension blocks access to the affected tenant **without invalidating the user's active session or access to other tenants**.
- **Data Minimization**:
  - In accordance with privacy-by-design, `ip_address` and `user_agent` are omitted from the `sessions` table.
- **Deferred to Subsequent Milestones**:
  - `locations` table and automatic Primary Location creation are deferred to **Milestone 2**. Registration in Milestone 1 atomically creates `user`, `tenant`, `tenant_membership` (owner), and `subscription`.
  - Subscription AI quotas (`ai_monthly_quota`, `ai_used_this_month`) are deferred to **Milestone 6 (AI Integration)**.
  - `admin_audit_logs` is deferred until platform-admin capabilities are built.
  - `services`, `qr_campaigns`, `ephemeral_sessions`, and `private_feedback` will be introduced in Milestones 3–6.

```
+--------------------+       +------------------------+       +--------------------+
|       users        | 1   * |   tenant_memberships   | *   1 |      tenants       |
+--------------------+-------+------------------------+-------+--------------------+
| id                 |       | user_id                |       | id                 |
| email              |       | tenant_id              |       | slug (unique)      |
| password_hash      |       | role                   |       | display_name       |
| full_name          |       +------------------------+       | status             |
| is_platform_admin  |                   ^                    +--------------------+
+--------------------+                   |                               | 1
   | 1                                   |                               |
   |                                     | Composite FK                  | 1
   | *                                   | (user_id, active_tenant_id)   |
+--------------------+                   |                               v
|      sessions      |                   |                    +--------------------+
+--------------------+                   |                    |   subscriptions    |
| token_hash (PK)    |-------------------+                    +--------------------+
| user_id            |                                        | id                 |
| active_tenant_id   |                                        | tenant_id (unique) |
| expires_at         |                                        | plan               |
| created_at         |                                        | status             |
+--------------------+                                        +--------------------+
```

---

## 2. Table Specifications & Data Dictionaries (Milestone 1)

### 2.1 `users`
**Purpose**: System-wide authentication identity for business owners and platform operators.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK, DEFAULT `gen_random_uuid()` | Unique user identifier |
| `email` | `VARCHAR(255)` | NOT NULL, UNIQUE, Indexed | User login email address (case-insensitive) |
| `password_hash` | `VARCHAR(255)` | NOT NULL | Argon2id password hash |
| `full_name` | `VARCHAR(100)` | NOT NULL | Display name |
| `is_platform_admin`| `BOOLEAN` | NOT NULL, DEFAULT `false` | Platform-wide admin flag. **Excluded from registration/profile DTOs**. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Registration timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Last profile update |

- **Security Constraint**: `is_platform_admin` cannot be passed in registration or profile update endpoints.

---

### 2.2 `tenants`
**Purpose**: The primary tenant boundary representing one independent business and billing account.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK, DEFAULT `gen_random_uuid()` | Unique tenant identifier |
| `slug` | `VARCHAR(100)` | NOT NULL, UNIQUE, Indexed | URL-safe identifier (e.g. `precision-auto`) |
| `display_name` | `VARCHAR(150)` | NOT NULL | Public business name |
| `logo_url` | `VARCHAR(512)` | NULLABLE | CDN/Storage URL for business logo |
| `brand_color` | `VARCHAR(7)` | DEFAULT `'#2563EB'` | Hex brand accent color |
| `status` | `VARCHAR(30)` | NOT NULL, DEFAULT `'active'` | `active`, `suspended`, `canceled` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Account creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Configuration update timestamp |

---

### 2.3 `tenant_memberships`
**Purpose**: Many-to-many relationship linking users to tenants with specific permissions.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK, DEFAULT `gen_random_uuid()` | Unique membership ID |
| `tenant_id` | `UUID` | NOT NULL, FK $\rightarrow$ `tenants.id` ON DELETE CASCADE | Associated tenant |
| `user_id` | `UUID` | NOT NULL, FK $\rightarrow$ `users.id` ON DELETE CASCADE | Associated user |
| `role` | `VARCHAR(30)` | NOT NULL, DEFAULT `'owner'` | `owner`, `manager`, `staff` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Membership grant timestamp |

- **Indexes & Constraints**:
  - `UNIQUE (tenant_id, user_id)`: A user can hold only one membership per tenant.
  - `INDEX idx_memberships_user (user_id)`: Fast lookup of all tenants for an authenticated user.
  - Required as the target of the composite foreign key from `sessions`.

---

### 2.4 `subscriptions` (Minimal Foundation for Milestone 1)
**Purpose**: Tracks tenant billing status and plan tier. (Payment processing and AI monthly quotas deferred).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK, DEFAULT `gen_random_uuid()` | Unique subscription record |
| `tenant_id` | `UUID` | NOT NULL, UNIQUE, FK $\rightarrow$ `tenants.id` ON DELETE CASCADE | 1-to-1 relationship with tenant |
| `plan` | `VARCHAR(50)` | NOT NULL, DEFAULT `'pilot_free'` | `pilot_free`, `starter`, `pro` |
| `status` | `VARCHAR(30)` | NOT NULL, DEFAULT `'active'` | `trialing`, `active`, `past_due`, `suspended` |
| `current_period_end`| `TIMESTAMPTZ`| NULLABLE | Subscription renewal date |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Timestamp created |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Timestamp updated |

---

### 2.5 `sessions` (Authenticated Owner Sessions)
**Purpose**: Stores stateful, opaque server-side sessions for authenticated business owners.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `token_hash` | `VARCHAR(64)` | PK | SHA-256 hash of the 256-bit random session token |
| `user_id` | `UUID` | NOT NULL | Associated authenticated user |
| `active_tenant_id` | `UUID` | NOT NULL | Current tenant context for the session |
| `expires_at` | `TIMESTAMPTZ` | NOT NULL, Indexed | Absolute session expiration (default: 7 days) |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Login timestamp |

- **Integrity & Constraints**:
  - **Composite Foreign Key**:
    `FOREIGN KEY (user_id, active_tenant_id) REFERENCES tenant_memberships(user_id, tenant_id) ON DELETE CASCADE`
    *Guarantees that a session can never select or switch to a tenant the user does not belong to.*
  - **Index**: `CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);`
  - **Data Minimization**: `ip_address` and `user_agent` are omitted.

---

### 2.6 `locations` (Physical Business Locations)
**Purpose**: Stores physical business branches belonging to a tenant.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK, `defaultRandom()` | Unique location identifier |
| `tenant_id` | `UUID` | NOT NULL, FK $\rightarrow$ `tenants.id` ON DELETE CASCADE | Associated tenant |
| `name` | `VARCHAR(150)` | NOT NULL | Branch name (e.g. "Main Workshop") |
| `address` | `VARCHAR(255)` | NULLABLE | Physical street address |
| `city` | `VARCHAR(100)` | NULLABLE | City / Municipality |
| `state` | `VARCHAR(100)` | NULLABLE | State / Province |
| `postal_code` | `VARCHAR(20)` | NULLABLE | PIN / Postal code |
| `phone` | `VARCHAR(30)` | NULLABLE | Contact telephone |
| `google_review_url` | `VARCHAR(1024)` | NULLABLE | Validated Google Review destination URL |
| `is_primary` | `BOOLEAN` | NOT NULL, DEFAULT `false` | True if primary location |
| `is_active` | `BOOLEAN` | NOT NULL, DEFAULT `true` | Soft deactivation status |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | Created timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | Updated timestamp |

- **Integrity & Constraints**:
  - `CONSTRAINT unique_tenant_location UNIQUE (tenant_id, id)`: Serves as composite foreign key target for `services`.
  - `CREATE UNIQUE INDEX unique_tenant_primary_location ON locations(tenant_id) WHERE (is_primary = true);`: Database-level guarantee of at-most-one primary location per tenant.
  - `CHECK (is_primary = false OR is_active = true)`: An inactive location can never be primary.
  - `INDEX idx_locations_tenant ON locations(tenant_id)`: Fast tenant queries.
  - **Concurrency Serialization**: All primary-location lifecycle operations serialize by acquiring an exclusive row lock on the parent tenant record:
    `SELECT id FROM tenants WHERE id = :tenantId FOR UPDATE;`
    This serializes concurrent location creation, primary switching, and deactivation.

---

### 2.7 `services` (Location-Scoped Service Catalogue)
**Purpose**: Stores services provided at a physical location.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK, `defaultRandom()` | Unique service identifier |
| `tenant_id` | `UUID` | NOT NULL | Associated tenant business |
| `location_id` | `UUID` | NOT NULL | Associated physical location |
| `name` | `VARCHAR(100)` | NOT NULL | Service title (e.g. "Oil Change") |
| `description` | `VARCHAR(255)` | NULLABLE | Optional brief description |
| `display_order` | `INTEGER` | NOT NULL, DEFAULT `0` | Order for UI display |
| `is_active` | `BOOLEAN` | NOT NULL, DEFAULT `true` | Soft deactivation status |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | Created timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()` | Updated timestamp |

- **Integrity & Constraints**:
  - **Composite Foreign Key**:
    `FOREIGN KEY (tenant_id, location_id) REFERENCES locations(tenant_id, id) ON DELETE CASCADE`
    *Guarantees at the database level that a service can never be associated with a location from another tenant.*
  - `INDEX idx_services_location ON services(location_id)`: Fast retrieval of location services.
  - `INDEX idx_services_tenant ON services(tenant_id)`: Tenant isolation index.

---

## 3. Database Testing Strategy & Limitations

### 3.1 PGlite in Integration Tests
- **Purpose**: We use `@electric-sql/pglite` (an in-process WebAssembly build of PostgreSQL 16) to run integration tests locally and in CI without needing an external Docker container or PostgreSQL daemon.
- **Testing Limitation & Discipline**:
  - PGlite provides real PostgreSQL SQL parsing, data types, constraints, and transactions.
  - *However*, PGlite is **not a 100% substitute** for real PostgreSQL production testing:
    1. It runs in-process in single-threaded WebAssembly mode and cannot test multi-connection pooling concurrency or lock contention under high load.
    2. Certain PostgreSQL extensions or complex connection-level SSL behaviors are not simulated.
  - The database adapter is designed to be **100% interchangeable**:
    - When `DATABASE_URL` is set, Drizzle uses standard `postgres` (or `pg`) driver connecting to real PostgreSQL.
    - When `DATABASE_URL` is omitted in test environments, it falls back to `pglite`.
  - **Deployment Concurrency Testing Requirement**:
    - Before production deployment, automated multi-threaded concurrency suites must run against a real PostgreSQL instance to test simultaneous creation, primary switching, and primary deactivation contention.

### 3.2 Migration Strategy
- Drizzle Kit manages versioned SQL migrations in `apps/backend/drizzle/migrations/`.
- Migrations are forward-only and executed in explicit transactions.
