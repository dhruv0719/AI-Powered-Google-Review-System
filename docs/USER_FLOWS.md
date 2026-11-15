# User Flows

## AI-Powered Google Review System

| Field | Value |
|---|---|
| Document status | Draft v0.1 |
| Last updated | 15 November 2026 |
| Source documents | `PRD.md`, `SRS.md` |

> These flows describe intended product behavior. The live Google review solicitation and AI-drafting flow remains subject to the platform-policy gate in `BUSINESS_RULES.md`.

---

## 1. Actors

- **Customer:** A person with a genuine experience at the business who independently chooses whether to use the review-assistance flow.
- **Business owner/manager:** Configures the public page, service categories, review URL, branding, QR code, and aggregate analytics.
- **System:** Serves the page, validates inputs, requests AI output, applies limits, and records minimal operational metadata.
- **AI provider:** Generates draft wording from approved inputs. It does not decide the customer's rating or submit a review.
- **Google:** Hosts the final review interface and controls review submission/publication.

## 2. Customer flow — intended happy path

```text
Customer opens QR/link
        |
        v
Resolve active business page
        |
        v
Show business identity and neutral explanation
        |
        v
Customer selects relevant service/category
        |
        v
Customer independently selects 1–5 rating
        |
        v
Customer optionally enters short feedback
        |
        v
Customer chooses "Generate draft"
        |
        v
Validate inputs + apply abuse limits
        |
        v
Generate one AI draft
        |
        v
Customer reviews and edits draft
        |
        +------> Reject / leave without publishing
        |
        v
Customer confirms draft reflects own experience
        |
        v
Copy draft
        |
        v
Customer chooses "Open Google review page"
        |
        v
Customer independently selects final Google rating,
pastes/edits text, and submits—or abandons
```

### Flow details

1. The customer scans a QR code or opens a link voluntarily.
2. The system resolves the public business identifier and loads only active public configuration.
3. The page clearly identifies the business and explains that AI assistance is optional.
4. The customer selects only the service/category that matches their own experience.
5. The customer chooses a rating; no value is preselected.
6. The feedback field is visibly optional and can be skipped.
7. The customer initiates generation. Nothing is generated merely because the page loaded.
8. The system sends validated inputs to the configured AI provider under the approved data-handling policy.
9. The customer sees one draft and can edit it, regenerate it within limits, copy it, or reject it.
10. The customer must make the final decision. The application does not claim the review was published.

## 3. Customer flow — rating and category only

**Purpose:** Support the product's low-friction use case when the customer does not want to type.

1. Customer selects the relevant category/categories.
2. Customer independently selects a rating.
3. Customer leaves optional feedback blank.
4. Customer requests a draft.
5. The generation service uses only those structured inputs and trusted business context.
6. The output must not invent details about people, speed, cost, product quality, cleanliness, or specific outcomes.
7. If the system cannot produce a meaningful and adequately grounded draft, it shows a helpful fallback and offers the customer the direct Google-writing path.

**Important:** Whether this structured-input-only first-person drafting flow is acceptable under Google's current review policies is unresolved. It must not be released publicly until the policy gate is cleared. See `BUSINESS_RULES.md`.

## 4. Customer flow — optional feedback provided

1. Customer selects category and rating.
2. Customer enters a few words or a short sentence in their own words.
3. The system treats this text as untrusted customer input, not as instructions to override system rules.
4. AI rewrites for clarity while preserving the customer's meaning and sentiment.
5. The output must not add unsupported claims or omit material negative feedback.
6. Customer reviews and edits the draft before any copy or Google handoff.

## 5. Customer flow — negative or mixed experience

1. Customer selects 1, 2, or 3 stars where that matches their experience.
2. The same categories, optional feedback, AI assistance, editing, copy, and Google handoff features remain available.
3. The application does not display a special complaint-only route that blocks Google.
4. The AI must preserve negative or mixed sentiment and must not try to convert it into praise.
5. The customer may choose not to publish.

## 6. Customer flow — regenerate

1. Customer sees the first draft.
2. Customer chooses regenerate.
3. The system checks the regeneration allowance and rate limit.
4. The next generation uses the same current inputs; it does not automatically alter the rating or category.
5. The prior text is replaced in the current interface or made available for comparison only if this behavior is approved in UI design. No draft history is persisted by default.
6. If the limit is reached, the system explains the limit and still allows editing, copying, or direct Google handoff where available.

## 7. Customer exception and recovery flows

| Scenario | Expected behavior |
|---|---|
| Business page not found/inactive | Show a neutral unavailable page; do not expose internal details. |
| Business configuration incomplete | Disable draft generation; provide safe recovery or direct support route. |
| No category selected | Ask customer to select a valid category before generation. |
| No rating selected | Ask customer to choose their own rating; never insert a default. |
| Feedback exceeds limit | Explain the limit and allow correction; do not silently truncate material meaning. |
| AI provider timeout/unavailable | Explain that draft generation is temporarily unavailable; keep customer input in the current page only as needed; offer direct Google-writing path. |
| AI returns invalid/unsupported output | Do not show it as a valid draft; retry only under controlled rules or show fallback. |
| Rate limit reached | Explain when/how the customer can continue; do not bypass controls. |
| Clipboard permission denied | Show selectable text and simple manual-copy instructions. |
| Google URL invalid/unavailable | Do not open an untrusted destination; show a safe error and owner configuration guidance. |
| Customer closes page | Do not claim a review was submitted. Avoid persistent draft recovery unless a later privacy decision explicitly approves it. |

## 8. Business-owner flow — setup

```text
Owner opens admin portal
        |
        v
Sign in
        |
        v
Create/select authorized business
        |
        v
Enter business name and public page details
        |
        v
Set Google review URL
        |
        v
Configure service/category options
        |
        v
Add optional brand assets
        |
        v
Preview public customer page
        |
        v
Validate configuration
        |
        v
Generate/download QR code
        |
        v
Share/display QR only as a neutral, optional invitation
```

### Owner setup details

- Authentication must complete before configuration changes.
- Owner can only manage businesses they are authorized to manage.
- Google review URL must be validated before publishing.
- Categories should be factual labels for actual services/experiences, not suggested review phrases or promotional claims.
- Owner cannot configure a default rating, require a positive rating, or create different destinations based on rating.
- Owner should preview the public page before creating/distributing the QR code.

## 9. Business-owner flow — ongoing management

1. Owner signs in.
2. Owner updates profile, review URL, or category list as needed.
3. Owner views aggregate page visits, generation counts, copy actions, and Google-link clicks.
4. Analytics labels must not imply that a click equals a published review.
5. Owner can deactivate a page or category when it is no longer relevant.

## 10. Staff/customer interaction guidance

The product is intended to let customers operate their own devices. Business staff may make a neutral invitation to use the QR code, but must not:

- Require a review or rating as a condition of service, discount, refund, warranty, or benefit.
- Pressure customers to complete a review while on the premises.
- Tell customers which rating to select or what words to include.
- Select a rating/category or write/submit the review for the customer.
- Direct only satisfied customers to the QR code or suppress access for dissatisfied customers.

## 11. Product decisions still open

- Single-category or multi-category selection.
- One overall rating for all selected categories, or rating per category.
- Supported languages for the pilot.
- Feedback text maximum length.
- Whether customer can preview a regenerated draft alongside the previous draft.
- Regeneration cap and cooldown.
- Customer-facing privacy notice wording and AI disclosure placement.
- Policy approval of the structured-input-only generation concept before public Google-review use.

---

**Document status:** Draft. Confirm open decisions before final UI design and implementation tickets are created.
