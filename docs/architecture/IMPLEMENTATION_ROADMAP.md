# Implementation Roadmap Document

## AI-Powered Google Review Assistance SaaS Platform

| Field | Value |
|---|---|
| Document Status | Approved Architecture Baseline v1.1 (Final Pre-Implementation) |
| Last Updated | 23 November 2026 |
| Strategy | Test-Driven, Milestone-Based Incremental Delivery |
| Core Focus | Early Working End-to-End Vertical Prototype |

---

## 1. Milestone Overview & Sequencing Strategy

The implementation prioritizes a **working end-to-end prototype** before introducing AI complexity.
This guarantees that the business owner and customer journeys are 100% functional, policy-compliant, and testable from the earliest release.

```
[ Milestone 1: Foundation, Database, Auth & Tenant Isolation ]
  - Drizzle + PostgreSQL setup (all tables & indexes)
  - Separate sessions (Owner) & admin_audit_logs tables
  - Protection of is_platform_admin from user DTOs
  - Automated tenant isolation test suite
               |
               v
[ Milestone 2: Tenant & Location Configuration ]
  - Tenant provisioning & subscription models
  - Primary location auto-creation
  - Google Review URL validation suite
               |
               v
[ Milestone 3: Service Management & QR Generation ]
  - Service catalogue CRUD
  - QR campaign generation & printable SVG/PNG
  - Public QR resolver: GET /api/v1/public/qr/:code
  - Ephemeral customer session table setup (ephemeral_sessions)
               |
               v
[ Milestone 4: Basic Customer-Facing Flow (Without AI) ]
  - Mobile React SPA for /q/:code
  - Unconditional, neutral "Write a Review on Google" action
  - Working zero-AI review handoff tested in pilot
               |
               v
[ Milestone 5: Private Customer Feedback Collection ]
  - Separate private feedback form with explicit consent
  - Strictly optional customer contact details
  - Merchant feedback inbox & resolution tracking
  - Pino logging redaction for customer feedback
               |
               v
[ Milestone 6: AI Integration (Policy-Gated Polish Engine) ]
  - Policy feature gate (ENABLE_AI_ASSISTANT)
  - Meaningful-input validation strategy (non-gibberish, >=10 chars)
  - Configurable AiProvider adapter (Gemini / OpenAI / Mock)
  - Atomic ephemeral session quota & replay protection
               |
               v
[ Milestone 7: Analytics, Owner Dashboard & Deployment ]
  - Anonymous funnel telemetry & conversion metrics
  - Merchant dashboard charts & quota monitoring
  - Production container build & deployment runbook
```

---

## 2. Detailed Milestone Specifications

### Milestone 1: Foundation, Database, Auth & Tenant Isolation
- **Objective**: Establish the core monorepo, database migrations, user registration, opaque session management (`sessions`), platform admin audit logging (`admin_audit_logs`), and automated tenant boundary isolation tests.
- **Dependencies**: None.
- **Modules & Expected Files**:
  - `packages/shared/src/schemas/auth.schema.ts` (strictly excludes `is_platform_admin`)
  - `apps/backend/src/plugins/db.ts`
  - `apps/backend/src/plugins/auth.ts`
  - `apps/backend/drizzle/schema.ts`
  - `apps/backend/src/modules/auth/*`
  - `apps/backend/src/modules/admin/*`
  - `apps/backend/tests/integration/tenant_isolation.test.ts`
- **Tests Required**:
  - Unit tests for Argon2id password hashing and session token generation.
  - Security test verifying `is_platform_admin` cannot be set via registration or user updates.
  - Integration tests for registration, login, logout, and session expiration in `sessions` table.
  - **Cross-Tenant Integration Test**: User A attempting to query, update, or delete User B's tenant/location/service receives `403 Forbidden` or `404 Not Found`.
- **Definition of Done (DoD)**:
  - Database migrations run cleanly against PostgreSQL.
  - User can register, authenticate via secure HTTP-only cookies, and maintain an active session.
  - Automated cross-tenant isolation test suite passes with 100% coverage on core queries.

---

