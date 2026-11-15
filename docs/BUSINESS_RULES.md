# Business Rules and Product Invariants

## AI-Powered Google Review System

| Field | Value |
|---|---|
| Document status | Draft v0.1 |
| Last updated | 15 November 2026 |
| Source documents | `PRD.md`, `SRS.md`, `USER_FLOWS.md` |

> These rules are product-level constraints. They apply regardless of frontend framework, backend language, database, or AI provider.

---

## 1. Customer control and authenticity

| ID | Rule |
|---|---|
| BR-001 | A customer must independently decide whether to use the review-assistance flow. |
| BR-002 | A customer must independently select their rating. The application must not preselect or recommend a rating. |
| BR-003 | A customer may select only service/category options that accurately match their own experience. |
| BR-004 | Written feedback is optional. The product must not force a long-form response. |
| BR-005 | The customer must be able to inspect, edit, reject, or abandon an AI draft. |
| BR-006 | The customer, not the business owner or application, controls the final Google rating, text, and submission. |
| BR-007 | The application must never represent a draft, copy action, or Google-link click as a published review. |
| BR-008 | The customer must be able to use the direct Google-writing path without using AI. |

## 2. Equal treatment of ratings

| ID | Rule |
|---|---|
| BR-010 | The same product capabilities and Google handoff must be available for every rating from 1 to 5. |
| BR-011 | The system must not hide, delay, redirect, or block the Google handoff because of a low rating or negative text. |
| BR-012 | The system must not send negative feedback to a private complaint form while routing positive feedback to Google as a review-gating strategy. |
| BR-013 | AI must preserve the direction and approximate intensity of the customer's selected rating and feedback. |
| BR-014 | AI must not rewrite criticism into praise, raise the implied rating, or remove important negative information to make the business look better. |

## 3. Category and rating rules

| ID | Rule |
|---|---|
| BR-020 | Categories are factual descriptions of services or experiences offered by the business; they are not prewritten review statements. |
| BR-021 | A business may configure available categories, but cannot select categories on behalf of a customer during the customer flow. |
| BR-022 | The customer chooses the category/category set that matches the experience they personally had. |
| BR-023 | The rating represents the customer's own overall experience for the flow. Whether rating is overall or per category remains an open product decision. |
| BR-024 | A category selection does not prove unselected attributes such as speed, staff friendliness, price, cleanliness, quality, or outcome. |
| BR-025 | No rating or category may be selected automatically through URL parameters, hidden defaults, or owner configuration. |

## 4. AI content rules

| ID | Rule |
|---|---|
| BR-030 | AI is a writing assistant, not an experience simulator. |
| BR-031 | AI may improve grammar, clarity, and readability but must not invent factual claims. |
| BR-032 | Optional customer feedback is the strongest source of specific factual details; the system must preserve its meaning. |
| BR-033 | For structured-input-only requests, output must be limited to what the selected category and rating actually establish. If that is insufficient for a meaningful draft, the system must use a fallback. |
| BR-034 | AI must not introduce the name of an employee, a specific product model, duration, price, warranty, technical result, or other detail unless supplied by the customer or explicitly confirmed by the customer. |
| BR-035 | The system must not generate multiple reviews in a single response. One current draft is returned per generation request. |
| BR-036 | Regeneration uses the same current inputs unless the customer changes those inputs. |
| BR-037 | Regeneration must not be a mechanism for finding a more positive review or changing the customer's rating. |
| BR-038 | The customer is responsible for checking and approving the final content before copying it. |
| BR-039 | AI prompts and customer feedback are untrusted data. Customer text must not override system instructions or safety rules. |

## 5. Privacy and data rules

| ID | Rule |
|---|---|
| BR-040 | The customer flow must not require a customer's name, phone number, email address, or Google credentials. |
| BR-041 | Raw feedback and generated draft text must not be persisted in the product database by default. |
| BR-042 | Raw customer text must not be included in routine application logs, analytics, traces, or error reports. |
| BR-043 | Persist business configuration and operational metadata only to the extent required for product operation, security, and aggregate analytics. |
| BR-044 | If a selected AI provider may retain or use submitted text, that provider behavior must be evaluated and accurately disclosed before public launch. |
| BR-045 | Do not claim that customer text is never retained by any party unless the AI provider's current contract, settings, and actual processing support that claim. |
| BR-046 | Any short-lived session identifiers used for abuse prevention must be minimized, protected, and subject to a defined expiry. |

