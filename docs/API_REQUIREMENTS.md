# API Requirements

## AI-Powered Google Review System

| Field | Value |
|---|---|
| Document status | Draft v0.1 — conceptual contracts |
| Last updated | 15 November 2026 |
| Source documents | `PRD.md`, `SRS.md`, `BUSINESS_RULES.md`, `AI_SPECIFICATION.md` |

> These are logical API requirements and example contracts, not a final route/technology decision. HTTP paths and names can be adjusted during system design, but the behavior and security constraints must remain.

---

## 1. API design principles

1. Separate public customer operations from authenticated owner operations.
2. Derive trusted business details and category labels on the server.
3. Never accept a client-supplied rating or category as a trusted business-owner setting.
4. Keep AI provider credentials and provider-specific response formats behind the backend.
5. Do not persist raw feedback or generated draft text by default.
6. Apply authorization, validation, and abuse controls on the server.
7. Return consistent error formats without leaking stack traces, secrets, provider payloads, or internal identifiers.
8. Do not expose endpoints to post, edit, rate, or delete Google reviews.

## 2. API conventions

- Versioning: versioned API namespace is recommended; exact prefix is an architecture decision.
- Content type: JSON for request/response bodies unless file upload is needed.
- Authentication: secure owner session/token mechanism to be selected during design.
- Authorization: server verifies tenant/business ownership on every protected request.
- IDs: opaque identifiers; do not expose sequential database keys unnecessarily.
- Time: timestamps should use UTC in machine-readable responses.
- Errors: consistent machine-readable code plus safe human-readable message.
- Logging: request metadata may be logged, but generation request/response bodies must be excluded or redacted.

