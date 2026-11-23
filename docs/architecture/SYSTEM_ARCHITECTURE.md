# System Architecture Document

## AI-Powered Google Review Assistance SaaS Platform

| Field | Value |
|---|---|
| Document Status | Approved Architecture Baseline v1.1 (Final Pre-Implementation) |
| Last Updated | 23 November 2026 |
| Target System | Multi-Tenant Review Assistance SaaS |
| Pilot Target | Local Automotive Services & Accessories Merchant |

---

## 1. Executive Summary & Architecture Goals

The platform is a multi-tenant SaaS designed to help local merchants simplify review collection without violating platform policies, manufacturing artificial sentiment, or collecting unnecessary customer personal data.

### Core Architectural Principles
1. **Zero-Gating & Direct Access**: The customer is provided neutral, immediate access to the business's public Google Review link at all times. The system never filters, delays, redirects, or gates access based on customer rating or sentiment.
2. **Strict Separation of Private Feedback vs. Public Review Drafting**:
   - **Private Feedback**: Customers can privately share operational feedback directly with the merchant. This feedback is securely stored for the merchant with explicit customer disclosure.
   - **Public Review Assistance**: Customers who choose to write a public review may optionally use an AI-powered writing assistant to polish their *own customer-authored feedback*.
3. **No Synthetic Review Generation**: The platform **never generates public review content from structured data alone** (such as rating and category selection). If the customer provides no written feedback, the system offers no AI generation and directs the customer to Google directly.
4. **Policy-Gated AI Polish**: AI-assisted review drafting is gated behind product and policy validation. We do not claim that AI-polished reviews are automatically Google-compliant.
5. **Simplified Multi-Tenancy**: One independently subscribed business corresponds to one **Tenant**. A tenant manages one or more physical **Locations**, each possessing distinct **Services** and **QR Campaigns**.
6. **Privacy by Design**: Anonymous customer review sessions require zero personal identifiable information (PII). Ephemeral session states protect against replay attacks and abuse without long-term tracking.

---

## 2. High-Level System Architecture

```
                                  +------------------------------------------------+
                                  |           Customer Device (Mobile)             |
                                  |   - Scans QR Code (/q/:code)                   |
                                  |   - Neutral "Review on Google" Action          |
                                  |   - Optional Private Feedback Submission       |
                                  |   - Optional AI Polish for Authored Text       |
                                  +-----------------------+------------------------+
                                                          | HTTPS (REST / JSON)
                                                          v
+------------------------------------+          +----------------------------------+
|      Business Owner Portal         |          |          Fastify API Gateway     |
|  - React SPA (Desktop / Mobile)    |  HTTPS   |  - Reverse Proxy / CORS / Helmet |
|  - Opaque Cookie Sessions          +--------->|  - Request Validation (Zod)      |
|  - Manage Services & QR Campaigns  |          |  - Tenant Authorization Guards   |
|  - Private Feedback Inbox          |          |  - Privacy Logging Redaction     |
|  - Aggregate Funnel Analytics      |          +-----------------+----------------+
+------------------------------------+                            |
                                                                  |
                     +--------------------------------------------+--------------------------------------------+
                     |                                            |                                            |
                     v                                            v                                            v
     +-------------------------------+            +-------------------------------+            +-------------------------------+
     |     Tenant & Config Service   |            |      AI Assistant Service     |            |  Feedback & Analytics Service |
     | - Tenant & Location CRUD      |            | - Prompt Sanitization Engine  |            | - Private Feedback Storage    |
     | - Service Catalogue Mgmt      |            | - AI Provider Adapter Layer   |            | - Funnel Counters (Scans,     |
     | - QR Campaign Engine          |            |   (Gemini, OpenAI, Mock)      |            |   Copies, Google Clicks)      |
     | - Subscription Lifecycle      |            | - Meaningful-Input Validator  |            | - Zero PII in Telemetry       |
     | - Admin Governance & Audits   |            | - Policy Gate Flag Enforcement|            | - Redacted Logging Engine     |
     +---------------+---------------+            +---------------+---------------+            +---------------+---------------+
                     |                                            |                                            |
                     +--------------------------------------------+--------------------------------------------+
                                                                  |
                                                                  v
                                              +---------------------------------------+
                                              |          PostgreSQL Database          |
                                              |  - Users & Tenant Memberships         |
                                              |  - Tenants, Locations & Services      |
                                              |  - QR Campaigns & Subscriptions       |
                                              |  - Separate Session Tables:           |
                                              |    * sessions (Owner Auth)            |
                                              |    * ephemeral_sessions (Anon Client) |
                                              |  - Private Feedback & Admin Audits    |
                                              |  - Analytics & AI Usage Accounting    |
                                              +---------------------------------------+
```

