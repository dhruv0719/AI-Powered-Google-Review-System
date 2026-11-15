# Product Requirements Document (PRD)

## AI-Powered Google Review System

| Field | Value |
|---|---|
| Document status | Draft v0.1 — for product review |
| Last updated | 15 November 2026 |
| Product stage | MVP discovery |
| Initial pilot | One local car accessories / installation business |
| Document owner | Product team |

> **Purpose:** Define the customer and business problem, product outcome, MVP scope, user journeys, constraints, and success measures before system architecture or implementation begins.

---

## 1. Product summary

The AI-Powered Google Review System is a QR-based, mobile-first tool that helps customers express a genuine experience as a clear review draft with less writing effort.

A customer scans a business's QR code, selects the service or experience they want to describe, chooses their own rating, and may optionally add a few words of feedback. The AI creates one editable review draft from those inputs. The customer can edit or regenerate the draft, copy it, open the business's Google review page, and independently submit their review.

The product is intended to reduce the effort involved in writing—not to choose a rating, manufacture an experience, or guarantee positive reviews.

### Product in one sentence

**Help customers turn their own service selection, rating, and optional feedback into an editable review draft, then let them decide whether and what to publish.**

## 2. Problem statement

### 2.1 Current problem

Some local businesses report difficulty getting customers to write reviews because writing takes time or customers do not know what to say. In the workflow observed by the founder, a business owner may take a customer's phone and type a short review on the customer's behalf.

That approach creates several problems:

- It asks the business owner to do work for every review.
- The review may reflect the owner's wording rather than the customer's own account.
- Customers who are willing to rate a service may abandon the process because writing feels like effort.
- Reviews can become repetitive and provide little useful detail to future customers.

### 2.2 Customer problem

A customer may have had a real experience and be willing to leave an honest rating, but may not want to compose a full paragraph. Some customers may only be comfortable selecting a service and rating, or typing a few words.

### 2.3 Business problem

The business wants a simple, repeatable way to invite customers to leave their own reviews without needing staff to operate the customer's phone or write review text for them.

### 2.4 Problem hypothesis to validate

If customers can create and review a draft using a service/category selection and their own rating—with optional short feedback—more customers may be willing to complete the review-writing step.

This is a hypothesis, not a proven outcome. The pilot must measure whether the flow is genuinely easier and whether customers are comfortable using it.

## 3. Product vision and principles

### 3.1 Vision

Make it easier for customers to express genuine business experiences in their own words, while giving local businesses a simple way to make the review process accessible.

### 3.2 Product principles

1. **Customer controls the review:** The customer chooses the rating, selects what experience to describe, reviews the generated text, edits it if needed, and decides whether to publish.
2. **Low friction:** Written feedback is optional. A customer should not have to write a paragraph to use the product.
3. **Faithful representation:** AI must not invent facts, events, service details, staff behavior, prices, timing, or outcomes that the customer did not provide or select.
4. **Equal treatment of ratings:** The flow must work consistently for 1–5 star selections. Negative or mixed experiences must not be blocked, hidden, or diverted away from Google.
5. **Business simplicity:** A business owner should be able to configure the page and display a QR code without technical knowledge.
6. **Privacy by design:** Do not collect customer identity details when they are not required. Avoid retaining raw feedback and generated review text in the product database.
7. **No artificial review activity:** The product must not post reviews automatically, impersonate customers, offer incentives, or pressure customers to leave reviews.

## 4. Target users

### 4.1 Primary user: Customer

A person who has genuinely purchased a product or received a service from the business and chooses to provide feedback.

Needs:
- A quick, mobile-friendly experience.
- The ability to select their own rating.
- The ability to describe the relevant service or category.
- The option to add a few words, without being forced to write.
- Control to inspect, edit, reject, copy, and submit the review themselves.

### 4.2 Secondary user: Business owner / manager

The person responsible for configuring the business review page and making the QR code available to customers.

Needs:
- A way to configure business name, logo/branding, services/categories, and Google review URL.
- A QR code that opens the correct business review-assistance page.
- Basic aggregate usage information, without needing customer personal data.
- A simple way to update business details and service categories.

