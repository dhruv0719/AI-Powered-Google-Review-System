# Database Design Document

## AI-Powered Google Review Assistance SaaS Platform

| Field | Value |
|---|---|
| Document Status | Approved Architecture Baseline v1.1 (Final Pre-Implementation) |
| Last Updated | 23 November 2026 |
| Target Database | PostgreSQL 15+ (Relational with UUID & JSONB) |
| ORM / Query Layer | Drizzle ORM (TypeScript-first SQL Schema) |

---

## 1. Schema Overview & Relational Hierarchy

The database follows a strict **Tenant-Centric** relational model. 
- One subscribed business = one **Tenant**.
- Users authenticate globally and gain access to tenants via **Tenant Memberships**.
- Each tenant owns one or more physical **Locations**.
- Services and QR Campaigns link directly to specific locations (or inherit tenant-wide).
- Sessions are split into two completely distinct tables:
  1. **`sessions`**: Authenticated business-owner sessions.
  2. **`ephemeral_sessions`**: Anonymous customer sessions for rate limiting, replay protection, and abuse prevention.
- Customer interaction data is segmented into **Private Feedback** (stored permanently for the merchant with customer consent) and **Analytics Events** (aggregated telemetry with zero PII).
- Platform administration is audited via **`admin_audit_logs`**.

```
+--------------------+       +------------------------+       +--------------------+
|       users        | 1   * |   tenant_memberships   | *   1 |      tenants       |
+--------------------+-------+------------------------+-------+--------------------+
| id                 |       | user_id                |       | id                 |
| email              |       | tenant_id              |       | slug (unique)      |
| password_hash      |       | role                   |       | display_name       |
| is_platform_admin  |       +------------------------+       | status             |
+--------------------+                                        +--------------------+
   | 1            | 1                                           | 1            | 1
   |              |                                             |              |
   | *            | *                                           | *            | 1
+-------------+ +--------------------+                +------------------+   +-------------------+
|  sessions   | | admin_audit_logs   |                |    locations     |   |   subscriptions   |
+-------------+ +--------------------+                +------------------+   +-------------------+
| id (hash)   | | id                 |                | id               |   | id                |
| user_id     | | admin_user_id      |                | tenant_id        |   | tenant_id (unique)|
| expires_at  | | action             |                | name             |   | plan              |
+-------------+ | target_tenant_id   |                | google_review_url|   | status            |
                +--------------------+                +------------------+   +-------------------+
                                                          | 1        | 1
                                            +-------------+          +-------------+
                                            | *                                    | *
                                  +-------------------+                  +-------------------+
                                  |     services      |                  |   qr_campaigns    |
                                  +-------------------+                  +-------------------+
                                  | id                |                  | id                |
                                  | tenant_id         |                  | location_id       |
                                  | location_id (opt) |                  | code (unique)     |
                                  | name, slug        |                  | name              |
                                  +-------------------+                  +-------------------+
                                                                                   | 1
                                                                                   |
                                                                                   | *
                                              +------------------------------------+------------------------------------+
                                              |                                    |                                    |
                                              v                                    v                                    v
                                  +------------------------+           +------------------------+           +------------------------+
                                  |   ephemeral_sessions   |           |    private_feedback    |           |    analytics_events    |
                                  +------------------------+           +------------------------+           +------------------------+
                                  | id (token hash)        |           | id                     |           | id                     |
                                  | campaign_id            |           | location_id            |           | campaign_id            |
                                  | regenerations_used     |           | rating                 |           | event_type             |
                                  | expires_at (TTL 30m)   |           | feedback_text          |           | created_at             |
                                  +------------------------+           +------------------------+           +------------------------+
```

---

## 2. Table Specifications & Data Dictionaries

### 2.1 `users`
**Purpose**: System-wide authentication identity for business owners and platform administrators.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK, DEFAULT `gen_random_uuid()` | Unique user identifier |
| `email` | `VARCHAR(255)` | NOT NULL, UNIQUE, Indexed | User login email address |
| `password_hash` | `VARCHAR(255)` | NOT NULL | Argon2id password hash |
| `full_name` | `VARCHAR(100)` | NOT NULL | Display name |
| `is_platform_admin`| `BOOLEAN` | NOT NULL, DEFAULT `false` | Grants platform-wide admin access. **Excluded from public/user DTOs**. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Registration timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Last profile update |

- **Security Constraint**: `is_platform_admin` can only be altered by database migrations or direct administrative CLI commands. It is explicitly blocked from `register` and `profile update` input schemas.

