# Software Requirements Specification (SRS)

## AI-Powered Google Review System

| Field | Value |
|---|---|
| Document status | Draft v0.1 — derived from PRD v0.1 |
| Last updated | 15 November 2026 |
| Scope | MVP software behavior and quality requirements |
| Source of truth | `PRD.md` |

> This document describes what the software must do. It does not select a framework, database, hosting provider, AI vendor, or final architecture. Those choices belong in the system-design phase.

---

## 1. Purpose and scope

The system provides a business-configured QR landing page where a customer can independently select the service/category relevant to their experience, choose a 1–5 star rating, optionally add written feedback, and request one AI-generated review draft. The customer can inspect, edit, regenerate within limits, copy, and manually submit the review on Google—or leave without submitting anything.

The MVP also provides a protected business-owner area to configure business details, service categories, the Google review URL, branding, QR code, and basic aggregate usage information.

This specification is subject to the product and platform-policy gates described in `PRD.md` and `BUSINESS_RULES.md`.

## 2. Users and roles

| Role | Capabilities |
|---|---|
| Public customer | View an active business page; select customer-controlled inputs; request and edit a draft; copy or abandon it; open the configured Google review URL. No account required. |
| Business owner | Authenticate; manage only their authorized business configuration; view aggregate usage data; generate/download the business QR code. |
| Platform operator | Operational access only where required for support and security, under least-privilege controls. Not an MVP customer-facing role. |

## 3. Functional requirements

Priority meanings: **M** = must-have for MVP; **S** = should-have; **TBD** = decision required before implementation.

### 3.1 Business account and configuration

| ID | Priority | Requirement |
|---|---|---|
| FR-BIZ-001 | M | The system shall allow an authorized business owner to sign in securely. |
| FR-BIZ-002 | M | The system shall associate each business configuration with an owner/tenant identity. |
| FR-BIZ-003 | M | An owner shall be able to create and edit the business display name and public page identifier. |
| FR-BIZ-004 | M | An owner shall be able to set and update the Google review destination URL. |
| FR-BIZ-005 | M | An owner shall be able to create, edit, reorder, activate, and deactivate service/category options. |
| FR-BIZ-006 | M | The system shall validate required configuration before making a public QR page active. |
| FR-BIZ-007 | S | An owner shall be able to upload or choose a business logo within documented file type and size limits. |
| FR-BIZ-008 | M | The system shall prevent one business owner from reading or changing another tenant's configuration. |
| FR-BIZ-009 | M | The system shall allow an owner to preview the customer-facing page before distributing its QR code. |

### 3.2 Public business page and QR access

| ID | Priority | Requirement |
|---|---|---|
| FR-PUB-001 | M | A QR code shall resolve to a unique public page associated with exactly one configured business. |
| FR-PUB-002 | M | The public page shall show the configured business identity and active service/category options. |
| FR-PUB-003 | M | The public page shall work on supported mobile browsers without requiring an app installation or customer account. |
| FR-PUB-004 | M | The system shall not expose private owner information or administrative functions on the public page. |
| FR-PUB-005 | M | Inactive, deleted, or misconfigured business pages shall show a safe unavailable state and shall not generate drafts. |
| FR-PUB-006 | M | The QR destination shall remain stable when non-routing business details are edited. |

### 3.3 Customer input

| ID | Priority | Requirement |
|---|---|---|
| FR-IN-001 | M | The customer shall independently choose a rating from 1 through 5. |
| FR-IN-002 | M | No rating shall be selected by default. |
| FR-IN-003 | M | The customer shall be able to select the service/category or categories that match their own experience. Single-select versus multi-select is **TBD** and must be resolved before UI implementation. |
| FR-IN-004 | M | Written feedback shall be optional; the customer shall be able to continue without entering text. |
| FR-IN-005 | M | The system shall validate customer inputs on the server, not only in the browser. |
| FR-IN-006 | M | The system shall enforce a configurable maximum feedback length. Exact limit is **TBD**. |
| FR-IN-007 | M | The customer shall be able to change their selected category/rating or optional feedback before generating a draft. |
| FR-IN-008 | M | The interface shall not imply that a 5-star rating is expected or preferred. |
| FR-IN-009 | S | The interface may offer supported language selection; MVP languages are **TBD**. |