### 4.3 Initial target segment

The first pilot is planned with one local car accessories / installation business. The initial use case is a customer who has purchased or received a service such as seat-cover installation or another service configured by the business.

Other local service businesses may be considered later, but the first pilot should validate one business and one real customer journey before broadening the target segment.

## 5. Value proposition

### For customers
- Less effort than writing a review from a blank page.
- Ability to provide feedback through simple selections.
- Optional text input for customers who want to add detail.
- Full control over the final review and whether to publish it.

### For businesses
- A reusable QR-based review-assistance flow.
- Less need for staff to type review text for customers.
- A consistent business-branded experience.
- Basic insight into use of the QR and review-assistance flow.

### Product positioning

Position the product as a **customer-controlled, AI-assisted review drafting and handoff tool**. Do not position it as a way to guarantee five-star reviews, manipulate Google ratings, or automatically publish reviews.

## 6. MVP scope

### 6.1 Customer-facing features (MVP)

| ID | Feature | Requirement |
|---|---|---|
| C-01 | QR landing page | A customer scanning a business QR code opens a mobile-first page for the correct business. |
| C-02 | Business identity | Show the configured business name and approved branding. |
| C-03 | Service/category selection | Customer can select the service or experience they want to describe from the business's configured options. Exact single-select vs multi-select behavior remains an open decision. |
| C-04 | Rating selection | Customer independently selects a rating from 1 to 5. No rating is preselected. |
| C-05 | Optional written feedback | Customer may leave a short comment or skip the field. It must not be required to proceed. |
| C-06 | AI draft generation | Generate one review draft using the rating, selected category/service, and any optional feedback supplied by the customer. |
| C-07 | Draft editing | Customer can edit the generated text before copying it. |
| C-08 | Regeneration | Customer can request another draft using the same original inputs. Apply a configurable abuse/cost limit. |
| C-09 | Customer confirmation | Before leaving the product, clearly ask the customer to confirm that the draft accurately represents their own experience. |
| C-10 | Copy review | Customer can copy the approved text to the clipboard. |
| C-11 | Google handoff | Open the configured Google review URL in a separate navigation step. The customer manually selects the matching Google star rating, pastes or edits the text, and submits it. |
| C-12 | Alternative path | A customer can skip AI assistance and open the Google review page to write their own review. |

### 6.2 Business-facing features (MVP)

| ID | Feature | Requirement |
|---|---|---|
| B-01 | Business configuration | An authorized owner can create or update the business profile used by the customer page. |
| B-02 | Google review URL | Owner can configure the business's Google review link. |
| B-03 | Services/categories | Owner can add, edit, reorder, and deactivate service/category options. |
| B-04 | Branding | Owner can configure basic business identity elements, such as name and logo, within defined upload constraints. |
| B-05 | QR generation | System can create a QR code tied to the business's review-assistance page. |
| B-06 | Basic analytics | Owner can see aggregate counts such as page visits, generation requests, copy actions, and Google-link clicks, subject to privacy and measurement constraints. |
| B-07 | Configuration validation | System validates required configuration, including a usable Google review URL, before enabling the QR page. |

### 6.3 Platform / operational capabilities (MVP)

- Secure business-owner authentication and authorization.
- Server-side validation of customer inputs.
- AI provider integration through the backend; provider credentials must never be exposed in the browser.
- Request limits for generation and regeneration.
- Safe error handling when the AI provider is unavailable or returns invalid output.
- Operational metadata for troubleshooting and usage accounting, without logging raw customer feedback or generated review content by default.
- Basic monitoring for availability, latency, errors, and AI usage/cost.

## 7. Out of scope for the MVP

The following are explicitly not part of the first release:

- Automatically posting a review to Google.
- Accessing or controlling a customer's Google account.
- Automatically selecting or submitting a Google star rating.
- Writing or posting reviews on behalf of customers or business owners.
- Owner-side ability to choose or change a customer's rating.
- Hiding the Google review route based on a low rating or negative feedback.
- Routing only satisfied customers to Google (review gating).
- Incentives, discounts, gifts, rewards, or contests tied to leaving or changing a review.
- Google Business Profile review-management APIs or automated review replies.
- AI-generated owner replies to existing reviews.
- Multi-location enterprise management, agency accounts, or complex role hierarchies.
- Deep CRM, POS, billing, or loyalty-program integrations.
- Guaranteed ranking improvements, review volume, or positive-rating outcomes.

## 8. Core user journeys

### 8.1 Customer journey

1. Customer has a genuine experience with the business.
2. Business makes a neutral review QR code/link available; the customer chooses whether to use it.
3. Customer scans the QR code and sees the business identity.
4. Customer selects the service/category that matches their own experience.
5. Customer independently chooses a 1–5 star rating; the form does not preselect a value.
6. Customer may add a few words or skip the optional feedback field.
7. Customer requests an AI-generated draft.
8. Customer reads the draft, edits it or regenerates it if needed.
9. Customer confirms the text accurately represents their own experience.
10. Customer copies the text and opens the Google review page.
11. On Google, the customer independently chooses the appropriate star rating, pastes or edits the text, and submits—or chooses not to submit.

### 8.2 Business-owner journey

1. Owner signs in to the product.
2. Owner creates or updates the business profile.
3. Owner adds the correct Google review URL.
4. Owner configures the services/categories that customers may choose from.
5. Owner adds business branding within the allowed configuration options.
6. Owner generates and downloads the QR code.
7. Owner displays or shares the QR code as a neutral invitation; staff do not pressure customers or complete reviews on their behalf.
8. Owner checks aggregate product-usage metrics and updates business configuration when needed.

## 9. AI product requirements

### 9.1 Input contract

The generation request may contain:
- Business display name or other approved business context, if needed for the draft.
- Customer-selected service/category values.
- Customer-selected rating (1–5).
- Optional customer-written feedback.
- Selected output language, if language selection is included in the MVP (to be decided).

The system must not infer that a customer used a service merely because it is available in the business's catalogue. Only customer-selected categories may be considered as input.

### 9.2 Generation behavior

- Generate one concise, natural-sounding draft per request.
- Use only the information in the generation input and carefully bounded implications of the customer's selected rating.
- When written feedback is present, preserve its meaning and do not introduce unsupported claims.
- When written feedback is absent, create only a minimal draft grounded in the selected category and rating. Do not add details such as staff friendliness, speed, price, quality, cleanliness, or specific outcomes unless provided by the customer.
- Do not change the sentiment implied by the rating or rewrite a low rating as a positive review.
- Do not include promotional copy, keywords inserted for search ranking, requests to mention a staff member, or claims that the customer did not provide.
- Do not make the generated text sound like a verified testimonial if the available input does not support that level of detail.
- Return a clear fallback when the input is insufficient to create a meaningful draft; the customer must still be able to open Google and write independently.

### 9.3 Regeneration behavior

- Regeneration uses the same customer-provided inputs unless the customer edits them.
- Regeneration must not be used to search for a more positive sentiment or higher rating.
- Apply a reasonable request limit and communicate it clearly.
- Do not persist prompts or outputs merely to support regeneration; retain only necessary operational counters unless a later, explicitly approved product decision changes this rule.

### 9.4 Customer review and approval

The generated result is a draft, not a submitted review. The customer must be able to inspect and edit it. The final screen must make clear that the customer is responsible for ensuring that the text and rating match their actual experience.

## 10. Privacy and data principles

### 10.1 Data minimization

The MVP should not request customer name, phone number, email address, Google login, or other identifying information for the review-drafting flow.

### 10.2 Persistence policy

Expected persistent product data:
- Business account and configuration data.
- Business services/categories.
- Google review URL.
- QR identifier and business-page identifier.
- Aggregate usage counters and operational metadata.

Customer feedback and generated review text should not be stored in the product database by default. They should not appear in application logs, analytics event properties, error traces, or support tooling by default.