---

## 3. Significant Architectural Decisions (ADRs)

### ADR 001: Simplified Multi-Tenant Model (`tenants → locations → services/qr_campaigns`)

#### 1. Problem Being Solved
Local service merchants need an independent subscription and isolated workspace. A merchant may initially operate a single shop, but eventually expand to multiple locations (branches), with multiple QR codes per location. An earlier model using `organizations → businesses → locations` introduced redundant layers of abstraction for an MVP.

#### 2. Chosen Approach
Collapse `organizations` and `businesses` into a single entity: **`tenants`**.
- One subscribed business = one `tenant`.
- Billing and subscriptions attach directly to the `tenant`.
- Users belong to tenants via `tenant_memberships` (with roles: `owner`, `manager`, `staff`).
- Each tenant owns one or more `locations`. For the MVP, a default primary location is automatically provisioned.
- Services and QR campaigns attach to `locations` (with inheritance from `tenants`).

#### 3. Alternatives Considered
- `organizations → businesses → locations`: Unnecessary complexity for 99% of local merchants.
- Flat tenant-only without locations: Too rigid; breaks when a merchant opens a second branch.

#### 4. Trade-offs
A location level exists even for single-location businesses. Auto-creating a "Primary Location" during onboarding completely abstracts this complexity while preserving future scalability.

#### 5. How We Will Test It
Automated integration tests verifying that users with memberships in multiple tenants only see data for their active tenant context (`active_tenant_id`), and tenant boundary enforcement tests blocking cross-tenant object manipulation.

---

### ADR 002: Customer Experience, Google UGC Policies & Policy-Gated AI Assistance

#### 1. Problem Being Solved
Google Maps User-Generated Content (UGC) Guidelines strictly prohibit:
1. **Review Gating**: Selectively soliciting positive reviews or filtering dissatisfied customers away from Google.
2. **Non-Genuine / Synthetic Reviews**: Reviews that do not represent authentic, customer-authored experiences. Generating first-person review text from structured inputs alone creates synthetic content that risks profile suspension.
3. **Incentives & Coercion**: Requiring actions before allowing a review.

#### 2. Chosen Approach
1. **Unconditional Neutral Handoff**: The public landing page prominently displays a neutral, one-click button: **"Write a Review on Google"**. No rating, service selection, or feedback is required to access Google.
2. **Elimination of Synthetic Generation**: The platform **will not** generate public review drafts from structured data alone.
3. **Meaningful-Input Strategy for AI Assistance**:
   - The arbitrary "five-word" rule is removed.
   - Instead, the backend enforces a **semantic meaningful-input check**:
     - Non-gibberish and non-repetitive text (checked via entropy and character repetition filters).
     - Minimum length of 10 characters after trimming whitespace.
     - Contains substantive customer sentiment, service mention, or operational feedback.
     - Maximum length bounded at 500 characters.
4. **Policy-Validation Gate & Feature Flag**:
   - We explicitly do **not** claim that AI-assisted review polishing is automatically Google-compliant.
   - The AI review assistance endpoint is controlled by an environment and tenant feature flag: `ENABLE_AI_ASSISTANT=true|false`. If disabled or pending legal/policy confirmation, the public interface smoothly hides the AI assist option and presents direct Google Review and private feedback routes.
5. **Separate Private Feedback Channel**: Customers are offered an explicit option: *"Send private feedback to the business owner"*. This feedback is stored in the merchant's portal and is never routed to Google.