## 6. Business-owner rules

| ID | Rule |
|---|---|
| BR-050 | Business owners can edit only businesses they are authorized to manage. |
| BR-051 | Business owners may configure business identity, relevant service categories, branding, and the Google review destination. |
| BR-052 | Business owners cannot configure the customer's rating, alter customer feedback, or approve the customer's review on their behalf. |
| BR-053 | Business owners must not ask staff to enter ratings, select categories, or publish reviews for customers. |
| BR-054 | The QR code must lead to the configured business page and must not contain a rating or sentiment parameter. |
| BR-055 | The system must not provide a setting to show the QR flow only to customers expected to be satisfied. |

## 7. Google handoff rules

| ID | Rule |
|---|---|
| BR-060 | The application only prepares a draft and opens the business's configured review destination. |
| BR-061 | The customer independently chooses the Google rating, final text, and submit action on Google's interface. |
| BR-062 | No Google login, review posting API, browser automation, or automatic submission is part of the MVP. |
| BR-063 | The business's review URL must be validated and owner-controlled before activation. |
| BR-064 | No incentive, payment, discount, gift, or benefit may be tied to writing, changing, or removing a review. |
| BR-065 | The customer must not be pressured to leave a review or rating while on the business premises. |
| BR-066 | The business must not request specific content to be included in a Google review. Staff guidance must remain neutral. |

## 8. Product cost and abuse rules

| ID | Rule |
|---|---|
| BR-070 | AI generation and regeneration must have per-session and/or per-business limits. |
| BR-071 | Limit enforcement must occur server-side. Client-only counters are not sufficient. |
| BR-072 | A duplicate tap or retry must not unintentionally trigger unlimited AI requests. |
| BR-073 | Abuse controls must not discriminate based on rating or sentiment. |
| BR-074 | When a limit is reached, the customer must still be able to edit visible text, abandon the flow, or use the direct Google-writing path where available. |

## 9. Critical Google policy launch gate

Google's current Maps user-generated content policy says reviews and ratings must reflect genuine, unbiased experiences. Its prohibited-content guidance says merchants must not discourage negative reviews, selectively solicit positive reviews, offer incentives, pressure people to leave ratings/reviews while on the premises, or request specific content to be included. Google's policy overview says its rules apply to both human- and AI-generated content.

Official references checked on 15 November 2026:

- Google: Create a Google link or QR code to request reviews — https://support.google.com/business/answer/16816815
- Google: Tips to get more reviews — https://support.google.com/business/answer/3474122
- Google Maps: Prohibited & restricted content — https://support.google.com/contributionpolicy/answer/7400114
- Google Maps: About our policies — https://support.google.com/contributionpolicy/answer/7400113

### Product-specific unresolved risk

The intended experience asks a customer to select a service/category and a rating, then uses AI to draft first-person review wording—even when the customer supplies no written feedback. Customer control and genuine experience are important safeguards, but they do not by themselves prove that this workflow is acceptable under Google's rule against merchants requesting specific review content. The category-selection step and AI authorship need careful policy interpretation.

### Required gate before public Google-review pilot

- [ ] Review the latest official Google policies immediately before launch.
- [ ] Obtain an informed policy/legal assessment of the structured-input-to-first-person-draft flow.
- [ ] Confirm the business invitation is neutral, optional, and does not pressure customers on premises.
- [ ] Confirm the interface does not direct customers to provide particular words or a particular rating.
- [ ] Confirm all ratings have equal access and negative feedback is not filtered.
- [ ] Record the decision and any required product changes in `docs/DECISIONS.md` (to be created during system design) or the project decision log.

**Until this gate is resolved, treat the Google-facing production feature as not approved for public launch.** A local prototype using synthetic test inputs can be built for engineering evaluation, but it must not be presented as policy-approved or used to solicit live Google reviews.

---

**Document status:** Draft. These rules are intended to be invariant across implementation. A technical shortcut must not weaken them.