### 3.4 AI draft generation

| ID | Priority | Requirement |
|---|---|---|
| FR-AI-001 | M | The backend shall send the approved business context and validated customer-selected inputs to the configured AI service. |
| FR-AI-002 | M | The system shall return one review draft per generation request. |
| FR-AI-003 | M | The generated draft shall reflect the selected service/category and rating and shall use optional written feedback when supplied. |
| FR-AI-004 | M | The generated draft shall not introduce unsupported claims about staff, speed, price, product quality, cleanliness, warranty, outcomes, or other experience details. |
| FR-AI-005 | M | The generated draft shall not convert a low or mixed rating into positive sentiment. |
| FR-AI-006 | M | If the input is insufficient to produce a grounded draft, the system shall return a controlled fallback rather than inventing detail. |
| FR-AI-007 | M | The system shall handle provider timeout, rate-limit, malformed response, and service-unavailable errors without exposing secrets or internal traces. |
| FR-AI-008 | M | Provider credentials shall remain server-side. |
| FR-AI-009 | M | Raw feedback and generated draft text shall not be persisted in the product database or routine logs by default. |
| FR-AI-010 | M | Each regeneration shall use the same current customer inputs unless the customer changes them. |
| FR-AI-011 | M | Generation and regeneration shall be subject to abuse and cost limits. The exact limits are **TBD**. |
| FR-AI-012 | M | The user interface shall identify the output as an AI-assisted draft that the customer must review and may edit or reject. |
| FR-AI-013 | M | The system shall not claim that a review has been submitted or published based on draft generation, copy, or link-click events. |
| FR-AI-014 | M | The production launch of structured-input-to-first-person-review generation is blocked until the platform-policy question in `BUSINESS_RULES.md` is reviewed and resolved. |

### 3.5 Customer review, copy, and Google handoff

| ID | Priority | Requirement |
|---|---|---|
| FR-HAND-001 | M | The customer shall be able to inspect and edit the generated text before copying it. |
| FR-HAND-002 | M | The customer shall be able to request regeneration within the configured limit. |
| FR-HAND-003 | M | The customer shall be able to reject the draft or leave the flow without publishing. |
| FR-HAND-004 | M | The system shall provide a copy action and a clear success/failure state. |
| FR-HAND-005 | M | The system shall open the configured Google review URL only after a deliberate customer action. |
| FR-HAND-006 | M | The customer shall independently choose the final rating and submit the review on Google's own interface. |
| FR-HAND-007 | M | The system shall provide the same Google handoff availability regardless of selected rating or sentiment. |
| FR-HAND-008 | M | The system shall not authenticate as the customer, submit content to Google, or automate Google UI interaction. |
| FR-HAND-009 | M | A customer shall be able to skip AI assistance and open the Google review page to write their own review. |

### 3.6 Analytics and operational metadata

| ID | Priority | Requirement |
|---|---|---|
| FR-MET-001 | M | The system shall record aggregate business-level counts for approved funnel events, subject to privacy and retention rules. |
| FR-MET-002 | M | Analytics shall not include raw feedback text, generated review text, customer name, phone, email, or Google account identifiers. |
| FR-MET-003 | M | The system shall distinguish page views, generation requests, successful generations, copy actions, and Google-link clicks. |
| FR-MET-004 | M | A Google-link click shall be labelled as a handoff/click, never as a published review. |
| FR-MET-005 | M | Operational telemetry shall capture service health, latency, error codes, and AI usage/cost metadata without recording customer text. |
| FR-MET-006 | TBD | Retention period, aggregation interval, and whether aggregate rating/category counts are retained must be decided before analytics implementation. |