```mermaid
flowchart TD
    Scan["Customer Scans QR Code"] --> Landing["Public Landing Page"]
    Landing --> DirectGoogle["Direct Button: Review on Google<br/>(Neutral, No Gates, No Rating Required)"]
    Landing --> OptAction{"Customer Chooses Action"}
    OptAction --> PrivateFB["Private Feedback Form<br/>(Sends directly to merchant inbox with consent)"]
    OptAction --> AuthoredAssist["Assisted Review Drafting<br/>(Requires Meaningful Customer Text)"]
    AuthoredAssist --> PolicyCheck{"Policy Gate Enabled?<br/>(ENABLE_AI_ASSISTANT)"}
    PolicyCheck -- False --> FallbackDirect["Offer Direct Google Review"]
    PolicyCheck -- True --> ValidateInput{"Passes Meaningful Input Filter?<br/>(Non-gibberish, >=10 chars, substantive)"}
    ValidateInput -- No --> PromptMore["Prompt for genuine details<br/>or suggest direct Google review"]
    ValidateInput -- Yes --> AIPolish["AI Polishes Customer's Text<br/>(Grammar, clarity, preserves sentiment)"]
    AIPolish --> CustomerReview["Customer Reviews & Edits Draft"]
    CustomerReview --> CopyHandoff["Copy Text & Open Google Reviews"]
```

#### 3. Alternatives Considered
- Pre-selecting 5 stars or forcing a rating before opening Google (violates Google policy).
- Hallucinating review text from rating + service chips (high risk of Google spam filtering).
- Arbitrary 5-word minimum (brittle and easily bypassed with filler words).

#### 4. Trade-offs
Fewer public reviews may be generated compared to an aggressive "click to fake a 5-star review" model, but the platform remains authentic, legally sound, and safe from merchant profile penalties.

#### 5. How We Will Test It
Audit verification tests ensuring the Google Review link is always present on initial page load, and automated test cases verifying that AI generation requests with blank, gibberish, or repetitive characters are rejected.

---

### ADR 003: Public QR Resolution via `GET /api/v1/public/qr/:code`

#### 1. Problem Being Solved
The public customer endpoint must resolve QR scans quickly on mobile networks, handle multiple locations and campaigns, and reveal zero private merchant data.

#### 2. Chosen Approach
Implement a single unified resolution endpoint:
`GET /api/v1/public/qr/:code`
1. The QR code encodes a short URL: `https://rev.domain.com/q/:code`.
2. The frontend fetches configuration via `GET /api/v1/public/qr/:code`.
3. The backend resolves `qr_campaigns` by unique indexed `code`:
   - Validates that the campaign, location, and tenant are `active`.
   - Checks subscription status (rejects if tenant is `suspended`).
   - Increments the scan counter asynchronously.
   - Issues an ephemeral, server-managed session (`ephemeral_sessions`).
   - Returns public-safe configuration: tenant display name, logo, location name, Google review URL, and active services.

#### 3. Alternatives Considered
- Encoding tenant slug in the URL (`/public/businesses/:slug`): Fails to distinguish between different locations or specific QR placements.
- Dynamic client-side redirection: Slower, exposes internal routing.

#### 4. Trade-offs
Requires an indexed lookup on `qr_campaigns.code`. A unique index on `code` ensures $O(1)$ query time.

#### 5. How We Will Test It
Integration tests passing valid, inactive, and non-existent campaign codes, asserting expected status codes (`200`, `403 Tenant Suspended`, `404 Not Found`).

---

### ADR 004: Separate Session Tables (`sessions` vs. `ephemeral_sessions`)

#### 1. Problem Being Solved
The system serves two distinct user personas with fundamentally different lifecycle, security, and persistence requirements:
1. Authenticated business owners who manage businesses over long periods.
2. Anonymous mobile customers who scan QR codes and need temporary rate-limiting and replay protection without long-term tracking.