---

### 2.2 `sessions` (Authenticated Owner Sessions)
**Purpose**: Stores stateful, opaque server-side sessions for authenticated business owners and operators.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `VARCHAR(64)` | PK | SHA-256 hash of the random session token |
| `user_id` | `UUID` | NOT NULL, FK $\rightarrow$ `users.id` ON DELETE CASCADE | Associated authenticated user |
| `active_tenant_id` | `UUID` | NOT NULL, FK $\rightarrow$ `tenants.id` ON DELETE CASCADE | Current tenant context for the session |
| `ip_address` | `VARCHAR(45)` | NULLABLE | Client IP for audit and anomaly detection |
| `user_agent` | `VARCHAR(255)`| NULLABLE | Client browser user agent |
| `expires_at` | `TIMESTAMPTZ` | NOT NULL, Indexed | Absolute session expiration (default: 7 days) |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Login timestamp |

- **Lifecycle & Revocation**:
  - **Revocation**: Logging out deletes the session row directly (`DELETE FROM sessions WHERE id = $1`). Suspending a user or tenant immediately invalidates all associated sessions.
  - **Index**: `CREATE INDEX idx_sessions_user_tenant ON sessions(user_id, active_tenant_id);`
  - **Cleanup**: Expired sessions (`expires_at < NOW()`) are purged by a daily maintenance query.

---

### 2.3 `ephemeral_sessions` (Anonymous Customer Sessions)
**Purpose**: Short-lived, stateful tracking for anonymous customers who scan a QR code. Enforces regeneration quotas and prevents race-condition replay attacks without storing customer PII.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `VARCHAR(64)` | PK | SHA-256 hash of the random client session token |
| `tenant_id` | `UUID` | NOT NULL, FK $\rightarrow$ `tenants.id` ON DELETE CASCADE | Originating tenant |
| `location_id` | `UUID` | NOT NULL, FK $\rightarrow$ `locations.id` ON DELETE CASCADE | Scanned store location |
| `campaign_id` | `UUID` | NOT NULL, FK $\rightarrow$ `qr_campaigns.id` ON DELETE CASCADE | Scanned campaign placement |
| `regenerations_used`| `INTEGER` | NOT NULL, DEFAULT `0` | Count of AI review polishes generated |
| `max_regenerations` | `INTEGER` | NOT NULL, DEFAULT `3` | Maximum allowed regenerations per session |
| `ip_hash` | `VARCHAR(64)` | NOT NULL | Salted one-way hash of client IP (anti-abuse) |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Scan timestamp |
| `expires_at` | `TIMESTAMPTZ` | NOT NULL, Indexed | Session expiration (`created_at + 30 minutes`) |

- **Atomic Quota Enforcement**:
  ```sql
  UPDATE ephemeral_sessions
  SET regenerations_used = regenerations_used + 1
  WHERE id = $1 AND regenerations_used < max_regenerations AND expires_at > NOW()
  RETURNING regenerations_used, max_regenerations;
  ```
  If zero rows are updated, the request is rejected with `429 Too Many Requests`.
- **Indexing & Automated Cleanup**:
  - `CREATE INDEX idx_ephemeral_sessions_expires_at ON ephemeral_sessions(expires_at);`
  - Automated worker / cron purges expired records: `DELETE FROM ephemeral_sessions WHERE expires_at < NOW();`.

---

### 2.4 `tenants`
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

### 2.5 `tenant_memberships`
**Purpose**: Many-to-many relationship linking users to tenants with specific permissions.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK, DEFAULT `gen_random_uuid()` | Unique membership ID |
| `tenant_id` | `UUID` | NOT NULL, FK $\rightarrow$ `tenants.id` ON DELETE CASCADE | Associated tenant |
| `user_id` | `UUID` | NOT NULL, FK $\rightarrow$ `users.id` ON DELETE CASCADE | Associated user |
| `role` | `VARCHAR(30)` | NOT NULL, DEFAULT `'owner'` | `owner`, `manager`, `staff` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Membership grant timestamp |

- **Constraints**: `UNIQUE (tenant_id, user_id)`

---