### 10.3 Third-party AI processing

Optional feedback must be sent to an AI provider to generate a draft. Before launch, the team must review the provider's data handling, retention, training, and deletion terms. The product must not promise that no data is retained anywhere unless the selected provider's terms and configuration support that statement.

### 10.4 Open privacy decisions

- Whether a short-lived, in-memory/session-only copy is needed for retry behavior.
- Which AI provider and data-retention settings are acceptable.
- How long operational logs and aggregate analytics are retained.
- Whether the product needs a customer-facing privacy notice or consent step for AI processing.

## 11. Google policy and platform constraints

Google permits businesses to share review links and QR codes, but reviews and ratings must reflect genuine experiences. Google's Maps policies prohibit fake engagement, rating manipulation, incentives in exchange for reviews, selectively soliciting positive reviews, and pressuring customers to leave reviews or ratings. Google also states that its Maps content policies apply to AI-generated content.

Product implications:

- QR distribution is an invitation, not a requirement. Do not require or pressure customers to review while on the premises.
- The business must not provide an incentive in exchange for a review, revision, or removal.
- Every rating from 1 to 5 must have the same access to the Google handoff.
- Do not use review gating, sentiment-based routing, or negative-review suppression.
- The business owner and staff must not select ratings, dictate review wording, or submit reviews while impersonating customers.
- The customer must independently review, edit, and submit any content they choose to publish.
- AI output must be grounded in the customer's actual experience and must not fabricate claims.
- Do not promise that Google will publish a generated review or that use of the product is endorsed by Google.

**Policy risk requiring validation:** Google explicitly applies its content policies to AI-generated contributions. The exact acceptability of a workflow that drafts first-person review text from structured selections alone is not guaranteed by the fact that the customer approves it. Before public launch, review the latest Google policy and consider obtaining appropriate policy/legal advice. If a draft cannot be grounded in enough customer-provided information, the product should offer the direct Google-writing path instead of inventing an experience.

Official references (review again before launch):
- Google Business Profile Help — Create a Google link or QR code to request reviews: https://support.google.com/business/answer/16816815
- Google Maps User-Generated Content Policy — Prohibited and restricted content: https://support.google.com/contributionpolicy/answer/7400114
- Google Maps User-Generated Content Policy — About our policies (including AI-generated content): https://support.google.com/contributionpolicy/answer/7400113
- Google Business Profile Help — Tips to get more reviews: https://support.google.com/business/answer/3474122

## 12. Success metrics

The MVP should measure ease of use, reliability, and genuine customer control—not the proportion of positive reviews or an increase in average star rating.

### 12.1 Product funnel metrics

- QR landing-page visits.
- Customer starts (first meaningful interaction with the form).
- Rating/category selections completed.
- AI generation requests and successful generations.
- Draft copy actions.
- Google review-link click-throughs.
- Drop-off between each step.

These are workflow events, not proof that a review was submitted or published on Google.

### 12.2 Quality and reliability metrics

- Page load and interaction latency.
- AI generation success rate and latency.
- Rate of invalid or unusable AI outputs.
- Regeneration frequency.
- Customer edits to generated drafts, measured only in a privacy-preserving way and without storing the draft text.
- Error rate for QR routing and Google-link handoff.

### 12.3 Business validation metrics

- Time required for an owner to configure the business page and obtain a QR code.
- Whether staff can explain the flow without taking over the customer's device.
- Owner satisfaction with setup and ongoing use.
- Whether the business is willing to continue using and pay for the product after the pilot.

### 12.4 Trust and safety indicators

- No review gating or rating-based diversion.
- No incentives tied to review submission.
- No customer identity data collected by default.
- No raw feedback or generated review text in routine logs.
- Customer can edit, reject, or abandon the draft.
- No automated review submission.
- Complaints or reports about inaccurate AI-generated wording are investigated.

Numerical targets should be set after baseline observation during the pilot rather than invented before real usage data exists.

## 13. MVP release acceptance at product level

