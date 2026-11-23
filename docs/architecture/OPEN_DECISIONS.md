# Open Decisions & Decision Register

## AI-Powered Google Review Assistance SaaS Platform

| Field | Value |
|---|---|
| Document Status | Approved Architecture Baseline v1.1 (Final Pre-Implementation) |
| Last Updated | 23 November 2026 |
| Governance | Senior Software Architect / Tech Lead Baseline |

---

## 1. Architectural Decisions Register (ADR Index)

| ADR ID | Topic | Finalized Decision | Status |
|---|---|---|---|
| **ADR-001** | Multi-Tenant Hierarchy | Simplified `tenants → locations → services/qr_campaigns` | **Finalized** |
| **ADR-002** | Google Review Policy | Neutral handoff; no synthetic review generation; AI polish for customer-authored text only | **Finalized** |
| **ADR-003** | QR Resolution | Unified endpoint `GET /api/v1/public/qr/:code` returning public-safe config | **Finalized** |
| **ADR-004** | Session Separation | Separate `sessions` (owners) and `ephemeral_sessions` (anon clients) in PostgreSQL | **Finalized** |
| **ADR-005** | Owner Authentication | Opaque server-side sessions stored in `sessions` table with HTTP-only cookies | **Finalized** |
| **ADR-006** | Platform Governance | `is_platform_admin` protected from user APIs; actions logged to `admin_audit_logs` | **Finalized** |
| **ADR-007** | Technology Stack | Fastify + TypeScript + Drizzle ORM + PostgreSQL; single-instance in-memory rate limiting for MVP | **Finalized** |
| **ADR-008** | AI Integration | Configurable `AiProvider` adapter; meaningful-input strategy; gated behind `ENABLE_AI_ASSISTANT` | **Finalized** |
| **ADR-009** | Private Feedback | Separate product capability with explicit consent, optional contact, and log redaction | **Finalized** |

---

## 2. In-Depth Analysis of Corrected Decisions

### Decision 1: Separate Session Tables (`sessions` vs. `ephemeral_sessions`)
- **Problem**: Owner sessions require long-term persistence (7 days), user/tenant association, and instant revocation. Anonymous customer sessions require short-term persistence (30 minutes), atomic quota decrement, and replay protection without retaining PII.
- **Chosen Approach**: Two dedicated tables in PostgreSQL:
  1. `sessions`: Opaque hash, `user_id`, `active_tenant_id`, `expires_at`. Revoked on logout or tenant suspension.
  2. `ephemeral_sessions`: Opaque hash, `campaign_id`, `regenerations_used`, `max_regenerations`, `expires_at`. Atomic update queries prevent race-condition quota bypass.
- **Alternatives Considered**: Single polymorphic table (rejected due to nullable columns, security risk, and index bloat). Stateless JWTs (rejected due to replay vulnerabilities).
- **Trade-offs**: Maintaining two tables, but provides clean isolation and zero risk of credential leak.
- **Testing**: Concurrency tests with 10 parallel requests asserting atomic quota enforcement.

### Decision 2: Meaningful-Input Strategy for AI Review Polish
- **Problem**: An arbitrary "five-word" threshold is brittle (e.g. "car good yes nice thanks" passes 5 words, while "stitching flawless" is 2 words but substantive). Generating review text from structured data alone creates synthetic reviews.
- **Chosen Approach**:
  - The platform **never generates review text from rating/service chips alone**.
  - Customer must provide written input.
  - The backend runs a **meaningful-input check**:
    1. Trimmed length between 10 and 500 characters.
    2. Heuristic entropy filter (rejects repetitive characters or gibberish).
    3. Contains substantive experience or service details.
- **Policy Gate**:
  - We do **not** claim that AI polishing is automatically Google-compliant.
  - Feature is gated behind `ENABLE_AI_ASSISTANT=true|false`.
  - If disabled, the UI offers direct Google Review and private feedback routes only.
- **Testing**: Automated unit tests with synthetic test suite (AC-AI-001 through 012).

### Decision 3: Private Feedback as a Separate Product Capability
- **Problem**: Business owners need to know about customer dissatisfaction or operational issues, but diverting low-star customers into private forms is illegal review gating under Google policies.
- **Chosen Approach**:
  - Private feedback is presented alongside the Google Review option as a distinct, neutral choice: *"Send private feedback to the business management"*.
  - Requires explicit customer consent: *"This feedback is sent privately to the business owner and will not be posted to Google."*
  - No mandatory PII: customer contact is 100% optional.
  - Stored in `private_feedback` table; visible only to authorized tenant members.
  - Server logs automatically redact feedback text and customer contact.
- **Testing**: Privacy audit verifying feedback text is absent from logs and public endpoints.

### Decision 4: Security Corrections for Platform Administration
- **Problem**: Users could attempt privilege escalation if `is_platform_admin` is accepted in user-facing APIs. Administrative tenant suspensions require accountability.
- **Chosen Approach**:
  - `is_platform_admin` is explicitly excluded from Zod request schemas.
  - Sensitive admin actions under `/api/v1/admin/*` write to `admin_audit_logs`.