### 2.6 `subscriptions`
**Purpose**: Tracks tenant billing status, plan tiers, and AI consumption limits.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK, DEFAULT `gen_random_uuid()` | Unique subscription record |
| `tenant_id` | `UUID` | NOT NULL, UNIQUE, FK $\rightarrow$ `tenants.id` ON DELETE CASCADE | 1-to-1 relationship with tenant |
| `plan` | `VARCHAR(50)` | NOT NULL, DEFAULT `'pilot_free'` | `pilot_free`, `starter`, `pro` |
| `status` | `VARCHAR(30)` | NOT NULL, DEFAULT `'active'` | `trialing`, `active`, `past_due`, `suspended` |
| `current_period_end`| `TIMESTAMPTZ`| NULLABLE | Subscription expiration date |
| `ai_monthly_quota` | `INTEGER` | NOT NULL, DEFAULT `100` | Max monthly AI review polishes |
| `ai_used_this_month`| `INTEGER` | NOT NULL, DEFAULT `0` | AI usage counter |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Timestamp created |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Timestamp updated |

---

### 2.7 `locations`
**Purpose**: Physical store branches belonging to a tenant.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK, DEFAULT `gen_random_uuid()` | Unique location identifier |
| `tenant_id` | `UUID` | NOT NULL, FK $\rightarrow$ `tenants.id` ON DELETE CASCADE | Owning tenant |
| `name` | `VARCHAR(120)` | NOT NULL | Location name (e.g. "Main Workshop") |
| `address` | `VARCHAR(255)` | NULLABLE | Physical street address |
| `google_review_url` | `VARCHAR(512)` | NOT NULL | Validated Google Review destination URL |
| `google_place_id` | `VARCHAR(120)` | NULLABLE | Google Maps Place ID |
| `is_active` | `BOOLEAN` | NOT NULL, DEFAULT `true` | Whether this branch accepts scans |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Last update timestamp |

---

### 2.8 `services`
**Purpose**: Factual services or products offered by the merchant.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK, DEFAULT `gen_random_uuid()` | Unique service identifier |
| `tenant_id` | `UUID` | NOT NULL, FK $\rightarrow$ `tenants.id` ON DELETE CASCADE | Owning tenant |
| `location_id` | `UUID` | NULLABLE, FK $\rightarrow$ `locations.id` ON DELETE CASCADE | NULL means branch-wide; UUID scopes to branch |
| `name` | `VARCHAR(100)` | NOT NULL | Service title (e.g. "Seat Cover Installation") |
| `slug` | `VARCHAR(100)` | NOT NULL | URL-safe slug |
| `display_order` | `INTEGER` | NOT NULL, DEFAULT `0` | UI sort order |
| `is_active` | `BOOLEAN` | NOT NULL, DEFAULT `true` | Visibility toggle |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Created timestamp |

- **Constraints**: `UNIQUE (tenant_id, slug)`

---

### 2.9 `qr_campaigns`
**Purpose**: Physical or digital QR code placements tied to a specific location.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK, DEFAULT `gen_random_uuid()` | Unique campaign ID |
| `tenant_id` | `UUID` | NOT NULL, FK $\rightarrow$ `tenants.id` ON DELETE CASCADE | Owning tenant |
| `location_id` | `UUID` | NOT NULL, FK $\rightarrow$ `locations.id` ON DELETE CASCADE | Targeted physical location |
| `code` | `VARCHAR(32)` | NOT NULL, UNIQUE, Indexed | Short alphanumeric code (e.g. `c_7x9k2m`) |
| `name` | `VARCHAR(100)` | NOT NULL | Placement label (e.g. "Customer Waiting Lounge") |
| `is_active` | `BOOLEAN` | NOT NULL, DEFAULT `true` | Whether the QR is enabled |
| `scan_count` | `INTEGER` | NOT NULL, DEFAULT `0` | Aggregate scan counter |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Generated timestamp |

---

### 2.10 `private_feedback` (Separate Customer Feedback Capability)
**Purpose**: Stores direct, private operational feedback sent to the business owner. Completely isolated from public Google review workflows.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `UUID` | PK, DEFAULT `gen_random_uuid()` | Unique feedback entry ID |
| `tenant_id` | `UUID` | NOT NULL, FK $\rightarrow$ `tenants.id` ON DELETE CASCADE | Owning merchant |
| `location_id` | `UUID` | NOT NULL, FK $\rightarrow$ `locations.id` ON DELETE CASCADE | Specific branch |
| `campaign_id` | `UUID` | NULLABLE, FK $\rightarrow$ `qr_campaigns.id` ON DELETE SET NULL | Scanned QR placement |
| `rating` | `SMALLINT` | NOT NULL | Customer rating (1 to 5) |
| `service_ids` | `UUID[]` | NULLABLE | Array of selected service IDs |
| `feedback_text` | `TEXT` | NOT NULL | Customer's private feedback text |
| `customer_contact` | `VARCHAR(150)`| NULLABLE | **Strictly optional** contact info (phone/email) |
| `consent_given` | `BOOLEAN` | NOT NULL, DEFAULT `true` | Explicit disclosure consent record |
| `status` | `VARCHAR(30)` | NOT NULL, DEFAULT `'unread'` | `unread`, `in_progress`, `resolved`, `archived` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Submission timestamp |