### Standard error shape (illustrative)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please select a rating before continuing.",
    "request_id": "opaque-request-id"
  }
}
```

## 3. Public customer API

### 3.1 Get public business page configuration

**Logical operation:** `GET /public/businesses/{public_id}`

Purpose:
- Return only fields required to render the public page.
- Confirm the business/page is active.
- Return active service/category options and approved branding.
- Never return owner email, credentials, internal notes, private analytics, or tokens.

Illustrative response:

```json
{
  "business": {
    "public_id": "shop-public-id",
    "display_name": "Example Auto Accessories",
    "logo_url": null
  },
  "categories": [
    {"id": "seat-cover-installation", "label": "Seat cover installation"},
    {"id": "car-accessories", "label": "Car accessories"}
  ],
  "google_review_url": "https://g.page/r/example/review"
}
```

The final response shape must be reviewed for privacy and safe URL handling. It must not include hidden rating defaults or suggested review wording.

### 3.2 Generate a review draft

**Logical operation:** `POST /public/businesses/{public_id}/drafts`

Request example:

```json
{
  "selected_categories": ["seat-cover-installation"],
  "rating": 5,
  "feedback": "Good fitting, satisfied",
  "language": "en"
}
```

Requirements:
- Validate business state, category membership, rating, optional feedback length, and language.
- Reject categories that do not belong to the business or are inactive.
- Never accept a browser-supplied system prompt or arbitrary business context.
- Apply rate limits before calling the AI provider.
- Ensure duplicate requests and repeated taps do not cause uncontrolled provider cost.
- Do not persist the raw input or output by default.

Illustrative success response:

```json
{
  "status": "generated",
  "draft": "The customer-editable draft returned by the AI layer.",
  "generation_id": "opaque-short-lived-id",
  "remaining_regenerations": 1
}
```

Illustrative non-generation response:

```json
{
  "status": "insufficient_context",
  "draft": null,
  "message": "There is not enough detail to create a grounded draft. You can write your review directly on Google."
}
```

Policy gate: this endpoint may be developed and tested with synthetic data, but production use for Google-review drafting is blocked until the policy assessment described in `BUSINESS_RULES.md` is complete.

### 3.3 Regenerate a draft

Two interface patterns are possible: re-use the draft-generation operation with unchanged inputs, or expose a separate regenerate operation. The choice is an architecture decision.

Whichever pattern is selected:
- Server-side limits must apply.
- Current inputs must remain unchanged unless the customer edits them.
- Rating/sentiment must not be increased or altered.
- The prior draft must not be persisted by default.
- The API must return a clear limit-exceeded state when the allowance is exhausted.

### 3.4 Google handoff

The public business configuration supplies a validated Google review URL. The frontend opens that URL only after a deliberate customer action.

No backend endpoint shall submit review content, select a Google rating, authenticate as a customer, or automate Google's website.

## 4. Business-owner API

All operations in this section require an authenticated owner and server-side business authorization.

| Logical operation | Purpose | Core requirements |
|---|---|---|
| Create business | Create a business profile | Validate required fields; bind to authenticated owner/tenant. |
| List owner's businesses | Show authorized businesses | Return only businesses the current owner may access. |
| Get business details | Load owner configuration | Return owner-visible fields, not credentials/secrets. |
| Update business details | Change name, branding, public settings | Validate field lengths and allowed asset references. |
| Set Google review URL | Configure Google destination | Validate URL scheme/host and block unsafe destinations. |
| Create category | Add a service/category | Validate label; associate with the authorized business. |
| Update category | Edit label/order/status | Preserve stable category identifier where feasible. |
| Deactivate category | Stop new selections | Historical aggregate metrics may remain; customer page no longer offers it. |
| Generate QR | Create QR for public page | QR must encode only the intended public page URL; no rating/sentiment data. |
| Get analytics summary | View aggregate usage | No raw feedback or generated draft text. |

Potential logical paths (not yet finalized):

- `POST /owner/businesses`
- `GET /owner/businesses`
- `GET /owner/businesses/{business_id}`
- `PATCH /owner/businesses/{business_id}`
- `PUT /owner/businesses/{business_id}/google-review-url`
- `POST /owner/businesses/{business_id}/categories`
- `PATCH /owner/businesses/{business_id}/categories/{category_id}`
- `DELETE` or deactivate equivalent for a category
- `POST /owner/businesses/{business_id}/qr-code`
- `GET /owner/businesses/{business_id}/analytics`

The final CRUD semantics, pagination, upload flow, and route naming are architecture decisions.

## 5. Analytics/event requirements

Events may include:
- `public_page_viewed`
- `customer_flow_started`
- `category_selection_completed`
- `rating_selection_completed`
- `feedback_skipped` or `feedback_provided` (event only; never include text)
- `draft_generation_started`
- `draft_generation_succeeded`
- `draft_generation_failed`
- `draft_copied`
- `google_review_link_opened`

Rules:
- Do not include feedback or draft text in events.
- Avoid persistent customer-level tracking.
- Store aggregates per business where possible.
- Decide explicitly whether rating/category counts are needed; they are not automatically included merely because they are available in the request.
- Label `google_review_link_opened` accurately. It is not a submitted or published review.

## 6. Validation requirements

- Rating: integer in the inclusive range 1–5.
- Categories: non-empty selection for AI generation; IDs must be active and business-scoped.
- Feedback: optional string, trimmed, length-limited, safely encoded, treated as untrusted data.
- Language: accepted only if supported.
- Business URL: HTTPS in production; allow only approved URL patterns/hosts after safe validation; prevent open redirects and unsafe schemes.
- Uploaded logo: content type, size, dimensions, and file content must be checked server-side.
- Owner IDs and tenant IDs: derived from authenticated identity, not trusted from request body.

## 7. Rate limiting and idempotency

- Public generation requests require IP/session/business-aware abuse controls designed to minimize personal data.
- Owner authentication endpoints require brute-force protection.
- Regeneration caps are enforced server-side.
- Repeated clicks should not create parallel generation calls unintentionally.
- Consider an idempotency key for retryable generation requests; do not use it as a reason to retain customer text.
- Limits must not vary based on selected rating or sentiment.

## 8. Security and privacy requirements

- Enforce tenant isolation for all owner resources.
- Protect state-changing owner routes against CSRF where applicable.
- Validate and authorize every object ID to prevent IDOR/BOLA vulnerabilities.
- Never return secrets or AI provider errors to the browser.
- Redact generation request and response bodies from access logs, application logs, tracing, and error reporting.
- Avoid storing raw feedback or draft text in analytics.
- Apply secure CORS policy; do not use wildcard origins with credentials.
- Protect logo uploads and QR generation against resource abuse.
- Review AI provider data processing and retention before using real customer inputs.

## 9. API error catalogue (initial)

| Code | Meaning | Client behavior |
|---|---|---|
| `VALIDATION_ERROR` | Invalid/missing request fields | Show field-level guidance. |
| `BUSINESS_NOT_FOUND` | Public business ID does not resolve | Show unavailable page. |
| `BUSINESS_INACTIVE` | Business page disabled | Show unavailable page. |
| `CATEGORY_INVALID` | Category is unknown/inactive/not part of business | Ask customer to refresh and choose again. |
| `RATE_LIMITED` | Request quota/cooldown reached | Explain retry/fallback options. |
| `INSUFFICIENT_CONTEXT` | Inputs cannot support a meaningful draft | Offer direct Google-writing path. |
| `AI_PROVIDER_UNAVAILABLE` | Provider failed or timed out | Offer retry/fallback; preserve flow safely. |
| `AI_OUTPUT_INVALID` | Output failed validation | Do not display as a valid draft. |
| `UNAUTHORIZED` | Owner authentication absent/invalid | Ask owner to sign in. |
| `FORBIDDEN` | Authenticated owner lacks access | Do not disclose protected resource details. |
| `INTERNAL_ERROR` | Unexpected server failure | Show generic error with request ID. |

## 10. API decisions pending

1. Final route naming and versioning.
2. Session/authentication mechanism.
3. Category selection cardinality.
4. Supported language contract.
5. Generation and regeneration contract.
6. Rate-limit dimensions and values.
7. Whether QR output is generated server-side or client-side.
8. Logo upload/storage flow.
9. Analytics aggregation and retention.
10. Production enablement criteria for the AI draft endpoint after policy review.

---

**Document status:** Draft. Freeze the contracts during system design before the coding agent implements routes or schemas.