### Milestone 2: Tenant & Location Configuration
- **Objective**: Implement tenant configuration, subscription lifecycle hooks, and physical branch locations with Google Review URL validation.
- **Dependencies**: Milestone 1.
- **Modules & Expected Files**:
  - `apps/backend/src/modules/tenant/*`
  - `apps/backend/src/modules/location/*`
  - `packages/shared/src/schemas/location.schema.ts`
  - `packages/shared/src/constants/google_url.ts`
- **Tests Required**:
  - URL validation test matrix: accepts valid formats (`https://g.page/r/.../review`, `https://search.google.com/local/writereview?placeid=...`, `https://maps.app.goo.gl/...`), rejects phishing, insecure HTTP, and open redirect patterns.
  - Tenant suspension test: suspended tenant status immediately rejects location modifications and session requests.
- **Definition of Done (DoD)**:
  - Owner can update tenant display name and brand color.
  - Owner can configure primary location review URL with strict backend validation.

---

### Milestone 3: Public Ingestion, Campaign QR Lifecycle & Private Feedback Ingestion
- **Status**: **Closed & Approved** (Local Verification Complete; Staging Multi-Connection Concurrency Pending)
- **Objective**: Deliver dynamic QR campaign lifecycle management, read-only public QR resolution, path-scoped ephemeral customer session issuance, isolated private customer feedback ingestion with consent, merchant feedback inbox, and automated batched data retention.
- **Dependencies**: Milestone 2.
- **Modules & Delivered Files**:
  - `apps/backend/src/routes/campaign.routes.ts` (QR campaign creation, rotation, revocation, SVG/PNG export)
  - `apps/backend/src/routes/public.routes.ts` (Read-only QR resolution, explicit session creation, private feedback ingestion)
  - `apps/backend/src/routes/feedback.routes.ts` (Owner feedback inbox, status transitions, filters)
  - `apps/backend/src/jobs/cleanup.ts` (Batched 24h unsubmitted session purge, 30d PII contact purge, 365d feedback retention purge)
  - `apps/backend/src/utils/csrf.ts` (Public CSRF Origin/Referer enforcement)
  - `apps/backend/src/utils/tenant_lifecycle.ts` (Transactional tenant suspension utility with row-locking pattern)
  - `apps/backend/scripts/test-postgres-concurrency.ts` (Deterministic real PostgreSQL multi-connection concurrency test harness)
- **Verification Status**:
  - **Core Implementation**: Approved.
  - **Automated Tests**: 99 tests passing across 15 test suites (`npm test`).
  - **Build Status**: Clean compilation across all workspaces (`npm run build --workspaces`).
  - **Security Audit**: Production dependencies clean with 0 vulnerabilities (`npm audit --omit=dev`).
  - **Tenant Suspension Administrative Workflow**: Not implemented in API (internal row-locking helper `suspendTenant` verified; platform admin/billing endpoints deferred to Milestone 7).
  - **Physical PostgreSQL Concurrency Verification**: Pending execution on a live physical PostgreSQL staging instance (`npm run test:concurrency`).
  - **Multi-Instance Rate Limiting & Distributed Scheduling**: Deferred to horizontal clustering milestone (pilot relies on single-instance in-memory `@fastify/rate-limit` and in-process timer).
- **Staging Verification Requirements**:
  1. Apply Drizzle SQL migrations against live PostgreSQL staging database (`npm run db:migrate --workspace=@review-system/backend`).
  2. Execute deterministic multi-connection concurrency test harness against physical PostgreSQL instance (`DATABASE_URL=... npm run test:concurrency --workspace=@review-system/backend`) to prove row-locking mutual exclusion across distinct backend worker processes.
  3. Validate upstream reverse proxy (Cloudflare/Nginx) IP forwarding (`X-Forwarded-For`) against configured `TRUSTED_PROXIES`.
  4. Verify background retention cleanup execution in staging environment over 24-hour cycle.

---