#### 2. Chosen Approach
Implement two dedicated, isolated tables:
1. **`sessions` (Authenticated Owner Sessions)**:
   - Primary key is `token_hash` (SHA-256 hash of opaque 256-bit session token).
   - Tracks `user_id`, `active_tenant_id`, and `expires_at` (7 days).
   - **Data Minimization**: `ip_address` and `user_agent` are omitted.
   - **Composite Foreign Key**: `(user_id, active_tenant_id) REFERENCES tenant_memberships(user_id, tenant_id) ON DELETE CASCADE`. Prevents a session from selecting any tenant the user does not belong to.
   - **Revocation**: Deleting the row revokes access immediately on logout.
   - **Tenant Suspension**: Suspending a tenant blocks access to that specific tenant without invalidating the user's sessions or access to other tenants.
   - **Cleanup**: Daily automated purge of rows where `expires_at < NOW()`.
2. **`ephemeral_sessions` (Anonymous Customer Sessions)**:
   - Stores SHA-256 hash of client session token issued upon QR scan.
   - Tracks `tenant_id`, `location_id`, `campaign_id`, `regenerations_used`, `max_regenerations` (3), `ip_hash`, `expires_at` (30 minutes).
   - **Atomic Quota Enforcement**:
     ```sql
     UPDATE ephemeral_sessions
     SET regenerations_used = regenerations_used + 1
     WHERE id = $1 AND regenerations_used < max_regenerations AND expires_at > NOW()
     RETURNING regenerations_used;
     ```
     This atomic query guarantees race-condition prevention across parallel customer requests.
   - **Cleanup**: Hourly automated purge of rows where `expires_at < NOW()`.

#### 3. Alternatives Considered
- Single unified sessions table: Polymorphic table with null owner IDs and mixed lifecycles; prone to security bugs and indexing bloat.
- Pure stateless JWTs for anonymous customers: Vulnerable to replay attacks unless a stateful revocation list is kept.

#### 4. Trade-offs
Two separate tables to maintain, but provides clean separation of concerns, strict indexing, and zero risk of cross-contaminating owner credentials with public sessions.

#### 5. How We Will Test It
Automated concurrency tests firing 10 simultaneous regeneration calls against `ephemeral_sessions` asserting exactly 3 succeed and 7 return `429`.

---

### ADR 005: Platform Admin Governance & Security Controls

#### 1. Problem Being Solved
Platform administrators require capabilities to audit tenants, view platform metrics, and suspend delinquent or abusive tenants. However:
- Ordinary users must never be able to elevate their privileges to `is_platform_admin`.
- Sensitive administrative operations must be tracked for auditing and compliance.

#### 2. Chosen Approach
1. **Protection of `is_platform_admin`**:
   - Stripped from all public registration, profile update, and tenant membership schemas.
   - Can only be granted directly via database seeders, migrations, or internal CLI utilities.
2. **Immutable Audit Logging (`admin_audit_logs`)**:
   - Any action taken under `/api/v1/admin/*` (e.g. tenant suspension, reactivation, quota override) writes an immutable record to `admin_audit_logs` capturing `admin_user_id`, `target_tenant_id`, `action`, `reason`, `ip_address`, and `metadata`.

#### 3. Alternatives Considered
- Role-based permissions table: Unnecessary complexity for an MVP with only two roles (Platform Admin vs Tenant Member).
- Untracked admin flags: High security risk without an audit trail.

#### 4. Trade-offs
Requires an extra audit insert on administrative actions, but guarantees enterprise-grade accountability.

#### 5. How We Will Test It
Negative security tests attempting to pass `{ is_platform_admin: true }` in registration payloads, asserting the field is ignored, and audit tests verifying that tenant suspension creates an `admin_audit_logs` record.

---

### ADR 006: Technology Stack & Rate Limiting Architecture

#### 1. Problem Being Solved
Select a fast, maintainable backend and database layer, and clarify rate-limiting constraints for single-instance vs. multi-instance deployment.

