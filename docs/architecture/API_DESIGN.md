# API Design Document

## AI-Powered Google Review Assistance SaaS Platform

| Field | Value |
|---|---|
| Document Status | Approved Architecture Baseline v1.1 (Final Pre-Implementation) |
| Last Updated | 23 November 2026 |
| Protocol | HTTPS REST / JSON API |
| Schema Validation | Zod Validation with Fastify Typebox Integration |

---

## 1. Global Conventions & Standards

1. **Base Prefix**: `/api/v1`
2. **Date Format**: ISO 8601 UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`)
3. **Identifiers**: UUID v4 for persistent entities; alphanumeric codes for QR campaigns (e.g. `c_9x2b1m`).
4. **Error Handling**: Standard RFC 7807-inspired error response envelope:
   ```json
   {
     "error": {
       "code": "VALIDATION_ERROR",
       "message": "Customer feedback must contain meaningful detail.",
       "details": [
         { "field": "feedback", "issue": "Input failed meaningful-content check" }
       ],
       "request_id": "req_8a7d6f5e"
     }
   }
   ```
5. **Authentication Mechanisms**:
   - **Public Customer**: Ephemeral session token (`sess_...`) issued upon calling `GET /api/v1/public/qr/:code`, tracked in `ephemeral_sessions` table with a 30-minute expiration.
   - **Business Owner**: Opaque session cookie (`review_session=ses_...`) with `HttpOnly; Secure; SameSite=Lax`, tracked in `sessions` table with a 7-day expiration.
   - **Tenant Context**: Business owner requests include active tenant ID via URL path `/owner/tenants/:tenantId/*` or header `X-Tenant-ID`. The server validates membership for every request.
   - **Platform Admin Protection**: `is_platform_admin` is strictly excluded from all public registration and profile update DTOs.

---

## 2. Public Customer API (No Owner Auth Required)

### 2.1 Resolve QR Campaign & Business Configuration
- **Method / Path**: `GET /api/v1/public/qr/:code`
- **Purpose**: Called by the mobile web app when a customer scans a physical QR code.
- **Authentication**: None.
- **Rate Limit**: 60 requests / minute per IP.
- **Request Parameters**:
  - `code` (path): Alphanumeric campaign code (e.g. `c_7x9k2m`).
- **Response `200 OK`**:
  ```json
  {
    "session": {
      "token": "sess_8f3a9b2c...",
      "expires_at": "2026-11-23T14:30:00.000Z",
      "regenerations_remaining": 3
    },
    "tenant": {
      "display_name": "Precision Auto Accessories",
      "logo_url": "https://cdn.domain.com/logos/precision.png",
      "brand_color": "#2563EB"
    },
    "location": {
      "name": "Main Fitting Bay",
      "google_review_url": "https://g.page/r/Cb927k_example/review"
    },
    "services": [
      { "id": "11111111-1111-1111-1111-111111111111", "name": "Seat Cover Installation" },
      { "id": "22222222-2222-2222-2222-222222222222", "name": "Sun Film / Tinting" }
    ],
    "features": {
      "ai_assistant_enabled": true
    }
  }
  ```
- **Error Cases**:
  - `404 NOT_FOUND`: QR campaign code does not exist.
  - `403 CAMPAIGN_INACTIVE`: Campaign or location is disabled.
  - `403 TENANT_SUSPENDED`: Business subscription is suspended.

---

### 2.2 Polish Customer-Authored Review Draft
- **Method / Path**: `POST /api/v1/public/qr/:code/drafts`
- **Purpose**: Polishes customer-authored feedback using AI.
- **Policy Gate Rule**:
  - Requires `ENABLE_AI_ASSISTANT=true`. If disabled, returns `503 FEATURE_DISABLED`.
  - We do **not** claim that AI polishing is automatically Google-compliant.
  - **Meaningful-Input Strategy**:
    - Feedback must be substantive, trimmed, between 10 and 500 characters.
    - Passes heuristic entropy check (rejects gibberish like "asdfghjkl" or repeated characters "aaaaaaa").
    - The API strictly rejects empty, rating-only, or structured-only generation requests.
- **Authentication**: Anonymous ephemeral session (`X-Review-Session` header or cookie).
- **Concurrency & Quotas**: Atomic update on `ephemeral_sessions`; max 3 regenerations per session.
- **Rate Limit**: 5 requests / 5 minutes per session token.
- **Request Body**:
  ```json
  {
    "service_ids": ["11111111-1111-1111-1111-111111111111"],
    "feedback": "Fitted seat covers today. Quality is nice and stitching is very clean.",
    "language": "en"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "status": "generated",
    "draft": "I visited today for seat cover installation. The stitching is clean and the fitting quality is very good.",
    "regenerations_remaining": 2
  }
  ```
- **Error Cases**:
  - `400 INPUT_NOT_MEANINGFUL`: Text is too short, repetitive, or lacks substantive content.
  - `401 INVALID_SESSION`: Ephemeral session expired or missing.
  - `429 QUOTA_EXCEEDED`: Max 3 regenerations reached for this session.
  - `503 FEATURE_DISABLED`: AI review polishing is disabled under current policy gate.
  - `503 AI_PROVIDER_UNAVAILABLE`: Fallback message directing user to write directly on Google.

---

### 2.3 Submit Private Customer Feedback (Separate Product Feature)
- **Method / Path**: `POST /api/v1/public/qr/:code/feedback`
- **Purpose**: Submits direct, private customer feedback to the business owner. Completely isolated from Google review submission.
- **Authentication**: Ephemeral session.
- **Rate Limit**: 3 submissions / hour per session.
- **Request Body**:
  ```json
  {
    "rating": 4,
    "service_ids": ["11111111-1111-1111-1111-111111111111"],
    "feedback_text": "Good work on the seat covers, but I had to wait 20 minutes past my appointment time.",
    "customer_contact": "9876543210",
    "consent_given": true
  }
  ```
- **Validation**:
  - `rating`: integer between 1 and 5.
  - `feedback_text`: string, required, min 3 chars, max 1000 chars.
  - `customer_contact`: string, **strictly optional**, max 100 chars.
  - `consent_given`: boolean, **required true** (acknowledges private submission to merchant).
- **Response `201 Created`**:
  ```json
  {
    "status": "received",
    "message": "Thank you! Your feedback has been sent privately to the business management."
  }
  ```

---

### 2.4 Record Anonymous Funnel Telemetry Event
- **Method / Path**: `POST /api/v1/public/qr/:code/events`
- **Purpose**: Records funnel events for merchant analytics (zero PII, zero review text).
- **Authentication**: Ephemeral session.
- **Request Body**:
  ```json
  {
    "event_type": "google_button_click"
  }
  ```
- **Allowed `event_type` Values**:
  - `google_button_click` (Customer clicked "Write a review on Google")
  - `draft_copied` (Customer copied the AI polished draft)
  - `direct_google_bypass` (Customer clicked direct link without using AI)
- **Response `204 No Content`**

---

## 3. Business Owner & Merchant API (Authenticated)

### 3.1 Authentication & Session Endpoints
- `POST /api/v1/auth/register`:
  - Body: `{ email, password, full_name, business_name }`.
  - Security: `is_platform_admin` is explicitly disallowed and stripped.
  - Behavior: Atomically creates `users`, `tenants`, `tenant_memberships` (as owner), and minimal `subscriptions` in a single transaction. (Locations deferred to Milestone 2). Sets HTTP-only session cookie.
- `POST /api/v1/auth/login`:
  - Body: `{ email, password }`.
  - Rate Limit: 5 failed attempts / 15 minutes per IP.
  - Response: `{ user: { id, email, full_name }, tenants: [...] }` + HTTP-only session cookie.
- `POST /api/v1/auth/logout`:
  - Behavior: Deletes session row from `sessions` table and clears cookie.
- `GET /api/v1/auth/me`:
  - Returns current user profile and active tenant context.

---

### 3.2 Tenant & Location Management

#### Path-Based Authorization Policy
- **Tenant Target Selection**: The `:tenantId` parameter in the request path explicitly selects the target tenant.
- **Authorization Requirement**: Valid membership with `role === Roles.OWNER` in that target tenant is strictly required for all `/owner/*` operations.
- **Active Tenant Context**: `activeTenantId` on the session cookie is the default UI and session selection context, not an additional authorization barrier. A user belonging to multiple tenants can explicitly operate on any tenant they belong to as owner by specifying `:tenantId` in the path.
- **Non-Disclosing Rejection**: Any request targeting a tenant where the user has no membership receives a non-disclosing `404 TENANT_NOT_FOUND` (preventing tenant enumeration).
- **Suspension Handling**: Accessing a suspended tenant returns `403 TENANT_SUSPENDED` without revoking the session or access to other tenants.
- **Non-Owner Rejection**: Any request targeting an owner endpoint by a tenant member without `Roles.OWNER` receives `403 FORBIDDEN`.

- `GET /api/v1/owner/tenants`: List all tenants the user is a member of.
- `GET /api/v1/owner/tenants/:tenantId`: Get tenant configuration and active subscription.
- `POST /api/v1/owner/tenants`: Create an additional tenant. Atomically creates tenant, subscription, and assigns creator as owner.
- `POST /api/v1/owner/tenants/:tenantId/switch`: Switch active tenant context. Validates user membership in the target tenant before updating `active_tenant_id` on the session.
- `PATCH /api/v1/owner/tenants/:tenantId`:
  - Body: `{ displayName }`.
  - Permission: Tenant `owner`.
- `GET /api/v1/owner/tenants/:tenantId/locations`: List physical locations (`?status=all|active|inactive`).
- `POST /api/v1/owner/tenants/:tenantId/locations`:
  - Body: `{ name, address?, city?, state?, postalCode?, phone?, googleReviewUrl?, isPrimary? }`.
  - Concurrency: Acquires exclusive row lock on tenant (`SELECT id FROM tenants WHERE id = :tenantId FOR UPDATE`).
  - Validation: Validates URL against approved Google Review URL patterns (HTTPS, zero-fetch allowlist).
  - Primary logic: If 0 active locations, forced to `isPrimary = true`. If `isPrimary: true`, atomically demotes previous primary.
- `GET /api/v1/owner/tenants/:tenantId/locations/:locationId`: Get location details.
- `PATCH /api/v1/owner/tenants/:tenantId/locations/:locationId`:
  - Body: `{ name?, address?, city?, state?, postalCode?, phone?, googleReviewUrl?, isPrimary?, isActive?, newPrimaryLocationId? }`.
  - Concurrency: Acquires exclusive row lock on tenant (`SELECT id FROM tenants WHERE id = :tenantId FOR UPDATE`).
  - Primary invariants:
    - Rejects promotion of an inactive location.
    - Rejects unsetting primary without replacement.
    - If deactivating the sole active location: returns `400 CANNOT_DEACTIVATE_ONLY_LOCATION`.
    - If deactivating a primary location when other active locations exist: requires valid `newPrimaryLocationId` in payload.
  - Deactivation: Soft-deactivation via `{ isActive: false }` (no DELETE endpoint).

---

### 3.3 Service Management
- `GET /api/v1/owner/tenants/:tenantId/locations/:locationId/services`: List services for a location (`?status=all|active|inactive`).
- `POST /api/v1/owner/tenants/:tenantId/locations/:locationId/services`:
  - Body: `{ name, description?, displayOrder? }`.
  - Database Integrity: Verified via composite foreign key `(tenant_id, location_id) -> locations(tenant_id, id)`.
- `GET /api/v1/owner/tenants/:tenantId/locations/:locationId/services/:serviceId`: Get single service.
- `PATCH /api/v1/owner/tenants/:tenantId/locations/:locationId/services/:serviceId`:
  - Body: `{ name?, description?, displayOrder?, isActive? }`.
  - Deactivation: Soft-deactivation via `{ isActive: false }` (no DELETE endpoint).

---

### 3.4 QR Campaign Management
- `GET /api/v1/owner/tenants/:tenantId/locations/:locId/campaigns`: List QR codes for this branch.
- `POST /api/v1/owner/tenants/:tenantId/locations/:locId/campaigns`:
  - Body: `{ name }` (e.g. "Counter 2", "Waiting Area").
  - System generates unique 7-character code `c_...`.
- `GET /api/v1/owner/tenants/:tenantId/campaigns/:campaignId/qr-asset`:
  - Query: `format=svg|png&size=512`.
  - Returns downloadable image stream formatted for printing.

---

### 3.5 Private Feedback Inbox (Merchant Management)
- `GET /api/v1/owner/tenants/:tenantId/feedback`:
  - Query: `status=unread|all&page=1&limit=20`.
  - Tenant Boundary: Only returns feedback where `tenant_id == activeTenantId`.
  - Returns list of private feedback entries with ratings, timestamps, and customer notes.
- `PATCH /api/v1/owner/tenants/:tenantId/feedback/:feedbackId`:
  - Body: `{ status: "resolved" }`.
- `DELETE /api/v1/owner/tenants/:tenantId/feedback/:feedbackId`:
  - Merchant deletion: permanently removes private feedback record.

---

### 3.6 Analytics Dashboard
- `GET /api/v1/owner/tenants/:tenantId/analytics`:
  - Query: `from=2026-11-01&to=2026-11-23`.
  - Aggregates funnel metrics without storing or returning customer text.

---

## 4. Platform Administrator Endpoints (`is_platform_admin = true`)

- `GET /api/v1/admin/tenants`: List all tenants, subscriptions, and AI consumption across the platform.
- `POST /api/v1/admin/tenants/:tenantId/suspend`:
  - Body: `{ reason: "Payment delinquency" | "Terms violation" }`.
  - Behavior:
    1. Sets `tenants.status = 'suspended'`.
    2. Writes immutable record to `admin_audit_logs`.
    3. Revokes all active owner sessions in `sessions` table for that tenant.
    4. Immediately disables public QR resolution.
- `POST /api/v1/admin/tenants/:tenantId/reactivate`: Restores tenant access and logs action in `admin_audit_logs`.
- `GET /api/v1/admin/audit-logs`: Paginated view of platform administrative actions.