### Milestone 4: Basic Customer-Facing Flow (Without AI)
- **Objective**: Deliver a complete, mobile-optimized customer web application providing neutral, one-click access to Google Reviews without AI.
- **Dependencies**: Milestone 3.
- **Modules & Expected Files**:
  - `apps/frontend/src/pages/public/QRScanLanding.tsx`
  - `apps/frontend/src/layouts/PublicCustomerLayout.tsx`
  - `apps/frontend/src/services/publicApi.ts`
- **Tests Required**:
  - Mobile responsiveness test across standard viewport sizes (375px to 430px).
  - Policy compliance test: verify that the Google Review link is directly accessible with zero rating requirement.
  - Inactive/suspended campaign recovery page test.
- **Definition of Done (DoD)**:
  - Scanning the physical QR code opens the mobile landing page.
  - Customer can tap "Write a Review on Google" to open the business Google review page directly.
  - First end-to-end pilot milestone ready for merchant deployment.

---

### Milestone 5: Private Customer Feedback Collection
- **Objective**: Implement a separate private feedback feature where customers can send direct operational feedback to the merchant with explicit disclosure and consent.
- **Dependencies**: Milestone 4.
- **Modules & Expected Files**:
  - `apps/backend/src/modules/feedback/*`
  - `apps/frontend/src/pages/public/PrivateFeedback.tsx`
  - `apps/frontend/src/pages/owner/FeedbackInbox.tsx`
- **Tests Required**:
  - Integration test for `POST /api/v1/public/qr/:code/feedback` enforcing `consent_given === true`.
  - Verification that `customer_contact` is completely optional.
  - Merchant feedback inbox pagination and status update tests (`unread` $\rightarrow$ `resolved`).
  - Privacy test verifying that customer feedback text and contact details are redacted from server logs.
- **Definition of Done (DoD)**:
  - Customer can submit private feedback with a rating, optional services, and comments.
  - Merchant sees submitted feedback in real-time within the owner portal inbox.
  - Zero private feedback text is exposed on public endpoints or routed to Google.

---

### Milestone 6: AI Integration (Policy-Gated Polish Engine)
- **Objective**: Add a policy-gated AI writing assistant that polishes customer-authored feedback without creating synthetic reviews.
- **Dependencies**: Milestone 5.
- **Modules & Expected Files**:
  - `apps/backend/src/modules/ai/*` (Adapter, prompt engine, meaningful-input validator)
  - `apps/backend/src/plugins/rate-limit.ts`
  - `apps/frontend/src/pages/public/ReviewAssist.tsx`
  - `apps/backend/tests/unit/ai_prompt_safety.test.ts`
- **Tests Required**:
  - Meaningful-input validation tests: rejects empty, gibberish, repetitive, or < 10 character inputs.
  - Policy gate test: when `ENABLE_AI_ASSISTANT=false`, endpoint returns `503 FEATURE_DISABLED` and UI hides the assist option.
  - Atomic ephemeral session quota test: 4th regeneration request returns `429 Quota Exceeded` via atomic SQL query.
  - Model verification test against configured `AI_PROVIDER` and `AI_MODEL`.
- **Definition of Done (DoD)**:
  - Customer can enter meaningful feedback and receive an AI-polished draft.
  - Customer can edit, copy to clipboard, and proceed to Google.
  - All automated prompt-safety and quota-enforcement tests pass.

---

### Milestone 7: Analytics, Owner Dashboard & Deployment
- **Objective**: Build merchant funnel analytics, final UI polish, production Docker containers, and deployment documentation.
- **Dependencies**: Milestone 1 through 6.
- **Modules & Expected Files**:
  - `apps/backend/src/modules/analytics/*`
  - `apps/frontend/src/pages/owner/DashboardPage.tsx`
  - `Dockerfile`
  - `docker-compose.yml`
- **Tests Required**:
  - Analytics event aggregation test (verifying total scans, direct Google clicks, drafts assisted, and copies).
  - Production build verification test (TypeScript compile, bundle size audit < 150 KB gzip).
- **Definition of Done (DoD)**:
  - Merchant dashboard displays real-time aggregate metrics.
  - Complete application builds and deploys cleanly to production VPS/PaaS.
  - System fully verified for pilot deployment.