#### 2. Chosen Approach
- **Runtime & Framework**: **Node.js (v20+ LTS) + TypeScript + Fastify**.
- **Database & Query Layer**: **PostgreSQL 16 + Drizzle ORM**. Lightweight, TypeScript-first SQL mapper with zero binary engine dependencies.
- **Rate Limiting Strategy & Limitations**:
  - For the MVP single-instance deployment, Fastify’s in-memory rate limiter (`@fastify/rate-limit`) handles IP throttling.
  - **Documented Limitation**: In-memory rate limiting is bound to a single process instance. If the service is scaled horizontally across multiple instances or containers, in-memory counters do not sync across nodes.
  - **Mitigation**: The code abstracts the rate-limiter store behind an interface. When horizontal scaling is deployed, the store will be switched to a Redis or PostgreSQL store without changing route definitions.
- **AI Provider Adapter**:
  - Model versions are configured via environment variables: `AI_PROVIDER=gemini`, `AI_MODEL=gemini-1.5-flash` (or current GA models).
  - Includes `MockAiProvider` for offline deterministic testing without external API calls.

#### 3. Alternatives Considered
- Mandating Redis for MVP: Adds infrastructure cost and operational overhead for a single pilot business.

#### 4. Trade-offs
Single-instance rate limiting requires upgrading to Redis upon horizontal scaling, but keeps the MVP deployment lean and cost-free.

#### 5. How We Will Test It
Unit tests asserting rate limiter triggers `429 Too Many Requests` after quota exhaustion on test suites.

---

## 4. Private Feedback: Product Capability Specification

### 4.1 Product Objective
Provide customers an immediate, private channel to voice concerns, compliments, or operational issues directly to merchant ownership, preventing unresolved frustration without resorting to review gating.

### 4.2 Governance & Privacy Rules
1. **Explicit Customer Consent & Disclosure**: The UI prominently states: *"This feedback is sent privately to the business management and will not be posted to Google."* A boolean `consent_given: true` is captured.
2. **No Mandatory Customer Identity**: Name, phone number, and email are completely optional. Customers can submit feedback 100% anonymously.
3. **Tenant-Scoped Merchant Access**: Only authenticated users with active memberships in that tenant can view, resolve, or archive feedback entries.
4. **Data Retention & Merchant Deletion**: Private feedback is retained for merchant operational review. Merchants have the right to delete feedback records at any time.
5. **Zero Customer Content in Server Logs**: Fastify's Pino logging configuration redacts `feedback_text` and `customer_contact` across all request, response, and error logs:
   ```typescript
   redact: [
     'req.body.feedback',
     'req.body.feedback_text',
     'req.body.customer_contact',
     'req.body.password',
     'res.body.draft'
   ]
   ```

---

## 5. Deployment Architecture & Environment Configuration

### Target Deployment Topology (MVP)
- **App Server**: Single Docker container or managed VPS (e.g. Render, Railway, DigitalOcean App Platform, AWS Lightsail) running Fastify and serving the static React frontend SPA.
- **Database**: Managed PostgreSQL instance with automated daily backups.
- **Reverse Proxy / SSL**: Cloudflare or Caddy providing HTTPS termination.

### Core Environment Variables

```env
# Application
NODE_ENV=production
PORT=3000
APP_BASE_URL=https://app.reviewassistant.com
PUBLIC_QR_BASE_URL=https://rev.reviewassistant.com

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/review_saas?sslmode=require
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# Security & Sessions
SESSION_SECRET=min-32-character-cryptographically-random-string
COOKIE_DOMAIN=.reviewassistant.com
ENCRYPTION_KEY=32-byte-hex-key-for-sensitive-fields

# AI Policy & Provider Configuration
ENABLE_AI_ASSISTANT=true # Master policy feature gate
AI_PROVIDER=gemini # gemini | openai | mock
AI_API_KEY=your-provider-api-key
AI_MODEL=gemini-1.5-flash # or gemini-2.0-flash / gpt-4o-mini
AI_MAX_TOKENS=250
AI_TIMEOUT_MS=6000

# Rate Limiting (Single-Instance In-Memory for MVP)
RATE_LIMIT_GLOBAL_MAX=100
RATE_LIMIT_GLOBAL_WINDOW_MS=60000
RATE_LIMIT_DRAFT_MAX=5
RATE_LIMIT_DRAFT_WINDOW_MS=300000
```