## 4. Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-UX-001 | Usability | Customer flow shall be mobile-first and usable without account creation. |
| NFR-UX-002 | Accessibility | Controls shall have accessible labels, visible focus states, sufficient contrast, and keyboard/screen-reader support appropriate to the chosen UI framework. Target conformance level is to be confirmed during design. |
| NFR-COMP-001 | Compatibility | The public flow shall support current major mobile browsers on Android and iOS. Exact browser/version matrix shall be documented before release. |
| NFR-PERF-001 | Performance | Page-load and interaction budgets shall be defined in the architecture/design phase and measured on representative mobile devices and networks. |
| NFR-PERF-002 | Performance | AI generation shall expose a clear loading state, enforce a timeout, and avoid duplicate concurrent requests from repeated taps. Numeric latency targets are TBD after provider selection. |
| NFR-REL-001 | Reliability | Failure of the AI provider shall not prevent the customer from opening the direct Google review page. |
| NFR-SEC-001 | Security | All owner operations shall require authentication and server-side authorization. |
| NFR-SEC-002 | Security | Tenant isolation shall be enforced on every business-owned resource. |
| NFR-SEC-003 | Security | All network traffic shall use HTTPS in production. |
| NFR-SEC-004 | Security | Secrets, tokens, and AI provider keys shall not be exposed to the browser or committed to source control. |
| NFR-PRIV-001 | Privacy | The customer flow shall not require name, email, phone, or Google login. |
| NFR-PRIV-002 | Privacy | Raw feedback and generated drafts shall not be stored persistently by default. Provider-side handling must be disclosed and reviewed. |
| NFR-OBS-001 | Observability | Errors shall be diagnosable using correlation identifiers and redacted metadata, not customer content. |
| NFR-MAINT-001 | Maintainability | Business rules, AI prompts, provider settings, and limits shall be separated from UI-specific code where practical. |

## 5. Input and output data requirements

### 5.1 Draft-generation input (conceptual)

```json
{
  "business_public_id": "shop-public-id",
  "selected_categories": ["seat-cover-installation"],
  "rating": 5,
  "feedback": "Optional short customer text",
  "language": "en"
}
```

The exact category cardinality and language field are pending product decisions. The business name, public ID, and category labels must be loaded from trusted server-side configuration; the client must not be able to substitute arbitrary business identity or system instructions.

### 5.2 Draft-generation output (conceptual)

```json
{
  "draft": "Customer-editable draft text",
  "status": "generated",
  "generation_id": "opaque-short-lived-id",
  "remaining_regenerations": 1
}
```

The example is illustrative. The response must not imply Google submission or publication. Error responses must be consistent and must not expose provider internals.

## 6. External dependencies

- AI generation provider (vendor to be selected).
- Google review destination URL configured by each business.
- QR-code generation capability.
- Hosting, database, authentication, and observability services (to be selected during design).

No Google Business Profile API integration is required for the MVP.

## 7. Open requirements decisions

1. Category selection: single or multiple.
2. Whether one overall rating applies to the selected category set.
3. Supported languages for the first pilot.
4. Maximum optional-feedback length.
5. Maximum generations per session and per business/time window.
6. Aggregate analytics fields and retention.
7. Owner authentication and account recovery behavior.
8. Logo file restrictions and storage approach.
9. Final UX and policy treatment for category/rating-only drafts.
10. Whether production launch may proceed after policy review or whether the drafting behavior must be changed.

## 8. Requirements traceability

| PRD section | SRS coverage |
|---|---|
| PRD 6 — MVP scope | FR-BIZ, FR-PUB, FR-IN, FR-AI, FR-HAND, FR-MET |
| PRD 7 — Out of scope | FR-HAND-008 and business rules |
| PRD 9 — AI requirements | FR-AI-001 through FR-AI-014 |
| PRD 10 — Privacy | FR-AI-009, FR-MET-002, NFR-PRIV |
| PRD 11 — Google policy | FR-AI-014, FR-HAND-007, FR-HAND-008, business rules |
| PRD 12 — Success metrics | FR-MET and NFR-OBS |

---

**Document status:** Draft for review. Requirements marked TBD must be resolved before their corresponding implementation tasks are started. The system design must trace each implemented feature to one or more requirement IDs.