The MVP is ready for a controlled pilot when:

1. The pilot business can configure its name, branding, Google review URL, and service/category options.
2. A QR code reliably opens the correct business page on common mobile browsers.
3. A customer can independently select a category and 1–5 rating, with no default rating.
4. Written feedback is optional and can be skipped.
5. AI generates at most one draft at a time and follows the grounding rules in Section 9.
6. Customers can edit, regenerate within limits, copy, or reject the draft.
7. All ratings have the same Google handoff path.
8. The customer is responsible for choosing the final Google rating and submitting the review.
9. The product does not automatically post, authenticate as the customer, or store customer identity details.
10. Raw feedback and generated text are not retained in the product database or routine logs by default.
11. Basic aggregate usage and operational metrics work without exposing customer content.
12. Policy and privacy checks required for the pilot have been completed and documented.

## 14. Assumptions and risks

| Type | Assumption / risk | Response |
|---|---|---|
| Product assumption | Customers are more willing to select categories and stars than write a review from scratch. | Validate through observed pilot usage and customer feedback. |
| Product risk | Some customers may not consider a rating/category selection enough context for a meaningful review draft. | Keep drafts minimal; provide a direct Google-writing fallback. |
| Trust risk | AI may add unsupported claims or exaggerate sentiment. | Constrained generation, output checks, customer confirmation, and test cases across all ratings. |
| Platform risk | Google may treat some AI-assisted review workflows as non-genuine or manipulated. | Follow current policy, keep customer in control, and validate before public rollout. |
| Adoption risk | Owners may continue writing reviews for customers rather than letting customers control the flow. | Design the QR experience for the customer's own device and train pilot staff on neutral invitations. |
| Privacy risk | AI provider or observability tooling may retain customer feedback. | Review provider terms and redact content from logs and telemetry. |
| Measurement risk | A click on the Google link does not prove a review was submitted. | Report clicks as handoff events only; do not label them published reviews. |

## 15. Open product decisions

These questions must be resolved before finalizing detailed requirements and system design:

1. **Category selection:** Can the customer select one service/category or multiple?
2. **Rating interaction:** Is one overall 1–5 rating enough, or should ratings be associated with individual categories? MVP recommendation: one overall rating.
3. **Rating-only output:** What is the minimum acceptable output when feedback is blank? Define when to generate a minimal draft versus offer direct Google writing.
4. **Language:** Which language(s) are required for the first pilot (for example, English, Gujarati, Hindi)?
5. **Business configuration:** Which fields are mandatory, and who is allowed to edit them?
6. **Regeneration limit:** How many generations per customer session are allowed?
7. **Analytics:** Which aggregate events are essential to the owner, and what retention period is appropriate?
8. **Pricing:** What pricing model and willingness-to-pay hypothesis should be tested with the first business?
9. **Pilot definition:** Which business will be used, who will configure it, and how will customer feedback be collected without pressuring customers?
10. **Policy validation:** What review of Google's current rules is needed before real customers use AI-generated drafts?

## 16. Current decisions register

| ID | Decision | Status |
|---|---|---|
| D-001 | Customer written feedback is optional. | Agreed |
| D-002 | Customer-selected rating and service/category are core inputs. | Agreed |
| D-003 | AI generates one draft at a time. | Agreed |
| D-004 | Customer can regenerate a draft. | Agreed; limit TBD |
| D-005 | Customer can edit and must approve the draft before copying. | Proposed product requirement |
| D-006 | Customer manually opens Google and submits the review. | Agreed |
| D-007 | Do not persist customer identity, raw feedback, or generated review text by default. | Agreed direction; provider retention TBD |
| D-008 | Persist business configuration and aggregate operational metadata. | Agreed direction |
| D-009 | All ratings receive the same review handoff; no review gating. | Required product constraint |

---

**Document status:** This PRD is a working draft. Product decisions in Sections 15 and 16 should be reviewed before the PRD is treated as approved. Architecture, database schema, API contracts, and implementation tasks should be derived from the approved requirements—not invented independently by a coding agent.