- **Data Privacy & Governance**:
  - Explicit customer disclosure on frontend: *"This feedback is sent privately to the business owner and will not be posted to Google."*
  - No mandatory PII: `customer_contact` is completely optional.
  - Logging redaction: `feedback_text` and `customer_contact` are redacted from server logs.
  - Merchant retention: Feedback is retained for merchant operational review and may be deleted or archived at any time by the merchant.

---

### 2.11 `analytics_events`
**Purpose**: Privacy-preserving, aggregate telemetry. Zero PII, zero review text.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `BIGSERIAL` | PK | Event ID |
| `tenant_id` | `UUID` | NOT NULL, FK $\rightarrow$ `tenants.id` ON DELETE CASCADE | Owning tenant |
| `location_id` | `UUID` | NOT NULL, FK $\rightarrow$ `locations.id` ON DELETE CASCADE | Branch location |
| `campaign_id` | `UUID` | NULLABLE, FK $\rightarrow$ `qr_campaigns.id` ON DELETE SET NULL | QR campaign |
| `event_type` | `VARCHAR(50)` | NOT NULL, Indexed | `qr_scan`, `google_button_click`, `draft_copied`, `private_feedback_submitted` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()`, Indexed | Event timestamp |

---

### 2.12 `ai_usage_logs`
**Purpose**: Audit and cost accounting for AI provider requests.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `BIGSERIAL` | PK | Audit record ID |
| `tenant_id` | `UUID` | NOT NULL, FK $\rightarrow$ `tenants.id` ON DELETE CASCADE | Owning tenant |
| `provider` | `VARCHAR(50)` | NOT NULL | `gemini`, `openai`, `mock` |
| `model` | `VARCHAR(50)` | NOT NULL | Configured model ID (e.g. `gemini-1.5-flash`) |
| `prompt_tokens` | `INTEGER` | NOT NULL | Prompt token count |
| `completion_tokens`| `INTEGER` | NOT NULL | Completion token count |
| `latency_ms` | `INTEGER` | NOT NULL | Response latency in milliseconds |
| `status` | `VARCHAR(30)` | NOT NULL | `success`, `rate_limited`, `failed` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Timestamp |

---

### 2.13 `admin_audit_logs` (Platform Governance)
**Purpose**: Immutable audit log recording sensitive platform-administrator actions.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `BIGSERIAL` | PK | Audit entry ID |
| `admin_user_id` | `UUID` | NOT NULL, FK $\rightarrow$ `users.id` | Acting platform administrator |
| `target_tenant_id`| `UUID` | NULLABLE, FK $\rightarrow$ `tenants.id` ON DELETE SET NULL | Affected tenant |
| `action` | `VARCHAR(60)` | NOT NULL | e.g. `tenant_suspend`, `tenant_reactivate`, `quota_override` |
| `reason` | `VARCHAR(255)`| NOT NULL | Operational justification |
| `metadata` | `JSONB` | NULLABLE | Action parameters (e.g. prior status, changes) |
| `ip_address` | `VARCHAR(45)` | NOT NULL | Originating client IP |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `NOW()` | Action timestamp |

---

## 3. Database Migration & Backup Strategy

### 3.1 Migration Management
- Managed using **Drizzle Kit** (`drizzle-kit generate` and `drizzle-kit migrate`).
- Migrations are versioned SQL files stored in `apps/backend/drizzle/migrations/`.
- All migrations run inside explicit transactions. New columns must be `NULLABLE` or specify a safe `DEFAULT`.

### 3.2 Automated Backup & Recovery
- **Daily Automated Snapshots**: Managed PostgreSQL continuous physical backups with Point-In-Time Recovery (PITR) retained for 14 days.
- **Weekly Logical Backups**: Automated `pg_dump` exporting compressed schemas and tables to an offsite S3-compatible encrypted bucket.
- **Recovery Verification**: Monthly automated restore rehearsal verifying RTO < 30 minutes and RPO < 1 hour.