- **Testing**: Negative integration test asserting `is_platform_admin: true` in registration payload is ignored.

### Decision 5: Single-Instance Rate Limiting Limitations
- **Problem**: Clarifying the operational boundary of in-memory rate limiting.
- **Chosen Approach**:
  - For the MVP single-instance deployment, Fastify’s in-memory rate limiter is used.
  - **Documented Limitation**: In-memory rate limiting is per-process; it does not synchronize across multiple nodes if horizontally scaled.
  - **Mitigation**: Store interface designed to plug in Redis or PostgreSQL when horizontal scaling is deployed.

---

## 3. Official Google Maps Policy Evaluation & Unresolved Risks

### 3.1 Policy Reference Checklist (Updated November 2026)
- **Google Business Profile Help — Create a link or QR code to request reviews**:
  *Permitted*: Merchants may display neutral QR codes inviting reviews.
  *Prohibited*: Coercing customers, requiring reviews, or offering incentives/discounts.
- **Google Maps UGC Policy — Prohibited & Restricted Content**:
  *Prohibited*: "Content that is not based on a real experience", "Incentivized content", and "Merchants asking customers to include specific content".
- **Google Maps UGC Policy — AI-Generated Content Guidelines**:
  *Prohibited*: Content generated automatically that does not represent authentic customer sentiment or experience.

### 3.2 Compliance Strategy Summary
1. Neutral, un-gated access to Google Reviews at all times.
2. Complete elimination of synthetic review generation from structured data.
3. Policy feature gate (`ENABLE_AI_ASSISTANT`) allowing immediate deactivation of AI polishing if platform policies change.
4. Transparent separation of private operational feedback.

---

## 4. Final Status of Architectural Decisions

### Finalized Decisions
1. **Simplified Tenant Schema**: `tenants → locations → services/qr_campaigns` implemented in Drizzle ORM.
2. **Dedicated Session Tables**: `sessions` (7-day owner auth) and `ephemeral_sessions` (30-min anonymous client tracking) in PostgreSQL.
3. **Platform Admin Security**: `is_platform_admin` excluded from user APIs; actions audited in `admin_audit_logs`.
4. **Meaningful-Input AI Validation**: Arbitrary 5-word rule removed; semantic and heuristic validation enforced.
5. **Policy-Gated AI Polish**: Controlled via `ENABLE_AI_ASSISTANT`; no claim of automatic Google compliance.
6. **Separate Private Feedback**: Explicit consent, optional contact, tenant-scoped access, log redaction.
7. **QR Resolution Endpoint**: `GET /api/v1/public/qr/:code` returning public-safe metadata and an ephemeral session.
8. **Fastify + Drizzle ORM + PostgreSQL**: Core backend stack; Redis deferred for MVP with documented single-instance rate limiting boundaries.
9. **Configurable AI Adapter**: Model ID and provider driven by environment variables (`AI_PROVIDER`, `AI_MODEL`).

### Decisions Still Open / Pending Pilot Observation
1. **Pilot UI Theme & Branding**: Degree of merchant brand color customization permitted on the mobile customer page.
2. **Private Feedback Merchant Alerts**: Channel preference (Email vs. WhatsApp/SMS) for real-time private feedback notifications.
3. **Multi-Language Support**: Initial MVP pilot starts in English; Hindi and Gujarati localization will be scheduled based on pilot customer requests.
4. **Physical QR Signage Guidance**: Training materials and neutral wording templates for merchant staff at the physical counter.

### MVP Features Included
- Merchant registration, login, and tenant configuration.
- Service catalogue management (create, reorder, soft-delete).
- Branch location management and Google Review URL validation.
- Dynamic QR code generation (printable SVG/PNG download).
- Mobile customer landing page with direct Google Review button.
- Private customer feedback submission with explicit consent and merchant inbox.
- Policy-gated AI review polish engine for meaningful customer-authored feedback.
- Aggregate funnel analytics (scans, direct clicks, drafts assisted, copies).
- Platform admin tenant suspension and audit logging.

### Features Deferred (Post-Pilot)
- Multi-region database replication.
- Redis distributed cache (deferred until multi-instance horizontal scaling).
- Automated Google Business Profile review reply synchronization.
- Complex agency billing and multi-tier enterprise permissions.
- Customer loyalty or discount program integrations.

---

## 5. Recommended First Implementation Task

**Milestone 1 — Foundation, Database, Auth & Tenant Isolation**:
1. Initialize the monorepo workspace configuration (`apps/backend`, `apps/frontend`, `packages/shared`).
2. Configure PostgreSQL with Drizzle ORM for `users`, `tenants`, `tenant_memberships`, `subscriptions`, `sessions`, and `admin_audit_logs`.
3. Implement Fastify authentication endpoints (`register`, `login`, `logout`, `me`) using opaque session cookies and Argon2id.
4. Establish the automated test suite verifying tenant boundary isolation and ensuring `is_platform_admin` cannot be escalated.
